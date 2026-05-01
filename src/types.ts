export interface Options {
  allAuthors: boolean;
  allBranches: boolean;
  author?: string;
  autoGap: boolean;
  branch?: string;
  daily: boolean;
  excludeAuthor: string[];
  firstCommitMinutes: number;
  format: 'text' | 'json' | 'csv';
  gapMinutes: number;
  heatmap: boolean;
  repo?: string;
  since?: string;
  top?: number;
  until?: string;
}

export interface CommitEntry {
  author: string;
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
