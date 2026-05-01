import type { CommitEntry, Options } from '../src/types.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeDailyBreakdown, estimateHours, pickAutoGap } from '../src/estimate.ts';

const baseOpts: Options = {
  allAuthors: false,
  allBranches: false,
  autoGap: false,
  daily: false,
  excludeAuthor: [],
  firstCommitMinutes: 30,
  format: 'text',
  gapMinutes: 120,
  heatmap: false,
};

function commit(timestamp: number, author = 'a', message = 'm'): CommitEntry {
  return { author, email: `${author}@example.com`, message, timestamp };
}

describe('estimateHours', () => {
  it('returns zero for empty input', () => {
    const r = estimateHours([], baseOpts);
    assert.equal(r.commits, 0);
    assert.equal(r.hours, 0);
    assert.equal(r.sessions, 0);
  });

  it('credits firstCommitMinutes for a single commit', () => {
    const r = estimateHours([commit(0)], baseOpts);
    assert.equal(r.commits, 1);
    assert.equal(r.sessions, 1);
    assert.equal(r.hours, 0.5);
  });

  it('sums elapsed time within the gap threshold', () => {
    // Two commits 1h apart → 30min credit + 1h elapsed = 1h30
    const r = estimateHours([commit(0), commit(60 * 60 * 1000)], baseOpts);
    assert.equal(r.sessions, 1);
    assert.equal(r.hours, 1.5);
  });

  it('starts a new session past the gap threshold', () => {
    // Two commits 3h apart with 2h gap → two sessions, 30+30 = 1h
    const r = estimateHours([commit(0), commit(3 * 60 * 60 * 1000)], baseOpts);
    assert.equal(r.sessions, 2);
    assert.equal(r.hours, 1);
  });

  it('respects custom gap and first-commit values', () => {
    const opts: Options = { ...baseOpts, gapMinutes: 30, firstCommitMinutes: 10 };
    // Two commits 45min apart with 30min gap → two sessions, 10+10 = 20min
    const r = estimateHours([commit(0), commit(45 * 60 * 1000)], opts);
    assert.equal(r.sessions, 2);
    assert.equal(r.hours, 20 / 60);
  });

  it('sorts commits before estimating', () => {
    const r = estimateHours([commit(60 * 60 * 1000), commit(0)], baseOpts);
    assert.equal(r.firstCommit.getTime(), 0);
    assert.equal(r.lastCommit.getTime(), 60 * 60 * 1000);
  });
});

describe('computeDailyBreakdown', () => {
  it('groups commits by day and estimates each', () => {
    const day1 = new Date(2025, 2, 5, 9).getTime();
    const day2 = new Date(2025, 2, 6, 9).getTime();
    const daily = computeDailyBreakdown(
      [commit(day1), commit(day1 + 30 * 60 * 1000), commit(day2)],
      baseOpts,
    );
    assert.equal(daily.size, 2);
    assert.equal(daily.get('2025-03-05')?.commits, 2);
    assert.equal(daily.get('2025-03-06')?.commits, 1);
  });
});

describe('pickAutoGap', () => {
  const minute = 60 * 1000;

  it('falls back to 120 when too few commits', () => {
    assert.equal(pickAutoGap([]), 120);
    assert.equal(pickAutoGap([commit(0), commit(minute)]), 120);
  });

  it('falls back to 120 when too few within-session deltas', () => {
    const t = Date.now();
    const day = 24 * 60 * minute;
    assert.equal(pickAutoGap([0, 1, 2, 3, 4, 5].map(i => commit(t + i * day))), 120);
  });

  it('clamps below 60', () => {
    const t = Date.now();
    const commits = Array.from({ length: 30 }, (_, i) => commit(t + i * 5 * minute));
    assert.equal(pickAutoGap(commits), 60);
  });

  it('clamps above 240', () => {
    const t = Date.now();
    const commits = Array.from({ length: 30 }, (_, i) => commit(t + i * 350 * minute));
    assert.equal(pickAutoGap(commits), 240);
  });

  it('rounds up to nearest 5 within range', () => {
    const t = Date.now();
    const deltas = [10, 12, 15, 20, 25, 30, 40, 50, 60, 90, 120, 150];
    const ts: number[] = [t];
    for (const d of deltas)
      ts.push(ts[ts.length - 1] + d * minute);
    const gap = pickAutoGap(ts.map(x => commit(x)));
    assert.equal(gap % 5, 0);
    assert.ok(gap >= 60 && gap <= 240);
  });
});
