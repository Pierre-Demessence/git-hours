import type { CommitEntry, EstimateParams } from '../src/types.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attributeGroups, byAuthor, byRepo, computeDailyBreakdown, dailyByGroup, estimateGroups, estimateHours, estimateTotal, pickAutoGap } from '../src/estimate.ts';

const baseOpts: EstimateParams = {
  firstCommitMinutes: 30,
  gapMinutes: 120,
};

function commit(timestamp: number, author = 'a', message = 'm'): CommitEntry {
  return { author, email: `${author}@example.com`, message, timestamp };
}

const sumHours = (m: Map<string, { hours: number }>) => [...m.values()].reduce((s, r) => s + r.hours, 0);

function inRepo(repo: string, timestamp: number): CommitEntry {
  return { author: 'me', email: 'me@x', message: 'm', repo, timestamp };
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
    const opts: EstimateParams = { gapMinutes: 30, firstCommitMinutes: 10 };
    // Two commits 45min apart with 30min gap → two sessions, 10+10 = 20min
    const r = estimateHours([commit(0), commit(45 * 60 * 1000)], opts);
    assert.equal(r.sessions, 2);
    assert.equal(r.hours, 20 / 60);
  });

  it('sorts commits before estimating', () => {
    const r = estimateHours([commit(60 * 60 * 1000), commit(0)], baseOpts);
    assert.equal(r.firstCommit?.getTime(), 0);
    assert.equal(r.lastCommit?.getTime(), 60 * 60 * 1000);
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

  // Regression: days used to be estimated independently, so a session crossing
  // midnight got the first-commit credit twice and lost the elapsed time.
  it('splits a session crossing midnight and sums to the total', () => {
    const commits = [commit(new Date(2025, 2, 5, 23, 30).getTime()), commit(new Date(2025, 2, 6, 0, 30).getTime())];
    const daily = computeDailyBreakdown(commits, baseOpts);
    assert.equal(daily.get('2025-03-05')?.hours, 1); // 30min credit + 30min to midnight
    assert.equal(daily.get('2025-03-06')?.hours, 0.5); // 30min after midnight
    assert.equal(daily.get('2025-03-05')?.sessions, 1);
    assert.equal(daily.get('2025-03-06')?.sessions, 0);
    assert.equal(sumHours(daily), estimateHours(commits, baseOpts).hours);
  });

  it('sums to the per-author total with --all-authors', () => {
    const t = new Date(2025, 2, 5, 9).getTime();
    const min = 60_000;
    const commits = [commit(t, 'a'), commit(t + 10 * min, 'b'), commit(t + 50 * min, 'a'), commit(t + 70 * min, 'b')];
    assert.ok(Math.abs(sumHours(computeDailyBreakdown(commits, baseOpts, byAuthor)) - estimateTotal(commits, baseOpts, byAuthor).hours) < 1e-9);
  });
});

describe('estimateTotal', () => {
  it('sums per-author estimates with --all-authors', () => {
    const t = new Date(2025, 2, 5, 9).getTime();
    const min = 60_000;
    // Interleaved: merged as one stream it would be 30 + 60 = 90min; per author
    // it is (30 + 60) + (30 + 60) = 180min of person-time.
    const commits = [commit(t, 'a'), commit(t + 10 * min, 'b'), commit(t + 60 * min, 'a'), commit(t + 70 * min, 'b')];
    const r = estimateTotal(commits, baseOpts, byAuthor);
    assert.equal(r.hours, 3);
    assert.equal(r.commits, 4);
    assert.equal(r.sessions, 2);
    assert.equal(r.firstCommit?.getTime(), t);
    assert.equal(r.lastCommit?.getTime(), t + 70 * min);
  });

  it('matches estimateHours without --all-authors', () => {
    const commits = [commit(0, 'a'), commit(60_000, 'b')];
    assert.deepEqual(estimateTotal(commits, baseOpts), estimateHours(commits, baseOpts));
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

describe('repo attribution', () => {
  const MIN = 60_000;
  const T = new Date(2025, 2, 5, 9).getTime();
  // One session hopping between repos: A 09:00, B 09:30, A 10:00.
  const commits = [inRepo('A', T), inRepo('B', T + 30 * MIN), inRepo('A', T + 60 * MIN)];

  it('shared: credits each span to the repo of the commit ending it, summing to the total', () => {
    const groups = attributeGroups(commits, baseOpts, byRepo);
    const hours = Object.fromEntries(groups.map(g => [g.key, g.result.hours]));
    assert.deepEqual(hours, { A: 1, B: 0.5 }); // A: 30 credit + 30; B: 30
    assert.equal(groups.find(g => g.key === 'A')?.result.sessions, 1);
    assert.equal(groups.find(g => g.key === 'B')?.result.sessions, 0);
    assert.equal(groups.reduce((s, g) => s + g.result.hours, 0), estimateHours(commits, baseOpts).hours);
  });

  it('independent: estimates each repo on its own (overlap counted per repo)', () => {
    const hours = Object.fromEntries(estimateGroups(commits, baseOpts, byRepo).map(g => [g.key, g.result.hours]));
    assert.deepEqual(hours, { A: 1.5, B: 0.5 });
    assert.equal(estimateTotal(commits, baseOpts, byRepo).hours, 2);
  });

  it('per-repo daily breakdowns sum to each repo total, in both modes', () => {
    for (const shared of [true, false]) {
      const daily = dailyByGroup(commits, baseOpts, byRepo, shared);
      const groups = shared ? attributeGroups(commits, baseOpts, byRepo) : estimateGroups(commits, baseOpts, byRepo);
      for (const g of groups)
        assert.equal(sumHours(daily.get(g.key)!), g.result.hours);
    }
  });
});
