import type { Progress } from './progress.ts';
import type { ReportInput, WindowCommits } from './report.ts';
import type { FoundRepo } from './scan.ts';
import type { AuthorInfo, CommitFilter, DateWindow, Options, ScanOptions } from './types.ts';
import process from 'node:process';
import { parseArgs } from './cli.ts';
import { defaultConfigPath } from './config.ts';
import { CliError, GitError, UsageError } from './errors.ts';
import { gitIdentity, readCommits } from './git.ts';
import { startProgress } from './progress.ts';
import { renderCsv } from './render/csv.ts';
import { renderJson } from './render/json.ts';
import { renderText } from './render/text.ts';
import { buildReport } from './report.ts';
import { displayPath, fetchAll, findRepos, readAll } from './scan.ts';

const RENDERERS = { csv: renderCsv, json: renderJson, text: renderText } as const;

const NO_IDENTITY = 'no git user configured (user.email / user.name)';

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
  const [current, compare] = await Promise.all([
    read(opts.window),
    opts.compare ? read(opts.compare) : undefined,
  ]);
  return { ...current, author: { mode: opts.authorMode, patterns: filter.authors }, compare };
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

  const windows = opts.compare ? [opts.window, opts.compare] : [opts.window];
  const [commits, compareCommits] = await readAll(repos, filterFor, windows, hooks);
  const author: AuthorInfo = { mode: opts.authorMode, patterns: [...used] };
  return {
    author,
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
