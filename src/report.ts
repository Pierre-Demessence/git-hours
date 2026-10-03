import type { GroupResult, KeyFn } from './estimate.ts';
import type { AuthorInfo, CommitEntry, DateWindow, EstimateParams, RepoMode, ReportOptions, SessionResult } from './types.ts';
import { attributeGroups, byAuthor, byRepo, computeDailyBreakdown, dailyByGroup, estimateGroups, estimateTotal, pickAutoGap, sumResults } from './estimate.ts';
import { dayName, isoWeekNumber } from './format.ts';
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
  result: SessionResult;
}

export interface RepoRow {
  // Per-day breakdown of this repo (only when the report has `daily`).
  daily?: DailyRow[];
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
  params: EstimateParams & { autoGap: boolean };
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

export function buildReport(input: ReportInput, opts: ReportOptions): Report {
  const { commits, scan } = input;
  // The auto gap is picked from the main window and reused for the compared
  // one, so both are measured with the same yardstick.
  const params: EstimateParams = {
    firstCommitMinutes: opts.firstCommitMinutes,
    gapMinutes: opts.autoGap ? pickAutoGap(commits) : opts.gapMinutes,
  };

  // Groups estimated independently and summed. Per author always; per repo
  // only in independent mode (shared mode is one timeline: no grouping).
  const independentKey: KeyFn | undefined = opts.perAuthor
    ? byAuthor
    : scan && opts.repoMode === 'independent' ? byRepo : undefined;

  const report: Report = {
    author: input.author,
    configPath: input.configPath,
    params: { ...params, autoGap: opts.autoGap },
    total: estimateTotal(commits, params, independentKey),
    window: input.window,
  };

  if (opts.perAuthor) {
    const ranked = estimateGroups(commits, params, byAuthor);
    report.authors = {
      count: ranked.length,
      shown: (opts.top ? ranked.slice(0, opts.top) : ranked).map(({ key, result }) => ({ author: key, result })),
    };
    // The total always covers every author; --top only limits the listing.
    report.total = sumResults(ranked.map(a => a.result));
  }

  if (scan) {
    const shared = opts.repoMode === 'shared';
    const ranked: GroupResult[] = shared
      ? attributeGroups(commits, params, byRepo)
      : estimateGroups(commits, params, byRepo);
    const paths = new Map(scan.repos.map(r => [r.name, r.path]));
    const repoDaily = opts.daily ? dailyByGroup(commits, params, byRepo, shared) : undefined;
    report.repos = {
      active: ranked.length,
      mode: opts.repoMode,
      roots: scan.roots,
      scanned: scan.repos.length,
      shown: (opts.top ? ranked.slice(0, opts.top) : ranked).map(({ key, result }) => ({
        daily: repoDaily ? toDailyRows(repoDaily.get(key) ?? new Map()) : undefined,
        name: key,
        path: paths.get(key) ?? key,
        result,
      })),
    };
  }

  if (opts.daily)
    report.daily = toDailyRows(computeDailyBreakdown(commits, params, independentKey));

  if (opts.heatmap)
    report.heatmap = computeHeatmap(commits);

  if (input.compare) {
    const other = estimateTotal(input.compare.commits, params, independentKey);
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
