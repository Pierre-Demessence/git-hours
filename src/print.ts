import type { SessionResult } from './types.ts';
import { dayName, formatDateTime, formatHours, formatTimeOfDay, isoWeekNumber } from './format.ts';

export function printResult(label: string, result: SessionResult): void {
  if (result.commits === 0) {
    console.log(`  ${label}: No commits found`);
    return;
  }
  console.log(`  ${label}`);
  console.log(`    Commits:      ${result.commits}`);
  console.log(`    Sessions:     ${result.sessions}`);
  console.log(`    Total time:   ${formatHours(result.hours)}`);
  console.log(`    First commit: ${result.firstCommit ? formatDateTime(result.firstCommit) : '—'}`);
  console.log(`    Last commit:  ${result.lastCommit ? formatDateTime(result.lastCommit) : '—'}`);
}

export function printDailyBreakdown(daily: Map<string, SessionResult>): void {
  const sorted = [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (sorted.length === 0)
    return;
  const maxHours = Math.max(...sorted.map(([, r]) => r.hours));

  const SEP = '  ';
  console.log('  Daily breakdown:');
  console.log(`  ${'Date'.padEnd(12)}${SEP}${'Day'.padEnd(4)}${SEP}${'Time'.padEnd(7)}${SEP}${'Range'.padEnd(15)}${SEP}${'Commits'.padEnd(8)}${SEP}Bar`);
  console.log(`  ${'─'.repeat(12)}${SEP}${'─'.repeat(4)}${SEP}${'─'.repeat(7)}${SEP}${'─'.repeat(15)}${SEP}${'─'.repeat(8)}${SEP}${'─'.repeat(28)}`);

  let currentWeek = '';
  let weekHours = 0;
  let weekCommits = 0;

  // Day(12) + SEP + DayName(4) = 18 chars before the Time column starts.
  const subtotalLabelWidth = 12 + SEP.length + 4;

  const flushWeek = () => {
    if (currentWeek) {
      console.log(
        `  ${`  ${currentWeek} subtotal`.padEnd(subtotalLabelWidth)}${SEP}${formatHours(weekHours).padStart(7)}${SEP}${' '.repeat(15)}${SEP}${String(weekCommits).padStart(8)}`,
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
    const range = result.firstCommit && result.lastCommit
      ? `${formatTimeOfDay(result.firstCommit)} → ${formatTimeOfDay(result.lastCommit)}`
      : '—';
    console.log(
      `  ${day.padEnd(12)}${SEP}${dayName(day).padEnd(4)}${SEP}${formatHours(result.hours).padStart(7)}${SEP}${range.padEnd(15)}${SEP}${String(result.commits).padStart(8)}${SEP}${bar}`,
    );
  }
  flushWeek();
}
