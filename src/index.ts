import type { Progress } from './progress.ts';
import type { ReportInput, WindowCommits } from './report.ts';
import type { FoundRepo } from './scan.ts';
import type { AuthorInfo, CommitEntry, CommitFilter, DateWindow, Options, ScanOptions } from './types.ts';
import process from 'node:process';
import { parseArgs } from './cli.ts';
import { defaultConfigPath } from './config.ts';
import { CliError, GitError, UsageError } from './errors.ts';
import { CALIBRATION_MS, MIN_GAPS, sameDayGaps } from './gap.ts';
import { gitIdentity, readCommits } from './git.ts';
import { startProgress } from './progress.ts';
import { renderCsv } from './render/csv.ts';
import { renderJson } from './render/json.ts';
import { renderText } from './render/text.ts';
import { buildReport } from './report.ts';
import { displayPath, fetchAll, findRepos, readAll } from './scan.ts';

const RENDERERS = { csv: renderCsv, json: renderJson, text: renderText } as const;

const NO_IDENTITY = 'no git user configured (user.email / user.name)';

// The windows used to calibrate the gap: the 12 months before the end of the
// report window, then all history before it if those months are too sparse.
function calibrationWindows(opts: Options): { all: DateWindow; recent: DateWindow; until: number } | undefined {
  if (opts.report.gapMinutes !== undefined)
    return undefined;
  const until = opts.window.until ?? Date.now();
  return {
    all: { label: 'calibration', since: null, until },
    recent: { label: 'calibration', since: until - CALIBRATION_MS, until },
    until,
  };
}

const enoughToCalibrate = (commits: CommitEntry[]) => sameDayGaps(commits.map(c => c.timestamp)).length >= MIN_GAPS;

async function collectRepo(opts: Options): Promise<ReportInput> {
  let filter = opts.filter;
  if (opts.authorMode === 'git-config') {
    const authors = await gitIdentity(opts.repo);
    if (authors.length === 0)
      throw new UsageError(`${NO_IDENTITY}: pass --author, or --all-authors to count everyone`);
    filter = { ...filter, authors };
  }
  const read = async (window: DateWindow): Promise<WindowCommits> =>
    ({ commits: await readCommits(opts.repo, filter, window), window });
  const cal = calibrationWindows(opts);
  const [current, compare, recent] = await Promise.all([
    read(opts.window),
    opts.compare ? read(opts.compare) : undefined,
    cal ? read(cal.recent) : undefined,
  ]);
  let calibration: ReportInput['calibration'];
  if (cal && recent) {
    const commits = enoughToCalibrate(recent.commits) ? recent.commits : (await read(cal.all)).commits;
    calibration = { commits, until: cal.until };
  }
  return { ...current, author: { mode: opts.authorMode, patterns: filter.authors }, calibration, compare };
}

async function collectScan(opts: Options, scan: ScanOptions, progress: Progress, warnings: string[]): Promise<ReportInput> {
  const hooks = { onProgress: progress.update, onWarning: (msg: string) => warnings.push(msg) };

  progress.update('Finding repositories...');
  const repos = await findRepos(scan.roots, scan.exclude, hooks.onWarning);
  if (repos.length === 0)
    warnings.push(`no git repositories found under ${scan.roots.join(', ')}`);

  if (scan.fetch && repos.length > 0)
    await fetchAll(repos, hooks);

  // In git-config mode each repo is filtered by its own identity (git
  // resolves includeIf per repo); a repo without one is skipped.
  const used = new Set<string>(opts.filter.authors);
  const filterFor = opts.authorMode !== 'git-config'
    ? opts.filter
    : async (repo: FoundRepo): Promise<CommitFilter> => {
      const authors = await gitIdentity(repo.path);
      if (authors.length === 0)
        throw new GitError(`${NO_IDENTITY}; pass --author`);
      authors.forEach(a => used.add(a));
      return { ...opts.filter, authors };
    };

  const cal = calibrationWindows(opts);
  const windows = [opts.window, ...(opts.compare ? [opts.compare] : []), ...(cal ? [cal.recent] : [])];
  const lists = await readAll(repos, filterFor, windows, hooks);
  let next = 0;
  const commits = lists[next++];
  const compareCommits = opts.compare ? lists[next++] : [];
  const recent = cal ? lists[next++] : [];
  let calibration: ReportInput['calibration'];
  if (cal) {
    // Second pass only when the last 12 months are too sparse; its warnings
    // would repeat the first pass's, so they are dropped.
    const all = enoughToCalibrate(recent)
      ? recent
      : (await readAll(repos, filterFor, [cal.all], { onProgress: hooks.onProgress, onWarning: () => {} }))[0];
    calibration = { commits: all, until: cal.until };
  }
  const author: AuthorInfo = { mode: opts.authorMode, patterns: [...used] };
  return {
    author,
    calibration,
    commits,
    compare: opts.compare ? { commits: compareCommits, window: opts.compare } : undefined,
    scan: { repos, roots: scan.roots.map(displayPath) },
    window: opts.window,
  };
}

async function run(opts: Options): Promise<string> {
  const progress = startProgress('Reading git log...');
  const warnings: string[] = [];
  try {
    const input = opts.scan
      ? await collectScan(opts, opts.scan, progress, warnings)
      : await collectRepo(opts);
    return RENDERERS[opts.format](buildReport({ ...input, configPath: opts.configPath && displayPath(opts.configPath) }, opts.report));
  }
  finally {
    progress.stop();
    for (const w of warnings)
      console.error(`git-hours: warning: ${w}`);
  }
}

async function main(): Promise<void> {
  try {
    process.stdout.write(await run(parseArgs(process.argv.slice(2), { defaultConfigPath: defaultConfigPath() })));
  }
  catch (err) {
    if (!(err instanceof CliError))
      throw err;
    if (err.message)
      console.error(`git-hours: ${err.message}`);
    process.exitCode = err.exitCode;
  }
}

void main();
