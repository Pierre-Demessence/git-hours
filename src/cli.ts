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

export function parseArgs(argv: string[]): Options {
  const program = new Command()
    .name('git-hours')
    .description('Estimate work time from git commit history')
    .option('--since <date>', 'start date (ISO, e.g. 2025-03-01)')
    .option('--until <date>', 'end date (ISO, e.g. 2025-04-01)')
    .option('--month <YYYY-MM>', 'shortcut: analyze a specific month')
    .option('--week <YYYY-MM-DD>', 'shortcut: analyze the week starting on that date')
    .addOption(new Option('--gap <minutes>', 'max gap between commits in a session').default(120).argParser(parsePositiveNumber('gap')))
    .addOption(new Option('--first <minutes>', 'time credited for the first commit in a session').default(30).argParser(parsePositiveNumber('first')))
    .addOption(new Option('--author <name>', 'filter by author name (substring match)').conflicts('allAuthors'))
    .option('--all-authors', 'show per-author breakdown', false)
    .addHelpText('after', '\nExamples:\n  git-hours --month 2025-03\n  git-hours --since 2025-03-01 --until 2025-04-01\n  git-hours --week 2025-03-24\n  git-hours --gap 90 --first 20\n')
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
    month?: string;
    since?: string;
    until?: string;
    week?: string;
  }>();

  const opts: Options = {
    allAuthors: raw.allAuthors,
    author: raw.author,
    firstCommitMinutes: raw.first,
    gapMinutes: raw.gap,
    since: raw.since,
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

  return opts;
}
