import type { AuthorResult } from './estimate.ts';
import type { CommitEntry, DateWindow, EstimateParams, ReportOptions, SessionResult } from './types.ts';
import { computeDailyBreakdown, estimatePerAuthor, estimateTotal, pickAutoGap, sumResults } from './estimate.ts';
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
  // Present with --all-authors: ranked authors (limited by --top) and how many exist.
  authors?: { count: number; shown: AuthorResult[] };
  compare?: CompareSection;
  daily?: DailyRow[];
  heatmap?: number[][];
  params: EstimateParams & { autoGap: boolean };
  total: SessionResult;
  window: DateWindow;
}

export interface WindowCommits {
  commits: CommitEntry[];
  window: DateWindow;
}

export interface ReportInput extends WindowCommits {
  compare?: WindowCommits;
}

export function buildReport(input: ReportInput, opts: ReportOptions): Report {
  const { commits } = input;
  // The auto gap is picked from the main window and reused for the compared
  // one, so both are measured with the same yardstick.
  const params: EstimateParams = {
    firstCommitMinutes: opts.firstCommitMinutes,
    gapMinutes: opts.autoGap ? pickAutoGap(commits) : opts.gapMinutes,
  };
  const perAuthor = opts.allAuthors;

  const report: Report = {
    params: { ...params, autoGap: opts.autoGap },
    total: estimateTotal(commits, params, perAuthor),
    window: input.window,
  };

  if (perAuthor) {
    const ranked = estimatePerAuthor(commits, params);
    report.authors = { count: ranked.length, shown: opts.top ? ranked.slice(0, opts.top) : ranked };
    // The total always covers every author; --top only limits the listing.
    report.total = sumResults(ranked.map(a => a.result));
  }

  if (opts.daily) {
    report.daily = [...computeDailyBreakdown(commits, params, perAuthor).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, result]) => ({ date, day: dayName(date), result, week: isoWeekNumber(date) }));
  }

  if (opts.heatmap)
    report.heatmap = computeHeatmap(commits);

  if (input.compare) {
    const other = estimateTotal(input.compare.commits, params, perAuthor);
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
