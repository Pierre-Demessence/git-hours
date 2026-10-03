export interface CommitEntry {
  author: string;
  email: string;
  message: string;
  timestamp: number;
}

export interface SessionResult {
  commits: number;
  firstCommit: Date | null;
  hours: number;
  lastCommit: Date | null;
  sessions: number;
}

// A half-open time window [since, until) in epoch ms; null means unbounded.
export interface DateWindow {
  label: string;
  since: number | null;
  until: number | null;
}

// Which commits to read from a repository. Independent of the repository
// itself, so the same filter can be applied to several repos.
export interface CommitFilter {
  allBranches: boolean;
  author?: string;
  branch?: string;
  excludeAuthor: string[];
}

export interface EstimateParams {
  firstCommitMinutes: number;
  gapMinutes: number;
}

export interface ReportOptions {
  allAuthors: boolean;
  autoGap: boolean;
  daily: boolean;
  firstCommitMinutes: number;
  gapMinutes: number;
  heatmap: boolean;
  top?: number;
}

export type OutputFormat = 'text' | 'json' | 'csv';

export interface Options {
  compare?: DateWindow;
  filter: CommitFilter;
  format: OutputFormat;
  repo?: string;
  report: ReportOptions;
  window: DateWindow;
}
