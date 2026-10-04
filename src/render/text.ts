import type { DailyRow, Report } from '../report.ts';
import type { AuthorInfo, SessionResult } from '../types.ts';
import { dateKey, formatDateTime, formatHours, formatSignedHours, formatTimeOfDay } from '../format.ts';

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

function repoLines(repos: NonNullable<Report['repos']>, total: SessionResult): string[] {
  const { active, mode, roots, scanned, shown } = repos;
  const lines = [`  Scanned ${scanned} ${scanned === 1 ? 'repo' : 'repos'} in ${roots.join(', ')} · ${active} with activity`];
  if (mode === 'independent')
    lines.push('  Repos estimated independently: work overlapping in time counts once per repo.');
  lines.push('');
  if (active === 0)
    return [...lines, '  No commits found', ''];

  const day = (d: Date | null) => (d ? dateKey(d.getTime()) : '—');
  const nameWidth = Math.max('Project'.length, 'Total'.length, ...shown.map(r => r.name.length));
  const SEP = '  ';
  const row = (name: string, r: SessionResult) =>
    `  ${name.padEnd(nameWidth)}${SEP}${formatHours(r.hours).padStart(8)}${SEP}${String(r.commits).padStart(7)}${SEP}${String(r.sessions).padStart(8)}${SEP}${day(r.firstCommit).padEnd(10)}${SEP}${day(r.lastCommit)}`;

  lines.push(
    `  ${'Project'.padEnd(nameWidth)}${SEP}${'Time'.padStart(8)}${SEP}${'Commits'.padStart(7)}${SEP}${'Sessions'.padStart(8)}${SEP}${'First'.padEnd(10)}${SEP}Last`,
    `  ${'─'.repeat(nameWidth)}${SEP}${'─'.repeat(8)}${SEP}${'─'.repeat(7)}${SEP}${'─'.repeat(8)}${SEP}${'─'.repeat(10)}${SEP}${'─'.repeat(10)}`,
    ...shown.map(r => row(r.name, r.result)),
    `  ${'─'.repeat(nameWidth)}${SEP}${'─'.repeat(8)}${SEP}${'─'.repeat(7)}${SEP}${'─'.repeat(8)}${SEP}${'─'.repeat(10)}${SEP}${'─'.repeat(10)}`,
    row('Total', total),
  );
  if (shown.length < active)
    lines.push(`  (showing top ${shown.length} of ${active} projects; the total covers all of them)`);
  lines.push('');
  return lines;
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

function authorLabel(author: AuthorInfo): string {
  if (author.mode === 'all' || author.patterns.length === 0)
    return 'Authors: all';
  return `Author: ${author.patterns.join(', ')}${author.mode === 'git-config' ? ' (from git config)' : ''}`;
}

export function renderText(report: Report): string {
  const { params } = report;
  const gapLabel = params.gapSource === 'default' ? `${params.gapMinutes}min (default)` : `${params.gapMinutes}min`;
  const lines = [
    '',
    `⏱  Git Hours — ${report.window.label}`,
    `   Gap threshold: ${gapLabel} | First-commit credit: ${params.firstCommitMinutes}min`,
  ];
  if (report.author)
    lines.push(`   ${authorLabel(report.author)}`);
  if (report.configPath)
    lines.push(`   Config: ${report.configPath}`);
  lines.push('');

  if (report.repos) {
    lines.push(...repoLines(report.repos, report.total));
  }
  else if (report.authors) {
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
