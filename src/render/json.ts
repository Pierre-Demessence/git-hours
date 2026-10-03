import type { DailyRow, Report } from '../report.ts';
import type { DateWindow, SessionResult } from '../types.ts';
import { toLocalGitDate } from '../dates.ts';

const round = (n: number) => Number(n.toFixed(4));

function jsonResult(r: SessionResult) {
  return {
    commits: r.commits,
    firstCommit: r.firstCommit?.toISOString() ?? null,
    hours: round(r.hours),
    lastCommit: r.lastCommit?.toISOString() ?? null,
    sessions: r.sessions,
  };
}

function jsonRange(w: DateWindow) {
  const bound = (t: number | null) => (t === null ? null : toLocalGitDate(new Date(t)));
  return { label: w.label, since: bound(w.since), until: bound(w.until) };
}

function jsonDailyRow({ date, day, result, week }: DailyRow) {
  return {
    commits: result.commits,
    date,
    day,
    hours: round(result.hours),
    sessions: result.sessions,
    week,
  };
}

export function buildJson(report: Report): Record<string, unknown> {
  const { gap, ...params } = report.params;
  const iso = (t: number | undefined) => (t === undefined ? undefined : new Date(t).toISOString());
  const payload: Record<string, unknown> = {
    range: jsonRange(report.window),
    params: { ...params, gap: { ...gap, from: iso(gap.from), until: iso(gap.until) } },
    total: jsonResult(report.total),
  };
  if (report.author)
    payload.author = report.author;
  if (report.configPath)
    payload.config = report.configPath;

  if (report.authors) {
    payload.perAuthor = report.authors.shown.map(({ author, gapMinutes, result }) => ({ author, ...jsonResult(result), ...(gapMinutes !== undefined ? { gapMinutes } : {}) }));
    payload.totalAuthors = report.authors.count;
  }

  if (report.repos) {
    const { active, mode, roots, scanned, shown } = report.repos;
    payload.scan = { activeRepos: active, mode, roots, scannedRepos: scanned };
    payload.perRepo = shown.map(({ daily, gapMinutes, name, path, result }) => ({
      name,
      path,
      ...jsonResult(result),
      ...(gapMinutes !== undefined ? { gapMinutes } : {}),
      ...(daily ? { daily: daily.map(jsonDailyRow) } : {}),
    }));
  }

  if (report.daily)
    payload.daily = report.daily.map(jsonDailyRow);

  if (report.heatmap)
    payload.byHourDayOfWeek = report.heatmap;

  if (report.compare) {
    const { delta, total, window } = report.compare;
    payload.compare = {
      range: jsonRange(window),
      total: jsonResult(total),
      delta: {
        commits: delta.commits,
        hours: round(delta.hours),
        hoursPct: delta.hoursPct === null ? null : round(delta.hoursPct),
      },
    };
  }

  return payload;
}

export function renderJson(report: Report): string {
  return `${JSON.stringify(buildJson(report))}\n`;
}
