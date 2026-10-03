import type { Progress } from './progress.ts';
import type { ReportInput, WindowCommits } from './report.ts';
import type { DateWindow, Options, ScanOptions } from './types.ts';
import process from 'node:process';
import { parseArgs } from './cli.ts';
import { CliError } from './errors.ts';
import { readCommits } from './git.ts';
import { startProgress } from './progress.ts';
import { renderCsv } from './render/csv.ts';
import { renderJson } from './render/json.ts';
import { renderText } from './render/text.ts';
import { buildReport } from './report.ts';
import { displayPath, fetchAll, findRepos, readAll } from './scan.ts';

const RENDERERS = { csv: renderCsv, json: renderJson, text: renderText } as const;

async function collectRepo(opts: Options): Promise<ReportInput> {
  const read = async (window: DateWindow): Promise<WindowCommits> =>
    ({ commits: await readCommits(opts.repo, opts.filter, window), window });
  const [current, compare] = await Promise.all([
    read(opts.window),
    opts.compare ? read(opts.compare) : undefined,
  ]);
  return { ...current, compare };
}

async function collectScan(opts: Options, scan: ScanOptions, progress: Progress, warnings: string[]): Promise<ReportInput> {
  const hooks = { onProgress: progress.update, onWarning: (msg: string) => warnings.push(msg) };

  progress.update('Finding repositories...');
  const repos = await findRepos(scan.roots, scan.exclude, hooks.onWarning);
  if (repos.length === 0)
    warnings.push(`no git repositories found under ${scan.roots.join(', ')}`);

  if (scan.fetch && repos.length > 0)
    await fetchAll(repos, hooks);

  const windows = opts.compare ? [opts.window, opts.compare] : [opts.window];
  const [commits, compareCommits] = await readAll(repos, opts.filter, windows, hooks);
  return {
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
    return RENDERERS[opts.format](buildReport(input, opts.report));
  }
  finally {
    progress.stop();
    for (const w of warnings)
      console.error(`git-hours: warning: ${w}`);
  }
}

async function main(): Promise<void> {
  try {
    process.stdout.write(await run(parseArgs(process.argv.slice(2))));
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
