import type { FileConfig } from './config.ts';
import type { AuthorMode, Options } from './types.ts';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command, Option } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { loadConfig } from './config.ts';
import { parseWindowSpec, resolveWindow } from './dates.ts';
import { ExitRequest, UsageError } from './errors.ts';
import { expandHome } from './scan.ts';

const DEFAULT_GAP = 120;
const DEFAULT_FIRST_COMMIT_CREDIT = 30;

function parseNonNegativeNumber(name: string) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0)
      throw new Error(`--${name} must be a non-negative number, got "${value}"`);
    return n;
  };
}

function validateDirectory(path: string, flag: string): void {
  const abs = resolve(expandHome(path));
  if (!existsSync(abs))
    throw new UsageError(`--${flag} path does not exist: ${path}`);
  if (!statSync(abs).isDirectory())
    throw new UsageError(`--${flag} path is not a directory: ${path}`);
  // Whether it is a git repository is left to git itself, which also accepts
  // subdirectories of a work tree and bare repositories.
}

// Raw commander values. Options that a config file can provide have no
// commander default, so `undefined` reliably means "not given on the CLI".
interface RawOptions {
  allAuthors?: boolean;
  allBranches?: boolean;
  author?: string[];
  autoGap?: boolean;
  branch?: string;
  compare?: string;
  config?: string | false;
  csv: boolean;
  daily: boolean;
  excludeAuthor?: string[];
  fetch?: boolean;
  firstCommitCredit?: number;
  gap?: number;
  heatmap: boolean;
  independentRepos?: boolean;
  json: boolean;
  lastMonth?: boolean;
  lastWeek?: boolean;
  month?: string;
  perAuthor?: boolean;
  repo?: string;
  scan?: boolean | string[];
  scanExclude?: string[];
  since?: string;
  thisMonth?: boolean;
  thisWeek?: boolean;
  today?: boolean;
  top?: number;
  until?: string;
  week?: string;
  yesterday?: boolean;
}

export interface ParseOptions {
  // Config file read when --config is not given (and --no-config isn't
  // either). index.ts passes the XDG location; tests leave it out.
  defaultConfigPath?: string;
}

function buildProgram(): Command {
  return new Command()
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
    .addOption(new Option('--gap <minutes>', `max gap between commits in a session (default: ${DEFAULT_GAP})`).argParser(parseNonNegativeNumber('gap')))
    .addOption(new Option('--first-commit-credit <minutes>', `time credited for the first commit in a session (default: ${DEFAULT_FIRST_COMMIT_CREDIT})`).argParser(parseNonNegativeNumber('first-commit-credit')))
    .addOption(new Option('--auto-gap', 'auto-pick gap from commit cadence (P90 of inter-commit deltas)').conflicts('gap'))
    .addOption(new Option('--author <pattern...>', 'count commits whose "Name <email>" contains a pattern (case-insensitive; default: your git user.email and user.name)').conflicts(['allAuthors', 'perAuthor']))
    .option('--all-authors', 'count every author\'s commits (instead of only yours)')
    .option('--per-author', 'per-author breakdown of every author\'s commits')
    .option('--exclude-author <pattern...>', 'exclude commits by author (repeatable, substring match)')
    .addOption(new Option('--top <n>', 'limit --per-author (or --scan) to the top N by hours').argParser(parseNonNegativeNumber('top')))
    .addOption(new Option('--branch <name>', 'analyze a specific branch (default: HEAD)').conflicts('allBranches'))
    .option('--all-branches', 'analyze commits reachable from any ref')
    .option('--daily', 'include the per-day breakdown', false)
    .option('--heatmap', 'print a 7×24 hour-of-day × day-of-week heatmap', false)
    .addOption(new Option('--json', 'output JSON instead of text').conflicts('csv').default(false))
    .addOption(new Option('--csv', 'output daily breakdown as CSV (implies --daily)').conflicts('json').default(false))
    .option('--repo <path>', 'path to git repository (default: current directory)')
    .addOption(new Option('--scan [dirs...]', 'find git repositories recursively under dirs (default: config `scan`, else current directory) and report per project').conflicts(['repo', 'branch', 'perAuthor']))
    .option('--scan-exclude <pattern...>', 'with --scan: skip folders matching a glob (a name, or a path relative to the scan root if it contains /)')
    .option('--fetch', 'with --scan: run `git fetch` in each repository first (default)')
    .option('--no-fetch', 'with --scan: do not run `git fetch` first')
    .option('--independent-repos', 'with --scan: estimate each repo on its own (overlapping work counts once per repo)')
    .option('--compare <window>', 'compare to another window: a shortcut (e.g. last-month), YYYY-MM, or START..END')
    .option('--config <path>', 'read settings from this JSON file (default: ~/.config/git-hours/config.json)')
    .option('--no-config', 'ignore the config file')
    .addHelpText('after', '\nExamples:\n  git-hours --month 2025-03\n  git-hours --since 2025-03-01 --until 2025-04-01\n  git-hours --last-month --compare 2025-01\n  git-hours --gap 90 --first-commit-credit 20\n  git-hours --repo ../other-repo --per-author\n  git-hours --scan ~/dev ~/work --last-month\n')
    .configureOutput({ writeErr: () => {} })
    .exitOverride();
}

