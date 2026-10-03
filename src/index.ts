import type { WindowCommits } from './report.ts';
import type { Options } from './types.ts';
import process from 'node:process';
import { parseArgs } from './cli.ts';
import { CliError } from './errors.ts';
import { readCommits } from './git.ts';
import { startProgress } from './progress.ts';
import { renderCsv } from './render/csv.ts';
import { renderJson } from './render/json.ts';
import { renderText } from './render/text.ts';
import { buildReport } from './report.ts';

const RENDERERS = { csv: renderCsv, json: renderJson, text: renderText } as const;

async function run(opts: Options): Promise<string> {
  const progress = startProgress('Reading git log...');
  try {
    const read = async (window: Options['window']): Promise<WindowCommits> =>
      ({ commits: await readCommits(opts.repo, opts.filter, window), window });
    const [current, compare] = await Promise.all([
      read(opts.window),
      opts.compare ? read(opts.compare) : undefined,
    ]);
    const report = buildReport({ ...current, compare }, opts.report);
    return RENDERERS[opts.format](report);
  }
  finally {
    progress.stop();
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
