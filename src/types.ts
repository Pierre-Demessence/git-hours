export interface Options {
  allAuthors: boolean;
  allBranches: boolean;
  author?: string;
  autoGap: boolean;
  branch?: string;
  firstCommitMinutes: number;
  gapMinutes: number;
  repo?: string;
  since?: string;
  summaryOnly: boolean;
  until?: string;
}

export interface CommitEntry {
  author: string;
  message: string;
  timestamp: number;
}

export interface SessionResult {
  commits: number;
  firstCommit: Date;
  hours: number;
  lastCommit: Date;
  sessions: number;
}
