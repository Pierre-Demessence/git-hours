import type { DailyRow, Report } from '../report.ts';
import type { SessionResult } from '../types.ts';
import { formatDateTime, formatHours, formatSignedHours, formatTimeOfDay } from '../format.ts';

function resultLines(label: string, result: SessionResult): string[] {
  if (result.commits === 0)
    return [`  ${label}: No commits found`];
  return [
    `  ${label}`,
    `    Commits:      ${result.commits}`,
    `    Sessions:     ${result.sessions}`,
    `    Total time:   ${formatHours(result.hours)}`,
    `    First commit: ${result.firstCommit ? formatDateTime(result.firstCommit) : '—'}`,
    `    Last commit:  ${result.lastCommit ? formatDateTime(result.lastCommit) : '—'}`,
  ];
}

function pctLabel(pct: number | null, current: number): string {
  if (pct === null)
    return current === 0 ? '0%' : '+∞%';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function compareLines(report: Report): string[] {
  const { compare, total, window } = report;
  if (!compare)
    return [];
  const dc = compare.delta.commits;
  return [
    ...resultLines(`Compare (${compare.window.label})`, compare.total),
    '',
    '  Comparison',
    `    Current (${window.label}):  ${formatHours(total.hours)}  (${total.commits} commits)`,
    `    Compare (${compare.window.label}):  ${formatHours(compare.total.hours)}  (${compare.total.commits} commits)`,
    `    Delta:  ${formatSignedHours(compare.delta.hours)}  (${dc > 0 ? '+' : ''}${dc} commits, ${pctLabel(compare.delta.hoursPct, total.hours)} hours)`,
    '',
  ];
}

const BAR_WIDTH = 28;

function dailyLines(rows: DailyRow[]): string[] {
  if (rows.length === 0)
    return [];
  const maxHours = Math.max(...rows.map(r => r.result.hours));
  const SEP = '  ';
  const lines = [
    '  Daily breakdown:',
    `  ${'Date'.padEnd(12)}${SEP}${'Day'.padEnd(4)}${SEP}${'Time'.padEnd(7)}${SEP}${'Range'.padEnd(15)}${SEP}${'Commits'.padEnd(8)}${SEP}Bar`,
    `  ${'─'.repeat(12)}${SEP}${'─'.repeat(4)}${SEP}${'─'.repeat(7)}${SEP}${'─'.repeat(15)}${SEP}${'─'.repeat(8)}${SEP}${'─'.repeat(BAR_WIDTH)}`,
  ];

  // Date(12) + SEP + DayName(4) = 18 chars before the Time column starts.
  const subtotalLabelWidth = 12 + SEP.length + 4;
  let currentWeek = '';
  let weekHours = 0;
  let weekCommits = 0;
  const flushWeek = () => {
    if (!currentWeek)
      return;
    lines.push(
      `  ${`  ${currentWeek} subtotal`.padEnd(subtotalLabelWidth)}${SEP}${formatHours(weekHours).padStart(7)}${SEP}${' '.repeat(15)}${SEP}${String(weekCommits).padStart(8)}`,
      '',
    );
  };

  for (const { date, day, result, week } of rows) {
    if (week !== currentWeek) {
      flushWeek();
      currentWeek = week;
      weekHours = 0;
      weekCommits = 0;
    }
    weekHours += result.hours;
    weekCommits += result.commits;

    const bar = '█'.repeat(maxHours > 0 ? Math.round((result.hours / maxHours) * BAR_WIDTH) : 0);
    const range = result.firstCommit && result.lastCommit
      ? `${formatTimeOfDay(result.firstCommit)} → ${formatTimeOfDay(result.lastCommit)}`
      : '—';
    lines.push(
      `  ${date.padEnd(12)}${SEP}${day.padEnd(4)}${SEP}${formatHours(result.hours).padStart(7)}${SEP}${range.padEnd(15)}${SEP}${String(result.commits).padStart(8)}${SEP}${bar}`,
    );
  }
  flushWeek();
  return lines;
}

const SHADES = ['░', '▒', '▓', '█'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function heatmapLines(grid: number[][]): string[] {
  const max = Math.max(0, ...grid.flat());
  if (max === 0)
    return [];
  const lines = [
    '  Heatmap (local time, commits per hour)',
    `      ${Array.from({ length: 24 }, (_, h) => ` ${String(h).padStart(2, ' ')}`).join('')}`,
  ];
  grid.forEach((row, i) => {
    const cells = row.map((v) => {
      if (v === 0)
        return '   ';
      const idx = Math.min(SHADES.length - 1, Math.floor((v / max) * SHADES.length));
      return `  ${SHADES[idx]}`;
    }).join('');
    lines.push(`  ${DAY_NAMES[i]} ${cells}`);
  });
  lines.push('');
  return lines;
}

export function renderText(report: Report): string {
  const { params } = report;
  const gapLabel = params.autoGap ? `${params.gapMinutes}min (auto)` : `${params.gapMinutes}min`;
  const lines = [
    '',
    `⏱  Git Hours — ${report.window.label}`,
    `   Gap threshold: ${gapLabel} | First-commit credit: ${params.firstCommitMinutes}min`,
    '',
  ];

  if (report.authors) {
    const { count, shown } = report.authors;
    for (const { author, result } of shown)
      lines.push(...resultLines(author, result), '');
    if (shown.length < count) {
      lines.push(
        `  (showing top ${shown.length} of ${count} authors)`,
        `  Grand total (all ${count} authors): ${formatHours(report.total.hours)}`,
        '',
      );
    }
    else {
      lines.push(`  Grand total: ${formatHours(report.total.hours)}`, '');
    }
  }
  else {
    lines.push(...resultLines('Total', report.total), '');
  }

  lines.push(...compareLines(report));
  if (report.daily)
    lines.push(...dailyLines(report.daily));
  if (report.heatmap)
    lines.push(...heatmapLines(report.heatmap));

  return `${lines.join('\n')}\n`;
}
