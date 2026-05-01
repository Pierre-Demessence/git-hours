import process from 'node:process';
import { Command, Option } from 'commander';
import type { Options } from './types.ts';

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

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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

export function parseArgs(argv: string[]): Options {
  const program = new Command()
    .name('git-hours')
    .description('Estimate work time from git commit history')
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
    .addOption(new Option('--first <minutes>', 'time credited for the first commit in a session').default(30).argParser(parsePositiveNumber('first')))
    .addOption(new Option('--author <name>', 'filter by author name (substring match)').conflicts('allAuthors'))
    .option('--all-authors', 'show per-author breakdown', false)
    .option('--summary-only', 'skip the per-day breakdown', false)
    .option('--repo <path>', 'path to git repository (default: current directory)')
    .addHelpText('after', '\nExamples:\n  git-hours --month 2025-03\n  git-hours --since 2025-03-01 --until 2025-04-01\n  git-hours --week 2025-03-24\n  git-hours --this-week\n  git-hours --last-month\n  git-hours --gap 90 --first 20\n  git-hours --repo ../other-repo\n')
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
    author?: string;
    first: number;
    gap: number;
    lastMonth?: boolean;
    lastWeek?: boolean;
    month?: string;
    repo?: string;
    since?: string;
    summaryOnly: boolean;
    thisMonth?: boolean;
    thisWeek?: boolean;
    today?: boolean;
    until?: string;
    week?: string;
    yesterday?: boolean;
  }>();

  const opts: Options = {
    allAuthors: raw.allAuthors,
    author: raw.author,
    firstCommitMinutes: raw.first,
    gapMinutes: raw.gap,
    repo: raw.repo,
    since: raw.since,
    summaryOnly: raw.summaryOnly,
    until: raw.until,
  };

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
    opts.since = new Date(year, month - 1, 1).toISOString();
    const nextMonth = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
    opts.until = nextMonth.toISOString();
  }

  if (raw.week) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.week) || Number.isNaN(Date.parse(raw.week))) {
      console.error('git-hours: --week must be YYYY-MM-DD (e.g. 2025-03-24)');
      process.exit(2);
    }
    const start = new Date(raw.week);
    // Snap to the Monday of that ISO week (getDay(): 0=Sun..6=Sat).
    const dayOfWeek = start.getDay();
    const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    start.setDate(start.getDate() + offsetToMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    opts.since = start.toISOString();
    opts.until = end.toISOString();
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
    const now = new Date();
    let since: Date;
    let until: Date;
    switch (name) {
      case 'today': {
        since = startOfDay(now);
        until = new Date(since);
        until.setDate(until.getDate() + 1);
        break;
      }
      case 'yesterday': {
        until = startOfDay(now);
        since = new Date(until);
        since.setDate(since.getDate() - 1);
        break;
      }
      case 'this-week': {
        since = startOfWeek(now);
        until = new Date(since);
        until.setDate(until.getDate() + 7);
        break;
      }
      case 'last-week': {
        until = startOfWeek(now);
        since = new Date(until);
        since.setDate(since.getDate() - 7);
        break;
      }
      case 'this-month': {
        since = startOfMonth(now);
        until = new Date(since.getFullYear(), since.getMonth() + 1, 1);
        break;
      }
      case 'last-month': {
        until = startOfMonth(now);
        since = new Date(until.getFullYear(), until.getMonth() - 1, 1);
        break;
      }
    }
    opts.since = since.toISOString();
    opts.until = until.toISOString();
  }

  return opts;
}
