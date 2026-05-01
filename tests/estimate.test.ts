import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeDailyBreakdown, estimateHours } from '../src/estimate.ts';
import type { CommitEntry, Options } from '../src/types.ts';

const baseOpts: Options = {
  allAuthors: false,
  firstCommitMinutes: 30,
  gapMinutes: 120,
};

function commit(timestamp: number, author = 'a', message = 'm'): CommitEntry {
  return { author, message, timestamp };
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
