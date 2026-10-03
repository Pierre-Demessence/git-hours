import type { Report } from '../report.ts';

export const CSV_HEADER = 'date,day,week,hours,commits,sessions';

// The daily breakdown as CSV (the report must have been built with `daily`).
export function renderCsv(report: Report): string {
  const lines = [CSV_HEADER];
  for (const { date, day, result, week } of report.daily ?? [])
    lines.push(`${date},${day},${week},${result.hours.toFixed(4)},${result.commits},${result.sessions}`);
  return `${lines.join('\n')}\n`;
}
