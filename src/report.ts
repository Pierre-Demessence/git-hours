import type { GroupParams, GroupResult, KeyFn } from './estimate.ts';
import type { AuthorInfo, CommitEntry, DateWindow, EstimateParams, GapInfo, RepoMode, ReportOptions, SessionResult } from './types.ts';
import { attributeGroups, byAuthor, byRepo, computeDailyBreakdown, dailyByGroup, estimateGroups, estimateTotal, groupBy, sumResults } from './estimate.ts';
import { dayName, isoWeekNumber } from './format.ts';
import { calibrateGap } from './gap.ts';
import { computeHeatmap } from './heatmap.ts';

// The computed result of one analysis, independent of how it is rendered.
// Renderers (text / JSON / CSV) only read from this; they never estimate.

export interface DailyRow {
  date: string;
  day: string;
  result: SessionResult;
  week: string;
}

export interface AuthorRow {
  author: string;
  // This author's own calibrated gap (auto gap only).
  gapMinutes?: number;
  result: SessionResult;
}

export interface RepoRow {
  // Per-day breakdown of this repo (only when the report has `daily`).
  daily?: DailyRow[];
  // This repo's own calibrated gap (auto gap with --independent-repos).
  gapMinutes?: number;
  name: string;
  path: string;
  result: SessionResult;
}

export interface CompareSection {
  delta: {
    commits: number;
    hours: number;
    // null when the compared window has zero hours.
    hoursPct: number | null;
  };
  total: SessionResult;
  window: DateWindow;
}

export interface Report {
  // Whose commits were counted.
  author?: AuthorInfo;
  // Present with --per-author: ranked authors (limited by --top) and how many exist.
  authors?: { count: number; shown: AuthorRow[] };
  compare?: CompareSection;
  // The config file that was applied, if any.
  configPath?: string;
  daily?: DailyRow[];
  heatmap?: number[][];
  params: EstimateParams & { gap: GapInfo };
  // Present with --scan: repos with activity, ranked (limited by --top).
  repos?: {
    // Repos with at least one commit in the window.
    active: number;
    mode: RepoMode;
    roots: string[];
    // Repos found by the scan.
    scanned: number;
    shown: RepoRow[];
  };
  total: SessionResult;
  window: DateWindow;
}

export interface WindowCommits {
  commits: CommitEntry[];
  window: DateWindow;
}

export interface ScanInput {
  repos: { name: string; path: string }[];
  roots: string[];
}

export interface ReportInput extends WindowCommits {
  author?: AuthorInfo;
  // Commits to calibrate the gap on (same filters, longer history), and the
  // time calibration looks back from. Default: the window's own commits and
  // end.
  calibration?: { commits: CommitEntry[]; until: number };
  compare?: WindowCommits;
  configPath?: string;
  // Present with --scan; commits then carry their `repo` name.
  scan?: ScanInput;
}

function toDailyRows(days: Map<string, SessionResult>): DailyRow[] {
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, result]) => ({ date, day: dayName(date), result, week: isoWeekNumber(date) }));
}

interface Calibrated {
  info: GapInfo;
  params: EstimateParams;
  perGroup?: GroupParams;
}

// Decide the session gap: fixed, or learned from the calibration commits.
// With a grouping (per author, per independent repo) each group gets its
// own gap, falling back to the overall one when it has too little history.
function calibrate(input: ReportInput, opts: ReportOptions, groupKey?: KeyFn): Calibrated {
  const firstCommitMinutes = opts.firstCommitMinutes;
  if (opts.gapMinutes !== undefined) {
    return {
      info: { perGroup: false, sampleGaps: 0, source: 'fixed' },
      params: { firstCommitMinutes, gapMinutes: opts.gapMinutes },
    };
  }

  const commits = input.calibration?.commits ?? input.commits;
  const until = input.calibration?.until
    ?? input.window.until
    ?? input.commits.reduce((max, c) => Math.max(max, c.timestamp), 0) + 1;
  const overall = calibrateGap(commits.map(c => c.timestamp), until);
  const params = { firstCommitMinutes, gapMinutes: overall.gapMinutes };
  const info: GapInfo = {
    from: overall.from,
    perGroup: groupKey !== undefined,
    sampleGaps: overall.sampleGaps,
    source: overall.source,
    until: overall.until,
  };
  if (!groupKey)
    return { info, params };

  const perGroup: GroupParams = new Map();
  for (const [key, list] of groupBy(commits, groupKey)) {
    const own = calibrateGap(list.map(c => c.timestamp), until);
    perGroup.set(key, { firstCommitMinutes, gapMinutes: own.source === 'auto' ? own.gapMinutes : overall.gapMinutes });
  }
  return { info, params, perGroup };
}

export function buildReport(input: ReportInput, opts: ReportOptions): Report {
  const { commits, scan } = input;

  // Groups estimated independently and summed. Per author always; per repo
  // only in independent mode (shared mode is one timeline: no grouping).
  const independentKey: KeyFn | undefined = opts.perAuthor
    ? byAuthor
    : scan && opts.repoMode === 'independent' ? byRepo : undefined;

  // The gap is decided once, from history ending with the main window, and
  // reused for the compared window so both use the same yardstick.
  const { info, params, perGroup } = calibrate(input, opts, independentKey);
  const gapOf = (key: string) => (perGroup ? (perGroup.get(key) ?? params).gapMinutes : undefined);

  const report: Report = {
    author: input.author,
    configPath: input.configPath,
    params: { ...params, gap: info },
    total: estimateTotal(commits, params, independentKey, perGroup),
    window: input.window,
  };

  if (opts.perAuthor) {
    const ranked = estimateGroups(commits, params, byAuthor, perGroup);
    report.authors = {
      count: ranked.length,
      shown: (opts.top ? ranked.slice(0, opts.top) : ranked).map(({ key, result }) => ({ author: key, gapMinutes: gapOf(key), result })),
    };
    // The total always covers every author; --top only limits the listing.
    report.total = sumResults(ranked.map(a => a.result));
  }

  if (scan) {
    const shared = opts.repoMode === 'shared';
    const ranked: GroupResult[] = shared
      ? attributeGroups(commits, params, byRepo)
      : estimateGroups(commits, params, byRepo, perGroup);
    const paths = new Map(scan.repos.map(r => [r.name, r.path]));
    const repoDaily = opts.daily ? dailyByGroup(commits, params, byRepo, shared, perGroup) : undefined;
    report.repos = {
      active: ranked.length,
      mode: opts.repoMode,
      roots: scan.roots,
      scanned: scan.repos.length,
      shown: (opts.top ? ranked.slice(0, opts.top) : ranked).map(({ key, result }) => ({
        daily: repoDaily ? toDailyRows(repoDaily.get(key) ?? new Map()) : undefined,
        gapMinutes: shared ? undefined : gapOf(key),
        name: key,
        path: paths.get(key) ?? key,
        result,
      })),
    };
  }

  if (opts.daily)
    report.daily = toDailyRows(computeDailyBreakdown(commits, params, independentKey, perGroup));

  if (opts.heatmap)
    report.heatmap = computeHeatmap(commits);

  if (input.compare) {
    const other = estimateTotal(input.compare.commits, params, independentKey, perGroup);
    report.compare = {
      delta: {
        commits: report.total.commits - other.commits,
        hours: report.total.hours - other.hours,
        hoursPct: other.hours === 0 ? null : ((report.total.hours - other.hours) / other.hours) * 100,
      },
      total: other,
      window: input.compare.window,
    };
  }

  return report;
}
