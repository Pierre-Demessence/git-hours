import type { CommitEntry, Options, SessionResult } from './types.ts';
import process from 'node:process';
import { computeDailyBreakdown, estimatePerAuthor, estimateTotal } from './estimate.ts';
import { dayName, isoWeekNumber } from './format.ts';
import { computeHeatmap } from './heatmap.ts';

interface JsonResult {
  commits: number;
  firstCommit: string | null;
  hours: number;
  lastCommit: string | null;
  sessions: number;
}

function toJsonResult(r: SessionResult): JsonResult {
  return {
    commits: r.commits,
    firstCommit: r.firstCommit?.toISOString() ?? null,
    hours: Number(r.hours.toFixed(4)),
    lastCommit: r.lastCommit?.toISOString() ?? null,
    sessions: r.sessions,
  };
}

export function buildJsonPayload(commits: CommitEntry[], opts: Options): Record<string, unknown> {
  const total = estimateTotal(commits, opts);
  const payload: Record<string, unknown> = {
    range: { since: opts.since ?? null, until: opts.until ?? null },
    params: {
      autoGap: opts.autoGap,
      firstCommitMinutes: opts.firstCommitMinutes,
      gapMinutes: opts.gapMinutes,
    },
    total: toJsonResult(total),
  };

  if (opts.allAuthors) {
    const ranked = estimatePerAuthor(commits, opts)
      .map(({ author, result }) => ({ author, ...toJsonResult(result) }));
    payload.perAuthor = opts.top ? ranked.slice(0, opts.top) : ranked;
    payload.totalAuthors = ranked.length;
  }

  if (opts.daily) {
    const daily = computeDailyBreakdown(commits, opts);
    payload.daily = [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, r]) => ({
        commits: r.commits,
        date,
        day: dayName(date),
        hours: Number(r.hours.toFixed(4)),
        sessions: r.sessions,
        week: isoWeekNumber(date),
      }));
  }

  if (opts.heatmap)
    payload.byHourDayOfWeek = computeHeatmap(commits);

  return payload;
}

export function formatCsv(commits: CommitEntry[], opts: Options): string {
  const lines = ['date,day,week,hours,commits,sessions'];
  if (commits.length === 0)
    return `${lines[0]}\n`;
  const daily = computeDailyBreakdown(commits, opts);
  const rows = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [date, r] of rows)
    lines.push(`${date},${dayName(date)},${isoWeekNumber(date)},${r.hours.toFixed(4)},${r.commits},${r.sessions}`);
  return `${lines.join('\n')}\n`;
}

export function printJson(commits: CommitEntry[], opts: Options): void {
  console.log(JSON.stringify(buildJsonPayload(commits, opts)));
}

export function printCsv(commits: CommitEntry[], opts: Options): void {
  process.stdout.write(formatCsv(commits, opts));
}
