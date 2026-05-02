import type { Options } from './types.ts';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { Command, Option } from 'commander';
import pkg from '../package.json' with { type: 'json' };

function parsePositiveNumber(name: string) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`--${name} must be a non-negative number, got "${value}"`);
    }
    return n;
  };
}

function validateIsoDate(value: string, flag: string): void {
  const t = Date.parse(value);
  if (Number.isNaN(t)) {
    console.error(`git-hours: --${flag} must be a valid date, got "${value}"`);
    process.exit(2);
  }
}

function validateRepoPath(repo: string): void {
  const abs = resolve(repo);
  if (!existsSync(abs)) {
    console.error(`git-hours: --repo path does not exist: ${repo}`);
    process.exit(2);
  }
  if (!statSync(abs).isDirectory()) {
    console.error(`git-hours: --repo path is not a directory: ${repo}`);
    process.exit(2);
  }
  // `.git` is a directory in normal repos, but a regular file in worktrees,
  // submodules, and bare-via-gitfile setups — both are valid here.
  if (!existsSync(join(abs, '.git'))) {
    console.error(`git-hours: --repo is not a git repository (no .git found): ${repo}`);
    process.exit(2);
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Format a Date as a bare local-time string (no Z, no T): "YYYY-MM-DD HH:mm:ss".
// Git interprets this as local time, matching the local-time bucketing used by
// dateKey() in format.ts. Using .toISOString() (UTC, with Z) would silently
// shift commits across day boundaries for non-UTC users.
function toLocalGitDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da} ${hh}:${mm}:${ss}`;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

type Shortcut = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month' | 'last-month';

function resolveShortcut(name: Shortcut, now: Date = new Date()): { since: Date; until: Date } {
  let since: Date;
  let until: Date;
  switch (name) {
    case 'today':
      since = startOfDay(now);
      until = new Date(since);
      until.setDate(until.getDate() + 1);
      break;
    case 'yesterday':
      until = startOfDay(now);
      since = new Date(until);
      since.setDate(since.getDate() - 1);
      break;
    case 'this-week':
      since = startOfWeek(now);
      until = new Date(since);
      until.setDate(until.getDate() + 7);
      break;
    case 'last-week':
      until = startOfWeek(now);
      since = new Date(until);
      since.setDate(since.getDate() - 7);
      break;
    case 'this-month':
      since = startOfMonth(now);
      until = new Date(since.getFullYear(), since.getMonth() + 1, 1);
      break;
    case 'last-month':
      until = startOfMonth(now);
      since = new Date(until.getFullYear(), until.getMonth() - 1, 1);
      break;
  }
  return { since, until };
}

const COMPARE_TOKENS: readonly Shortcut[] = ['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'last-month'];

export interface DateWindow {
  since: string;
  until: string;
  label: string;
}

export function resolveCompareRef(ref: string): DateWindow {
  if ((COMPARE_TOKENS as readonly string[]).includes(ref)) {
    const { since, until } = resolveShortcut(ref as Shortcut);
    return { since: toLocalGitDate(since), until: toLocalGitDate(until), label: ref };
  }
  // YYYY-MM (whole month)
  if (/^\d{4}-\d{2}$/.test(ref)) {
    const [y, m] = ref.split('-').map(Number);
    if (m < 1 || m > 12)
      throw new Error(`--compare month must be between 01 and 12, got "${ref}"`);
    const since = new Date(y, m - 1, 1);
    const until = m === 12 ? new Date(y + 1, 0, 1) : new Date(y, m, 1);
    return { since: toLocalGitDate(since), until: toLocalGitDate(until), label: ref };
  }
  // YYYY-MM-DD..YYYY-MM-DD (explicit range, end-exclusive, local time)
  const rangeMatch = ref.match(/^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/);
  if (rangeMatch) {
    const [ay, am, ad, by, bm, bd] = rangeMatch.slice(1).map(Number);
    const sinceD = new Date(ay, am - 1, ad);
    const untilD = new Date(by, bm - 1, bd);
    if (Number.isNaN(sinceD.getTime()) || Number.isNaN(untilD.getTime()))
      throw new Error(`--compare range has invalid date: "${ref}"`);
    if (sinceD.getTime() >= untilD.getTime())
      throw new Error(`--compare range start must be before end: "${ref}"`);
    return { since: toLocalGitDate(sinceD), until: toLocalGitDate(untilD), label: ref };
  }
  throw new Error(`--compare: unrecognized ref "${ref}". Expected one of: ${COMPARE_TOKENS.join(', ')}, YYYY-MM, or YYYY-MM-DD..YYYY-MM-DD`);
}

export function parseArgs(argv: string[]): Options {
  const program = new Command()
    .name('git-hours')
    .description('Estimate work time from git commit history')
    .version(pkg.version, '-v, --version', 'output the version number')
    .option('--since <date>', 'start date (ISO, e.g. 2025-03-01)')
    .option('--until <date>', 'end date (ISO, e.g. 2025-04-01)')
    .option('--month <YYYY-MM>', 'shortcut: analyze a specific month')
    .option('--week <YYYY-MM-DD>', 'shortcut: analyze the week starting on that date')
    .option('--today', 'shortcut: analyze today')
    .option('--yesterday', 'shortcut: analyze yesterday')
    .option('--this-week', 'shortcut: analyze the current week (Monday-based)')
    .option('--last-week', 'shortcut: analyze the previous week')
    .option('--this-month', 'shortcut: analyze the current month')
    .option('--last-month', 'shortcut: analyze the previous month')
    .addOption(new Option('--gap <minutes>', 'max gap between commits in a session').default(120).argParser(parsePositiveNumber('gap')))
    .addOption(new Option('--first-commit-credit <minutes>', 'time credited for the first commit in a session').default(30).argParser(parsePositiveNumber('first-commit-credit')))
    .addOption(new Option('--auto-gap', 'auto-pick gap from commit cadence (P90 of inter-commit deltas)').conflicts('gap').default(false))
    .addOption(new Option('--author <name>', 'filter by author name (substring match)').conflicts('allAuthors'))
    .option('--all-authors', 'show per-author breakdown', false)
    .option('--exclude-author <name...>', 'exclude commits by author (repeatable, substring match)')
    .addOption(new Option('--top <n>', 'limit --all-authors to the top N by hours').argParser(parsePositiveNumber('top')))
    .addOption(new Option('--branch <name>', 'analyze a specific branch (default: HEAD)').conflicts('allBranches'))
    .option('--all-branches', 'analyze commits reachable from any ref', false)
    .option('--daily', 'include the per-day breakdown', false)
    .option('--heatmap', 'print a 7×24 hour-of-day × day-of-week heatmap', false)
    .addOption(new Option('--json', 'output JSON instead of text').conflicts('csv').default(false))
    .addOption(new Option('--csv', 'output daily breakdown as CSV (implies --daily)').conflicts('json').default(false))
    .option('--repo <path>', 'path to git repository (default: current directory)')
    .option('--compare <ref>', 'compare to another window (token like last-month, YYYY-MM, or YYYY-MM-DD..YYYY-MM-DD)')
    .addHelpText('after', '\nExamples:\n  git-hours --month 2025-03\n  git-hours --since 2025-03-01 --until 2025-04-01\n  git-hours --week 2025-03-24\n  git-hours --this-week\n  git-hours --last-month\n  git-hours --gap 90 --first-commit-credit 20\n  git-hours --repo ../other-repo\n')
    .configureOutput({ writeErr: () => {} })
    .exitOverride();

  try {
    program.parse(argv, { from: 'user' });
  }
  catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === 'commander.helpDisplayed' || e.code === 'commander.help' || e.code === 'commander.version') {
      process.exit(0);
    }
    console.error(`git-hours: ${e.message}`);
    process.exit(2);
  }

  const raw = program.opts<{
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
  }>();

  const opts: Options = {
    allAuthors: raw.allAuthors,
    allBranches: raw.allBranches,
    author: raw.author,
    autoGap: raw.autoGap,
    branch: raw.branch,
    daily: raw.daily || raw.csv,
    excludeAuthor: raw.excludeAuthor ?? [],
    firstCommitMinutes: raw.firstCommitCredit,
    format: raw.json ? 'json' : raw.csv ? 'csv' : 'text',
    gapMinutes: raw.gap,
    heatmap: raw.heatmap,
    repo: raw.repo,
    since: raw.since,
    top: raw.top,
    until: raw.until,
  };

  if (raw.branch && raw.branch.startsWith('-')) {
    console.error(`git-hours: --branch must not start with '-' (got "${raw.branch}")`);
    process.exit(2);
  }

  if (opts.top !== undefined) {
    if (!Number.isInteger(opts.top) || opts.top < 1) {
      console.error('git-hours: --top must be a positive integer');
      process.exit(2);
    }
    if (!opts.allAuthors) {
      console.error('git-hours: --top requires --all-authors');
      process.exit(2);
    }
  }

  if (opts.repo !== undefined)
    validateRepoPath(opts.repo);

  if (raw.since)
    validateIsoDate(raw.since, 'since');
  if (raw.until)
    validateIsoDate(raw.until, 'until');

  if (raw.month) {
    if (!/^\d{4}-\d{2}$/.test(raw.month)) {
      console.error('git-hours: --month must be YYYY-MM (e.g. 2025-03)');
      process.exit(2);
    }
    const [year, month] = raw.month.split('-').map(Number);
    if (month < 1 || month > 12) {
      console.error('git-hours: --month must have a month between 01 and 12');
      process.exit(2);
    }
    opts.since = toLocalGitDate(new Date(year, month - 1, 1));
    const nextMonth = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
    opts.until = toLocalGitDate(nextMonth);
  }

  if (raw.week) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.week) || Number.isNaN(Date.parse(raw.week))) {
      console.error('git-hours: --week must be YYYY-MM-DD (e.g. 2025-03-24)');
      process.exit(2);
    }
    // Parse as local time (new Date('YYYY-MM-DD') would treat it as UTC).
    const [wy, wm, wd] = raw.week.split('-').map(Number);
    const start = new Date(wy, wm - 1, wd);
    // Snap to the Monday of that ISO week (getDay(): 0=Sun..6=Sat).
    const dayOfWeek = start.getDay();
    const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    start.setDate(start.getDate() + offsetToMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    opts.since = toLocalGitDate(start);
    opts.until = toLocalGitDate(end);
  }

  const shortcuts = [
    ['today', raw.today],
    ['yesterday', raw.yesterday],
    ['this-week', raw.thisWeek],
    ['last-week', raw.lastWeek],
    ['this-month', raw.thisMonth],
    ['last-month', raw.lastMonth],
  ] as const;
  const activeShortcuts = shortcuts.filter(([, on]) => on);
  if (activeShortcuts.length > 1) {
    const names = activeShortcuts.map(([n]) => `--${n}`).join(', ');
    console.error(`git-hours: shortcuts are mutually exclusive (${names})`);
    process.exit(2);
  }
  if (activeShortcuts.length === 1 && (raw.month || raw.week || raw.since || raw.until)) {
    const [name] = activeShortcuts[0];
    console.error(`git-hours: --${name} cannot be combined with --since/--until/--month/--week`);
    process.exit(2);
  }
  if (activeShortcuts.length === 1) {
    const [name] = activeShortcuts[0];
    const { since, until } = resolveShortcut(name);
    opts.since = toLocalGitDate(since);
    opts.until = toLocalGitDate(until);
  }

  if (raw.compare !== undefined) {
    if (opts.allAuthors) {
      console.error('git-hours: --compare cannot be combined with --all-authors');
      process.exit(2);
    }
    try {
      opts.compare = resolveCompareRef(raw.compare);
    }
    catch (err) {
      console.error(`git-hours: ${(err as Error).message}`);
      process.exit(2);
    }
  }

  return opts;
}