// Parse argv into Options. Throws UsageError on invalid input and ExitRequest
// after --help / --version; never exits the process itself.
export function parseArgs(argv: string[], parseOptions: ParseOptions = {}): Options {
  const program = buildProgram();
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

  // --- config file -------------------------------------------------------
  let config: FileConfig = {};
  let configPath: string | undefined;
  if (typeof raw.config === 'string') {
    configPath = resolve(expandHome(raw.config));
    config = loadConfig(configPath, true) ?? {};
  }
  else if (raw.config !== false && parseOptions.defaultConfigPath) {
    const loaded = loadConfig(parseOptions.defaultConfigPath, false);
    if (loaded) {
      config = loaded;
      configPath = parseOptions.defaultConfigPath;
    }
  }

  // --- validation of CLI-only combinations -------------------------------
  const scanning = raw.scan !== undefined;

  if (raw.branch?.startsWith('-'))
    throw new UsageError(`--branch must not start with '-' (got "${raw.branch}")`);

  if (raw.top !== undefined) {
    if (!Number.isInteger(raw.top) || raw.top < 1)
      throw new UsageError('--top must be a positive integer');
    if (!raw.perAuthor && !scanning)
      throw new UsageError('--top requires --per-author or --scan');
  }

  if (raw.repo !== undefined)
    validateDirectory(raw.repo, 'repo');

  if (!scanning) {
    const scanOnly = [
      ['--scan-exclude', raw.scanExclude !== undefined],
      ['--fetch / --no-fetch', raw.fetch !== undefined],
      ['--independent-repos', raw.independentRepos !== undefined],
    ] as const;
    const used = scanOnly.find(([, on]) => on);
    if (used)
      throw new UsageError(`${used[0]} requires --scan`);
  }

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

  // --- merge: CLI, then config file, then defaults -----------------------
  // Options that belong together are taken as a group from one source, so a
  // CLI flag never combines with a conflicting config value.
  const perAuthor = raw.perAuthor ?? false;
  const cliChoseAuthors = raw.author !== undefined || raw.allAuthors !== undefined || raw.perAuthor !== undefined;
  const authorSource = cliChoseAuthors ? { allAuthors: raw.allAuthors, author: raw.author } : config;
  const authorMode: AuthorMode = perAuthor || authorSource.allAuthors
    ? 'all'
    : authorSource.author ? 'patterns' : 'git-config';

  const cliChoseGap = raw.gap !== undefined || raw.autoGap !== undefined;
  const gapSource = cliChoseGap ? { autoGap: raw.autoGap, gap: raw.gap } : config;

  // --branch on the CLI overrides a config `allBranches`.
  const allBranches = raw.allBranches ?? (raw.branch === undefined && config.allBranches) ?? false;

  const roots = Array.isArray(raw.scan) ? raw.scan : raw.scan === true ? (config.scan ?? ['.']) : [];
  for (const root of roots)
    validateDirectory(root, 'scan');

  return {
    authorMode,
    compare: raw.compare !== undefined ? parseWindowSpec(raw.compare, 'compare') : undefined,
    configPath,
    filter: {
      allBranches,
      authors: authorMode === 'patterns' ? authorSource.author ?? [] : [],
      branch: raw.branch,
      excludeAuthor: raw.excludeAuthor ?? config.excludeAuthor ?? [],
    },
    format,
    repo: raw.repo,
    report: {
      autoGap: gapSource.autoGap ?? false,
      // --csv implies --daily for a single repo; with --scan, plain --csv is
      // one row per project and --daily makes it one row per project per day.
      daily: raw.daily || (raw.csv && !scanning),
      firstCommitMinutes: raw.firstCommitCredit ?? config.firstCommitCredit ?? DEFAULT_FIRST_COMMIT_CREDIT,
      gapMinutes: gapSource.gap ?? DEFAULT_GAP,
      heatmap: raw.heatmap,
      perAuthor,
      repoMode: (raw.independentRepos ?? config.independentRepos) ? 'independent' : 'shared',
      top: raw.top,
    },
    scan: scanning
      ? { exclude: raw.scanExclude ?? config.scanExclude ?? [], fetch: raw.fetch ?? config.fetch ?? true, roots }
      : undefined,
    window,
  };
}
