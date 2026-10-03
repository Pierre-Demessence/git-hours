import type { Report } from '../report.ts';

export const CSV_HEADER = 'date,day,week,hours,commits,sessions';

// RFC 4180: quote a field containing a comma, quote or newline.
export function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// The daily breakdown as CSV (the report must have been built with `daily`).
// With --scan: one row per project, or per project per day with --daily.
export function renderCsv(report: Report): string {
  if (report.repos) {
    if (report.daily) {
      const lines = ['date,day,week,project,hours,commits,sessions'];
      const rows = report.repos.shown.flatMap(r => (r.daily ?? []).map(d => ({ ...d, project: r.name })));
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.project.localeCompare(b.project));
      for (const { date, day, project, result, week } of rows)
        lines.push(`${date},${day},${week},${csvField(project)},${result.hours.toFixed(4)},${result.commits},${result.sessions}`);
      return `${lines.join('\n')}\n`;
    }
    const lines = ['project,path,hours,commits,sessions,firstCommit,lastCommit'];
    for (const { name, path, result } of report.repos.shown) {
      lines.push([
        csvField(name),
        csvField(path),
        result.hours.toFixed(4),
        result.commits,
        result.sessions,
        result.firstCommit?.toISOString() ?? '',
        result.lastCommit?.toISOString() ?? '',
      ].join(','));
    }
    return `${lines.join('\n')}\n`;
  }

  const lines = [CSV_HEADER];
  for (const { date, day, result, week } of report.daily ?? [])
    lines.push(`${date},${day},${week},${result.hours.toFixed(4)},${result.commits},${result.sessions}`);
  return `${lines.join('\n')}\n`;
}
