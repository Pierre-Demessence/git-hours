// Automatic session-gap calibration.
//
// The time between two consecutive commits is either *inside* a session
// (minutes) or a *break* (lunch, meetings, nights). On a log scale the
// same-day gaps form a large in-session group and a smaller group of breaks;
// the gap threshold should separate the two.
//
// Method (chosen by simulating several work patterns against a known ground
// truth; see the README):
// 1. Use same-day gaps only (30s..8h). Nights and weekends carry no
//    information about where a session ends, and would otherwise swamp the
//    "break" group.
// 2. Fit a two-component Gaussian mixture to the log gaps. When the two
//    components are clearly separated (Ashman's D > 2), the threshold is
//    where both are equally likely.
// 3. Otherwise model the in-session gaps alone from the lower half of the
//    data (least contaminated by breaks) as log-normal, and put the threshold
//    two standard deviations above their median.
// 4. Clamp to [30, 240] minutes and round up to a multiple of 5.
//
// Calibration needs MIN_GAPS same-day gaps; with fewer, DEFAULT_GAP is used.

// Used without enough history. Lower than the traditional 120: in the
// simulations a fixed 60-90 minutes was markedly closer to the truth (120
// counts most lunch and meeting breaks as work), and 90 stays safe for
// one-session-a-day histories, which are the ones most likely to be sparse.
export const DEFAULT_GAP = 90;
export const MIN_GAPS = 500;
const MIN_GAP_MINUTES = 0.5;
const MAX_GAP_MINUTES = 8 * 60;
const CLAMP: [number, number] = [30, 240];
// How far back calibration looks when there is enough history.
export const CALIBRATION_MS = 365 * 24 * 60 * 60 * 1000;

export interface GapCalibration {
  gapMinutes: number;
  // Number of same-day gaps the value was learned from (0 for the default).
  sampleGaps: number;
  source: 'auto' | 'default';
  // Time span of the gaps used (epoch ms), when auto.
  from?: number;
  until?: number;
}

interface Gap {
  end: number;
  minutes: number;
}

// Same-day gaps between consecutive commits (any order in, sorted inside).
export function sameDayGaps(timestamps: number[]): Gap[] {
  const sorted = [...timestamps].sort((a, b) => a - b);
  const gaps: Gap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const minutes = (sorted[i] - sorted[i - 1]) / 60_000;
    if (minutes >= MIN_GAP_MINUTES && minutes <= MAX_GAP_MINUTES)
      gaps.push({ end: sorted[i], minutes });
  }
  return gaps;
}

// The gaps to learn from: those of the CALIBRATION_MS before `until`, or
// the most recent MIN_GAPS before `until` when that period has too few.
export function selectGaps(gaps: Gap[], until: number): Gap[] {
  const before = gaps.filter(g => g.end < until);
  const recent = before.filter(g => g.end >= until - CALIBRATION_MS);
  return recent.length >= MIN_GAPS ? recent : before.slice(-MIN_GAPS);
}

function clampGap(minutes: number): number {
  return Math.max(CLAMP[0], Math.min(CLAMP[1], Math.ceil(minutes / 5) * 5));
}

function normalPdf(z: number, mu: number, variance: number) {
  return Math.exp(-((z - mu) ** 2) / (2 * variance)) / Math.sqrt(2 * Math.PI * variance);
}

// Two-component Gaussian mixture fitted by EM, from a deterministic start.
// Returns the threshold between the components and their separation.
function mixtureThreshold(x: number[]): { separation: number; threshold: number } {
  const n = x.length;
  let mu = [x[Math.floor(n * 0.25)], x[Math.floor(n * 0.9)]];
  let variance = [1, 1];
  let weight = [0.5, 0.5];
  for (let iter = 0; iter < 200; iter++) {
    const r = x.map((z) => {
      const a = weight[0] * normalPdf(z, mu[0], variance[0]);
      const b = weight[1] * normalPdf(z, mu[1], variance[1]);
      return a + b > 0 ? a / (a + b) : 0.5;
    });
    const n0 = r.reduce((s, q) => s + q, 0);
    const n1 = n - n0;
    if (n0 < 1 || n1 < 1)
      break;
    const next = [
      x.reduce((s, z, i) => s + r[i] * z, 0) / n0,
      x.reduce((s, z, i) => s + (1 - r[i]) * z, 0) / n1,
    ];
    variance = [
      Math.max(0.01, x.reduce((s, z, i) => s + r[i] * (z - next[0]) ** 2, 0) / n0),
      Math.max(0.01, x.reduce((s, z, i) => s + (1 - r[i]) * (z - next[1]) ** 2, 0) / n1),
    ];
    weight = [n0 / n, n1 / n];
    const converged = Math.abs(next[0] - mu[0]) + Math.abs(next[1] - mu[1]) < 1e-6;
    mu = next;
    if (converged)
      break;
  }
  const [lo, hi] = mu[0] <= mu[1] ? [0, 1] : [1, 0];
  // Walk from the lower mean up to the point where the upper component wins.
  let threshold = (mu[lo] + mu[hi]) / 2;
  for (let z = mu[lo]; z <= mu[hi]; z += 0.01) {
    if (weight[hi] * normalPdf(z, mu[hi], variance[hi]) >= weight[lo] * normalPdf(z, mu[lo], variance[lo])) {
      threshold = z;
      break;
    }
  }
  const separation = Math.SQRT2 * Math.abs(mu[hi] - mu[lo]) / Math.sqrt(variance[0] + variance[1]);
  return { separation, threshold };
}

// In-session gaps modelled from the lower half: median + 2 sigma.
function tailThreshold(x: number[]): number {
  const q = (p: number) => x[Math.min(x.length - 1, Math.floor(p * x.length))];
  const median = q(0.5);
  const sigma = Math.max(0.2, (median - q(0.25)) / 0.6745);
  return median + 2 * sigma;
}

// Learn the gap from `timestamps` (all the commits to calibrate on), looking
// back from `until`.
export function calibrateGap(timestamps: number[], until: number): GapCalibration {
  const gaps = selectGaps(sameDayGaps(timestamps), until);
  if (gaps.length < MIN_GAPS)
    return { gapMinutes: DEFAULT_GAP, sampleGaps: 0, source: 'default' };

  const x = gaps.map(g => Math.log(g.minutes)).sort((a, b) => a - b);
  const mixture = mixtureThreshold(x);
  const threshold = mixture.separation > 2 ? mixture.threshold : tailThreshold(x);
  return {
    from: gaps[0].end,
    gapMinutes: clampGap(Math.exp(threshold)),
    sampleGaps: gaps.length,
    source: 'auto',
    until: gaps[gaps.length - 1].end,
  };
}
