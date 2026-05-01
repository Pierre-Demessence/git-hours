import { dateKey } from './format.ts';
import type { CommitEntry, Options, SessionResult } from './types.ts';

export function estimateHours(commits: CommitEntry[], opts: Options): SessionResult {
  if (commits.length === 0) {
    return { commits: 0, firstCommit: new Date(), hours: 0, lastCommit: new Date(), sessions: 0 };
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
