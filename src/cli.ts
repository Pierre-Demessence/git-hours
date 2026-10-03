import type { Options } from './types.ts';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command, Option } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { parseWindowSpec, resolveWindow } from './dates.ts';
import { ExitRequest, UsageError } from './errors.ts';

function parseNonNegativeNumber(name: string) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0)
      throw new Error(`--${name} must be a non-negative number, got "${value}"`);
    return n;
  };
}

function validateRepoPath(repo: string): void {
  const abs = resolve(repo);
  if (!existsSync(abs))
    throw new UsageError(`--repo path does not exist: ${repo}`);
  if (!statSync(abs).isDirectory())
    throw new UsageError(`--repo path is not a directory: ${repo}`);
  // Whether it is a git repository is left to git itself, which also accepts
  // subdirectories of a work tree and bare repositories.
}

interface RawOptions {
  allAuthors: boolean;
  allBranches: boolean;
  author?: string;
  autoGap: boolean;
  branch?: string;
  compare?: string;
  csv: boolean;
  daily: boolean;
  excludeAuthor?: string[];
  firstCommitCredit: number;
  gap: number;
  heatmap: boolean;
  json: boolean;
  lastMonth?: boolean;
  lastWeek?: boolean;
  month?: string;
  repo?: string;
  since?: string;
  thisMonth?: boolean;
  thisWeek?: boolean;
  today?: boolean;
  top?: number;
  until?: string;
  week?: string;
  yesterday?: boolean;
}

// Parse argv into Options. Throws UsageError on invalid input and ExitRequest
// after --help / --version; never exits the process itself.
export function parseArgs(argv: string[]): Options {
  const program = new Command()
    .name('git-hours')
    .description('Estimate work time from git commit history')
    .version(pkg.version, '-v, --version', 'output the version number')
    .option('--since <date>', 'start date, inclusive (ISO, e.g. 2025-03-01)')
    .option('--until <date>', 'end date, exclusive (ISO, e.g. 2025-04-01)')
    .option('--month <YYYY-MM>', 'shortcut: analyze a specific month')
    .option('--week <YYYY-MM-DD>', 'shortcut: analyze the Monday-based week containing that date')
    .option('--today', 'shortcut: analyze today')
    .option('--yesterday', 'shortcut: analyze yesterday')
    .option('--this-week', 'shortcut: analyze the current week (Monday-based)')
    .option('--last-week', 'shortcut: analyze the previous week')
    .option('--this-month', 'shortcut: analyze the current month')
    .option('--last-month', 'shortcut: analyze the previous month')
    .addOption(new Option('--gap <minutes>', 'max gap between commits in a session').default(120).argParser(parseNonNegativeNumber('gap')))
    .addOption(new Option('--first-commit-credit <minutes>', 'time credited for the first commit in a session').default(30).argParser(parseNonNegativeNumber('first-commit-credit')))
    .addOption(new Option('--auto-gap', 'auto-pick gap from commit cadence (P90 of inter-commit deltas)').conflicts('gap').default(false))
    .addOption(new Option('--author <name>', 'filter by author name or email (case-insensitive substring match)').conflicts('allAuthors'))
    .option('--all-authors', 'show per-author breakdown', false)
    .option('--exclude-author <name...>', 'exclude commits by author (repeatable, substring match)')
    .addOption(new Option('--top <n>', 'limit --all-authors to the top N by hours').argParser(parseNonNegativeNumber('top')))
    .addOption(new Option('--branch <name>', 'analyze a specific branch (default: HEAD)').conflicts('allBranches'))
    .option('--all-branches', 'analyze commits reachable from any ref', false)
    .option('--daily', 'include the per-day breakdown', false)
    .option('--heatmap', 'print a 7×24 hour-of-day × day-of-week heatmap', false)
    .addOption(new Option('--json', 'output JSON instead of text').conflicts('csv').default(false))
    .addOption(new Option('--csv', 'output daily breakdown as CSV (implies --daily)').conflicts('json').default(false))
    .option('--repo <path>', 'path to git repository (default: current directory)')
    .option('--compare <window>', 'compare to another window: a shortcut (e.g. last-month), YYYY-MM, or START..END')
    .addHelpText('after', '\nExamples:\n  git-hours --month 2025-03\n  git-hours --since 2025-03-01 --until 2025-04-01\n  git-hours --week 2025-03-24\n  git-hours --this-week\n  git-hours --last-month\n  git-hours --gap 90 --first-commit-credit 20\n  git-hours --repo ../other-repo\n  git-hours --this-month --compare last-month\n')
    .configureOutput({ writeErr: () => {} })
    .exitOverride();

  try {
    program.parse(argv, { from: 'user' });
  }
  catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === 'commander.helpDisplayed' || e.code === 'commander.help' || e.code === 'commander.version')
      throw new ExitRequest();
    throw new UsageError(e.message.replace(/^error: /, ''));
  }

  const raw = program.opts<RawOptions>();

  if (raw.branch?.startsWith('-'))
    throw new UsageError(`--branch must not start with '-' (got "${raw.branch}")`);

  if (raw.top !== undefined) {
    if (!Number.isInteger(raw.top) || raw.top < 1)
      throw new UsageError('--top must be a positive integer');
    if (!raw.allAuthors)
      throw new UsageError('--top requires --all-authors');
  }

  if (raw.repo !== undefined)
    validateRepoPath(raw.repo);

  const shortcuts = ([
    ['today', raw.today],
    ['yesterday', raw.yesterday],
    ['this-week', raw.thisWeek],
    ['last-week', raw.lastWeek],
    ['this-month', raw.thisMonth],
    ['last-month', raw.lastMonth],
  ] as const).filter(([, on]) => on).map(([name]) => name);

  const window = resolveWindow({ month: raw.month, shortcuts, since: raw.since, until: raw.until, week: raw.week });

  const format = raw.json ? 'json' : raw.csv ? 'csv' : 'text';
  if (format === 'csv' && raw.compare !== undefined)
    throw new UsageError('--csv is not supported with --compare');

  return {
    compare: raw.compare !== undefined ? parseWindowSpec(raw.compare, 'compare') : undefined,
    filter: {
      allBranches: raw.allBranches,
      author: raw.author,
      branch: raw.branch,
      excludeAuthor: raw.excludeAuthor ?? [],
    },
    format,
    repo: raw.repo,
    report: {
      allAuthors: raw.allAuthors,
      autoGap: raw.autoGap,
      daily: raw.daily || raw.csv,
      firstCommitMinutes: raw.firstCommitCredit,
      gapMinutes: raw.gap,
      heatmap: raw.heatmap,
      top: raw.top,
    },
    window,
  };
}
