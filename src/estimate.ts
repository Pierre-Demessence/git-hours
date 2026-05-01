import { dateKey } from './format.ts';
import type { CommitEntry, Options, SessionResult } from './types.ts';

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

export function computeDailyBreakdown(commits: CommitEntry[], opts: Options): Map<string, SessionResult> {
  const byDay = new Map<string, CommitEntry[]>();
  for (const c of commits) {
    const key = dateKey(c.timestamp);
    const list = byDay.get(key) ?? [];
    list.push(c);
    byDay.set(key, list);
  }

  const daily = new Map<string, SessionResult>();
  for (const [day, dayCommits] of byDay) {
    daily.set(day, estimateHours(dayCommits, opts));
  }
  return daily;
}
