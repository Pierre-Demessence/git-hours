import { dayName, formatHours, isoWeekNumber } from './format.ts';
import type { SessionResult } from './types.ts';

export function printResult(label: string, result: SessionResult): void {
  if (result.commits === 0) {
    console.log(`  ${label}: No commits found`);
    return;
  }
  console.log(`  ${label}`);
  console.log(`    Commits:      ${result.commits}`);
  console.log(`    Sessions:     ${result.sessions}`);
  console.log(`    Total time:   ${formatHours(result.hours)}`);
  console.log(`    First commit: ${result.firstCommit?.toLocaleString() ?? '—'}`);
  console.log(`    Last commit:  ${result.lastCommit?.toLocaleString() ?? '—'}`);
}

export function printDailyBreakdown(daily: Map<string, SessionResult>): void {
  const sorted = [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (sorted.length === 0)
    return;
  const maxHours = Math.max(...sorted.map(([, r]) => r.hours));

  console.log('  Daily breakdown:');
  console.log(`  ${'Date'.padEnd(12)} ${'Day'.padEnd(4)} ${'Time'.padStart(7)} ${'Commits'.padStart(8)} ${'Bar'}`);
  console.log(`  ${'─'.repeat(12)} ${'─'.repeat(4)} ${'─'.repeat(7)} ${'─'.repeat(8)} ${'─'.repeat(30)}`);

  let currentWeek = '';
  let weekHours = 0;
  let weekCommits = 0;

  const flushWeek = () => {
    if (currentWeek) {
      console.log(
        `  ${`  ${currentWeek} subtotal`.padEnd(17)} ${formatHours(weekHours).padStart(7)} ${String(weekCommits).padStart(8)}`,
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
      `  ${day.padEnd(12)} ${dayName(day).padEnd(4)} ${formatHours(result.hours).padStart(7)} ${String(result.commits).padStart(8)} ${bar}`,
    );
  }
  flushWeek();
}
