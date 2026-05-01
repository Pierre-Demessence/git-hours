/**
 * Estimate work time from git commit history.
 * Groups commits into sessions based on a max gap threshold,
 * then sums total estimated hours.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { Command, Option } from 'commander';

interface Options {
  allAuthors: boolean;
  author?: string;
  firstCommitMinutes: number;
  gapMinutes: number;
  since?: string;
  until?: string;
}

interface CommitEntry {
  author: string;
  message: string;
  timestamp: number;
}

interface SessionResult {
  commits: number;
  firstCommit: Date;
  hours: number;
  lastCommit: Date;
  sessions: number;
}

function parseArgs(argv: string[]): Options {
  const program = new Command()
    .name('git-hours')
    .description('Estimate work time from git commit history')
    .option('--since <date>', 'start date (ISO, e.g. 2025-03-01)')
    .option('--until <date>', 'end date (ISO, e.g. 2025-04-01)')
    .option('--month <YYYY-MM>', 'shortcut: analyze a specific month')
    .option('--week <YYYY-MM-DD>', 'shortcut: analyze the week starting on that date')
    .addOption(new Option('--gap <minutes>', 'max gap between commits in a session').default(120).argParser(Number))
    .addOption(new Option('--first <minutes>', 'time credited for the first commit in a session').default(30).argParser(Number))
    .option('--author <name>', 'filter by author name (substring match)')
    .option('--all-authors', 'show per-author breakdown', false)
    .addHelpText('after', '\nExamples:\n  git-hours --month 2025-03\n  git-hours --since 2025-03-01 --until 2025-04-01\n  git-hours --week 2025-03-24\n  git-hours --gap 90 --first 20\n')
    .parse(argv, { from: 'user' });

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

  if (raw.month) {
    const [year, month] = raw.month.split('-').map(Number);
    opts.since = new Date(year, month - 1, 1).toISOString();
    const nextMonth = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
    opts.until = nextMonth.toISOString();
  }

  if (raw.week) {
    const start = new Date(raw.week);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    opts.since = start.toISOString();
    opts.until = end.toISOString();
  }

  return opts;
}

function getCommits(opts: Options): CommitEntry[] {
  const args = ['log', '--format=%at|%an|%s', '--no-merges'];

  if (opts.since)
    args.push(`--since=${opts.since}`);
  if (opts.until)
    args.push(`--until=${opts.until}`);
  if (opts.author)
    args.push(`--author=${opts.author}`);

  let raw: string;
  try {
    raw = execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }
  catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    const message = typeof stderr === 'string' ? stderr : stderr?.toString() ?? (err as Error).message;
    if (/not a git repository/i.test(message)) {
      console.error('git-hours: not a git repository (run from inside a repo).');
    }
    else if (/does not have any commits yet/i.test(message)) {
      console.error('git-hours: this repository has no commits yet.');
    }
    else {
      console.error(`git-hours: failed to read git log: ${message.trim()}`);
    }
    process.exit(1);
  }

  if (!raw)
    return [];

  return raw.split('\n').map((line) => {
    const [ts, author, ...msgParts] = line.split('|');
    return {
      author,
      message: msgParts.join('|'),
      timestamp: Number(ts) * 1000,
    };
  });
}

function estimateHours(commits: CommitEntry[], opts: Options): SessionResult {
  if (commits.length === 0) {
    return { commits: 0, firstCommit: new Date(), hours: 0, lastCommit: new Date(), sessions: 0 };
  }

  const sorted = [...commits].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = opts.gapMinutes * 60 * 1000;
  const firstCommitMs = opts.firstCommitMinutes * 60 * 1000;

  let totalMs = firstCommitMs;
  let sessions = 1;

  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].timestamp - sorted[i - 1].timestamp;
    if (diff > gapMs) {
      totalMs += firstCommitMs;
      sessions++;
    }
    else {
      totalMs += diff;
    }
  }

  return {
    commits: sorted.length,
    firstCommit: new Date(sorted[0].timestamp),
    hours: totalMs / (1000 * 60 * 60),
    lastCommit: new Date(sorted[sorted.length - 1].timestamp),
    sessions,
  };
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayName(key: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[new Date(key).getDay()];
}

function computeDailyBreakdown(commits: CommitEntry[], opts: Options): Map<string, SessionResult> {
  const byDay = new Map<string, CommitEntry[]>();
  for (const c of commits) {
    const key = dateKey(c.timestamp);
    const list = byDay.get(key) ?? [];
    list.push(c);
    byDay.set(key, list);
  }

  const daily = new Map<string, SessionResult>();
  for (const [day, dayCommits] of byDay) {
    daily.set(day, estimateHours(dayCommits, opts));
  }
  return daily;
}

function isoWeekNumber(dateStr: string): string {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - start.getTime()) / 86_400_000) + 1;
  const weekNum = Math.ceil((dayOfYear + start.getDay()) / 7);
  return `W${String(weekNum).padStart(2, '0')}`;
}

function printDailyBreakdown(daily: Map<string, SessionResult>) {
  const sorted = [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const maxHours = Math.max(...sorted.map(([, r]) => r.hours));

  console.log('  Daily breakdown:');
  console.log(`  ${'Date'.padEnd(12)} ${'Day'.padEnd(4)} ${'Time'.padEnd(8)} ${'Commits'.padEnd(8)} ${'Bar'}`);
  console.log(`  ${'─'.repeat(12)} ${'─'.repeat(4)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(30)}`);

  let currentWeek = '';
  let weekHours = 0;
  let weekCommits = 0;

  const flushWeek = () => {
    if (currentWeek) {
      console.log(
        `  ${`  ${currentWeek} subtotal`.padEnd(17)} ${formatHours(weekHours).padEnd(8)} ${String(weekCommits).padEnd(8)}`,
      );
      console.log();
    }
  };

  for (const [day, result] of sorted) {
    const week = isoWeekNumber(day);
    if (week !== currentWeek) {
      flushWeek();
      currentWeek = week;
      weekHours = 0;
      weekCommits = 0;
    }

    weekHours += result.hours;
    weekCommits += result.commits;

    const barLen = maxHours > 0 ? Math.round((result.hours / maxHours) * 28) : 0;
    const bar = '█'.repeat(barLen);
    console.log(
      `  ${day.padEnd(12)} ${dayName(day).padEnd(4)} ${formatHours(result.hours).padEnd(8)} ${String(result.commits).padEnd(8)} ${bar}`,
    );
  }
  flushWeek();
}

function printResult(label: string, result: SessionResult) {
  if (result.commits === 0) {
    console.log(`  ${label}: No commits found`);
    return;
  }
  console.log(`  ${label}`);
  console.log(`    Commits:      ${result.commits}`);
  console.log(`    Sessions:     ${result.sessions}`);
  console.log(`    Total time:   ${formatHours(result.hours)}`);
  console.log(`    First commit: ${result.firstCommit.toLocaleString()}`);
  console.log(`    Last commit:  ${result.lastCommit.toLocaleString()}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const commits = getCommits(opts);

  const dateRange = opts.since || opts.until
    ? `${opts.since ?? 'beginning'} → ${opts.until ?? 'now'}`
    : 'all time';

  console.log(`\n⏱  Git Hours — ${dateRange}`);
  console.log(`   Gap threshold: ${opts.gapMinutes}min | First-commit credit: ${opts.firstCommitMinutes}min\n`);

  if (opts.allAuthors) {
    const byAuthor = new Map<string, CommitEntry[]>();
    for (const c of commits) {
      const list = byAuthor.get(c.author) ?? [];
      list.push(c);
      byAuthor.set(c.author, list);
    }

    let grandTotal = 0;
    for (const [author, authorCommits] of [...byAuthor.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const result = estimateHours(authorCommits, opts);
      printResult(author, result);
      grandTotal += result.hours;
      console.log();
    }
    console.log(`  Grand total: ${formatHours(grandTotal)}\n`);
  }
  else {
    const result = estimateHours(commits, opts);
    printResult('Total', result);
    console.log();
  }

  if (commits.length > 0) {
    const daily = computeDailyBreakdown(commits, opts);
    printDailyBreakdown(daily);
  }
}

main();
