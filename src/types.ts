export interface CommitEntry {
  author: string;
  email: string;
  // Full commit hash; used to count a commit once across several repos.
  hash?: string;
  message: string;
  // Display name of the repository the commit was read from (--scan only).
  repo?: string;
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

// How --scan splits time between repositories:
// - shared: one timeline across all repos; a session moving between repos is
//   counted once and its time goes to the repo of each commit (default);
// - independent: each repo is estimated on its own and totals are summed, so
//   work overlapping in time is counted once per repo.
export type RepoMode = 'shared' | 'independent';

export interface ScanOptions {
  exclude: string[];
  fetch: boolean;
  roots: string[];
}

export interface ReportOptions {
  allAuthors: boolean;
  autoGap: boolean;
  daily: boolean;
  firstCommitMinutes: number;
  gapMinutes: number;
  heatmap: boolean;
  repoMode: RepoMode;
  top?: number;
}

export type OutputFormat = 'text' | 'json' | 'csv';

export interface Options {
  compare?: DateWindow;
  filter: CommitFilter;
  format: OutputFormat;
  repo?: string;
  report: ReportOptions;
  scan?: ScanOptions;
  window: DateWindow;
}
