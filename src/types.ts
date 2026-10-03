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
  // Case-insensitive substrings of "Name <email>"; a commit matching any of
  // them is kept. Empty means every author.
  authors: string[];
  branch?: string;
  excludeAuthor: string[];
}

// Whose commits are counted:
// - patterns: the --author patterns (or the config file's `author`);
// - all: everyone (--all-authors, --per-author);
// - git-config: the repository's own user.email / user.name (default).
export type AuthorMode = 'patterns' | 'all' | 'git-config';

export interface AuthorInfo {
  mode: AuthorMode;
  // The patterns actually used (with --scan, the union over all repos).
  patterns: string[];
}

export interface EstimateParams {
  firstCommitMinutes: number;
  gapMinutes: number;
}

// Where the session gap came from.
export interface GapInfo {
  // Time span of the gaps learned from (epoch ms), when auto.
  from?: number;
  // Calibrated separately per author (--per-author) or per repo
  // (--independent-repos); the value shown is the overall one.
  perGroup: boolean;
  // Same-day gaps the value was learned from (0 unless auto).
  sampleGaps: number;
  source: 'auto' | 'default' | 'fixed';
  until?: number;
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
  daily: boolean;
  firstCommitMinutes: number;
  // A fixed gap (--gap); undefined means calibrated from your history.
  gapMinutes?: number;
  heatmap: boolean;
  // Per-author breakdown (--per-author).
  perAuthor: boolean;
  repoMode: RepoMode;
  top?: number;
}

export type OutputFormat = 'text' | 'json' | 'csv';

export interface Options {
  authorMode: AuthorMode;
  compare?: DateWindow;
  // The config file that was applied, if any.
  configPath?: string;
  // In git-config mode `filter.authors` is filled per repository at read time.
  filter: CommitFilter;
  format: OutputFormat;
  repo?: string;
  report: ReportOptions;
  scan?: ScanOptions;
  window: DateWindow;
}
