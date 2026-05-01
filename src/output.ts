import { computeDailyBreakdown, estimateHours } from './estimate.ts';
import { dayName, isoWeekNumber } from './format.ts';
import type { CommitEntry, Options, SessionResult } from './types.ts';

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

export function printJson(commits: CommitEntry[], opts: Options): void {
  const total = estimateHours(commits, opts);
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
    const byAuthor = new Map<string, CommitEntry[]>();
    for (const c of commits) {
      const key = `${c.author} <${c.email}>`;
      const list = byAuthor.get(key) ?? [];
      list.push(c);
      byAuthor.set(key, list);
    }
    const ranked = [...byAuthor.entries()]
      .map(([author, list]) => ({ author, ...toJsonResult(estimateHours(list, opts)) }))
      .sort((a, b) => b.hours - a.hours);
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

  console.log(JSON.stringify(payload));
}

export function printCsv(commits: CommitEntry[], opts: Options): void {
  console.log('date,day,week,hours,commits,sessions');
  if (commits.length === 0)
    return;
  const daily = computeDailyBreakdown(commits, opts);
  const rows = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [date, r] of rows) {
    console.log(`${date},${dayName(date)},${isoWeekNumber(date)},${r.hours.toFixed(4)},${r.commits},${r.sessions}`);
  }
}