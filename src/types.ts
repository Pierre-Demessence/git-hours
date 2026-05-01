export interface Options {
  allAuthors: boolean;
  author?: string;
  firstCommitMinutes: number;
  gapMinutes: number;
  repo?: string;
  since?: string;
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
