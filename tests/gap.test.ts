import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateHours } from '../src/estimate.ts';
import { calibrateGap, CALIBRATION_MS, DEFAULT_GAP, MIN_GAPS, sameDayGaps, selectGaps } from '../src/gap.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// Deterministic pseudo-random numbers (LCG) so the tests are reproducible.
function rng(seed: number) {
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12))) * Math.cos(2 * Math.PI * next());
  return { normal, uniform: (a: number, b: number) => a + next() * (b - a), next };
}

interface Profile {
  // In-session gap: median minutes and log-spread.
  within: [number, number];
  sessionMinutes: [number, number];
  sessionsPerDay: [number, number];
  breakMinutes: [number, number];
  workdayRate: number;
}

// A year of commits for a work pattern; returns timestamps (ms).
function simulate(p: Profile, seed: number, days = 365): number[] {
  const r = rng(seed);
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    if (r.next() > p.workdayRate)
      continue;
    let t = d * 1440 + r.uniform(480, 600);
    const sessions = Math.round(r.uniform(...p.sessionsPerDay));
    for (let s = 0; s < sessions; s++) {
      const end = t + r.uniform(...p.sessionMinutes);
      while (t < end) {
        out.push(t * MIN);
        t += p.within[0] * Math.exp(p.within[1] * r.normal());
      }
      t += r.uniform(...p.breakMinutes);
    }
  }
  return out;
}

const until = (ts: number[]) => ts[ts.length - 1] + 1;

describe('sameDayGaps / selectGaps', () => {
  it('keeps gaps between 30s and 8h', () => {
    const ts = [0, 10 * 1000, 5 * MIN, 9 * 60 * MIN, 9 * 60 * MIN + 30 * MIN];
    assert.deepEqual(sameDayGaps(ts).map(g => Math.round(g.minutes)), [5, 30]);
  });

  it('uses the last 12 months when they have enough gaps, else the most recent ones', () => {
    const old = Array.from({ length: MIN_GAPS }, (_, i) => ({ end: i * MIN, minutes: 5 }));
    const end = 2 * CALIBRATION_MS;
    const recent = Array.from({ length: MIN_GAPS + 10 }, (_, i) => ({ end: end - (i + 1) * MIN, minutes: 5 })).reverse();
    assert.equal(selectGaps([...old, ...recent], end).length, MIN_GAPS + 10);
    // Too few recent gaps: the most recent MIN_GAPS, reaching into older history.
    const sparse = selectGaps([...old, ...recent.slice(0, 10)], end);
    assert.equal(sparse.length, MIN_GAPS);
    assert.equal(sparse[sparse.length - 1], recent[9]);
  });

  it('ignores gaps after `until`', () => {
    const gaps = Array.from({ length: 10 }, (_, i) => ({ end: i, minutes: 5 }));
    assert.equal(selectGaps(gaps, 5).length, 5);
  });
});

describe('calibrateGap', () => {
  it('falls back to the default with too little history', () => {
    const ts = Array.from({ length: 100 }, (_, i) => i * 10 * MIN);
    assert.deepEqual(calibrateGap(ts, until(ts)), { gapMinutes: DEFAULT_GAP, sampleGaps: 0, source: 'default' });
  });

  it('is deterministic and reports what it learned from', () => {
    const ts = simulate({ breakMinutes: [45, 120], sessionMinutes: [60, 180], sessionsPerDay: [2, 3], within: [15, 0.7], workdayRate: 0.8 }, 1);
    const a = calibrateGap(ts, until(ts));
    assert.deepEqual(calibrateGap(ts, until(ts)), a);
    assert.equal(a.source, 'auto');
    assert.ok(a.sampleGaps >= MIN_GAPS);
    assert.ok(a.from! < a.until!);
    assert.equal(a.gapMinutes % 5, 0);
  });

  // Each profile: the range of gaps that classify sessions well for it
  // (measured against the simulation's ground truth).
  const profiles: [string, Profile, [number, number]][] = [
    ['steady (15 min commits, 45-120 min breaks)', { breakMinutes: [45, 120], sessionMinutes: [60, 180], sessionsPerDay: [2, 3], within: [15, 0.7], workdayRate: 0.8 }, [50, 90]],
    ['bursty (3 min commits, 30-90 min breaks)', { breakMinutes: [30, 90], sessionMinutes: [30, 120], sessionsPerDay: [2, 4], within: [3, 1], workdayRate: 0.7 }, [30, 50]],
    ['meetings (20 min commits, 30-60 min breaks)', { breakMinutes: [30, 60], sessionMinutes: [40, 120], sessionsPerDay: [3, 5], within: [20, 0.9], workdayRate: 0.85 }, [40, 75]],
    ['evenings (one session a day)', { breakMinutes: [0, 0], sessionMinutes: [45, 150], sessionsPerDay: [1, 1], within: [10, 0.9], workdayRate: 0.4 }, [40, 240]],
  ];
  for (const [name, profile, [lo, hi]] of profiles) {
    it(`finds a sensible gap: ${name}`, () => {
      for (const seed of [1, 7, 42]) {
        const ts = simulate(profile, seed);
        const { gapMinutes } = calibrateGap(ts, until(ts));
        assert.ok(gapMinutes >= lo && gapMinutes <= hi, `seed ${seed}: ${gapMinutes} not in [${lo}, ${hi}]`);
      }
    });
  }

  // Recalibrating every month moves the gap a little (sampling noise of the
  // trailing 12 months); what matters is that the hours barely move.
  it('gives stable hours from one month to the next', () => {
    const profile: Profile = { breakMinutes: [45, 120], sessionMinutes: [60, 180], sessionsPerDay: [2, 3], within: [15, 0.7], workdayRate: 0.8 };
    const ts = simulate(profile, 3, 730);
    const month = ts.filter(t => t >= 400 * DAY && t < 430 * DAY).map(timestamp => ({ author: 'a', email: 'a', message: '', timestamp }));
    const hours = Array.from({ length: 12 }, (_, m) => {
      const { gapMinutes } = calibrateGap(ts, 365 * DAY + m * 30 * DAY);
      return estimateHours(month, { firstCommitMinutes: 30, gapMinutes }).hours;
    });
    const spread = (Math.max(...hours) - Math.min(...hours)) / Math.min(...hours);
    assert.ok(spread < 0.05, `hours ${hours.map(h => h.toFixed(1)).join(', ')}`);
  });
});
