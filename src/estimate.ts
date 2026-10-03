import type { CommitEntry, Options, SessionResult } from './types.ts';
import { dateKey } from './format.ts';

// Auto-pick a session gap from the commit cadence: P90 of inter-commit deltas
// that are <= 6h (those are presumed within-session). Clamped to [60, 240]
// minutes and rounded up to the nearest 5. Falls back to 120 when there isn't
// enough signal.
export function pickAutoGap(commits: CommitEntry[]): number {
  if (commits.length < 6)
    return 120;
  const sorted = [...commits].sort((a, b) => a.timestamp - b.timestamp);
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const minutes = (sorted[i].timestamp - sorted[i - 1].timestamp) / 60_000;
    if (minutes > 0 && minutes <= 360)
      deltas.push(minutes);
  }
  if (deltas.length < 5)
    return 120;
  deltas.sort((a, b) => a - b);
  const p90 = deltas[Math.floor(deltas.length * 0.9)];
  const rounded = Math.ceil(p90 / 5) * 5;
  return Math.max(60, Math.min(240, rounded));
}

export function estimateHours(commits: CommitEntry[], opts: Options): SessionResult {
  if (commits.length === 0) {
    return { commits: 0, firstCommit: null, hours: 0, lastCommit: null, sessions: 0 };
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

export function groupByAuthor(commits: CommitEntry[]): Map<string, CommitEntry[]> {
  const byAuthor = new Map<string, CommitEntry[]>();
  for (const c of commits) {
    const key = `${c.author} <${c.email}>`;
    const list = byAuthor.get(key) ?? [];
    list.push(c);
    byAuthor.set(key, list);
  }
  return byAuthor;
}

export interface AuthorResult {
  author: string;
  result: SessionResult;
}

// Per-author estimates, ranked by hours descending.
export function estimatePerAuthor(commits: CommitEntry[], opts: Options): AuthorResult[] {
  return [...groupByAuthor(commits).entries()]
    .map(([author, list]) => ({ author, result: estimateHours(list, opts) }))
    .sort((a, b) => b.result.hours - a.result.hours);
}

function emptyResult(): SessionResult {
  return { commits: 0, firstCommit: null, hours: 0, lastCommit: null, sessions: 0 };
}

function minDate(a: Date | null, b: Date | null): Date | null {
  if (!a || !b)
    return a ?? b;
  return a.getTime() <= b.getTime() ? a : b;
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a || !b)
    return a ?? b;
  return a.getTime() >= b.getTime() ? a : b;
}

function addInto(target: SessionResult, r: SessionResult): void {
  target.commits += r.commits;
  target.hours += r.hours;
  target.sessions += r.sessions;
  target.firstCommit = minDate(target.firstCommit, r.firstCommit);
  target.lastCommit = maxDate(target.lastCommit, r.lastCommit);
}

export function sumResults(results: SessionResult[]): SessionResult {
  const total = emptyResult();
  for (const r of results)
    addInto(total, r);
  return total;
}

// Total for the whole selection. With --all-authors each author is estimated
// independently and summed (person-hours), so interleaved commits from
// different people are never mistaken for one continuous session.
export function estimateTotal(commits: CommitEntry[], opts: Options): SessionResult {
  if (!opts.allAuthors)
    return estimateHours(commits, opts);
  return sumResults(estimatePerAuthor(commits, opts).map(a => a.result));
}

// Per-day breakdown of a single commit stream, using the same session walk as
// estimateHours so the days always sum to the total. Elapsed time inside a
// session that crosses local midnight is split at midnight; the first-commit
// credit and the session count go to the day of the commit that opens it.
function dailyForStream(commits: CommitEntry[], opts: Options): Map<string, SessionResult> {
  const daily = new Map<string, SessionResult>();
  const bucket = (key: string): SessionResult => {
    let r = daily.get(key);
    if (!r) {
      r = emptyResult();
      daily.set(key, r);
    }
    return r;
  };
  const MS_PER_HOUR = 60 * 60 * 1000;

  const addSpan = (start: number, end: number): void => {
    let t = start;
    while (t < end) {
      const d = new Date(t);
      const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const segEnd = Math.min(end, nextMidnight);
      bucket(dateKey(t)).hours += (segEnd - t) / MS_PER_HOUR;
      t = segEnd;
    }
  };

  const sorted = [...commits].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = opts.gapMinutes * 60 * 1000;
  const firstCommitHours = opts.firstCommitMinutes / 60;

  for (let i = 0; i < sorted.length; i++) {
    const ts = sorted[i].timestamp;
    const day = bucket(dateKey(ts));
    const at = new Date(ts);
    day.commits++;
    day.firstCommit = minDate(day.firstCommit, at);
    day.lastCommit = maxDate(day.lastCommit, at);

    const prev = i > 0 ? sorted[i - 1].timestamp : null;
    if (prev === null || ts - prev > gapMs) {
      day.sessions++;
      day.hours += firstCommitHours;
    }
    else {
      addSpan(prev, ts);
    }
  }
  return daily;
}

export function computeDailyBreakdown(commits: CommitEntry[], opts: Options): Map<string, SessionResult> {
  if (!opts.allAuthors)
    return dailyForStream(commits, opts);
  const merged = new Map<string, SessionResult>();
  for (const list of groupByAuthor(commits).values()) {
    for (const [day, r] of dailyForStream(list, opts)) {
      const target = merged.get(day) ?? emptyResult();
      addInto(target, r);
      merged.set(day, target);
    }
  }
  return merged;
}
