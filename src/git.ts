import type { Buffer } from 'node:buffer';
import type { CommitEntry, Options } from './types.ts';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

// ASCII Unit Separator (0x1F) avoids collisions with `|` or other punctuation
// that may legitimately appear in author names or commit subjects.
const FS = '\x1F';

export function parseLogOutput(raw: string): CommitEntry[] {
  if (!raw)
    return [];
  return raw.split('\n').map((line) => {
    const [ts, author, email, ...msgParts] = line.split(FS);
    return {
      author,
      email,
      message: msgParts.join(FS),
      timestamp: Number(ts) * 1000,
    };
  });
}

export function applyExcludeAuthors(commits: CommitEntry[], excludes: string[]): CommitEntry[] {
  if (excludes.length === 0)
    return commits;
  const lowered = excludes.map(s => s.toLowerCase());
  return commits.filter((c) => {
    const hay = `${c.author} <${c.email}>`.toLowerCase();
    return !lowered.some(p => hay.includes(p));
  });
}

export function getCommits(opts: Options): CommitEntry[] {
  // %aN / %aE apply the repo's .mailmap so identity aliases collapse.
  const args = ['log', `--format=%at${FS}%aN${FS}%aE${FS}%s`, '--no-merges'];

  if (opts.since)
    args.push(`--since=${opts.since}`);
  if (opts.until)
    args.push(`--until=${opts.until}`);
  if (opts.author)
    args.push(`--author=${opts.author}`);
  if (opts.allBranches)
    args.push('--all');
  else if (opts.branch)
    args.push(opts.branch);

  let raw: string;
  try {
    raw = execFileSync('git', args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.repo,
      // Default maxBuffer is 1 MiB; large repos with thousands of commits in
      // range can blow past that and throw ENOBUFS. 64 MiB covers ~600k commits.
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  }
  catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    const message = typeof stderr === 'string' ? stderr : stderr?.toString() ?? (err as Error).message;
    if (/not a git repository/i.test(message)) {
      console.error('git-hours: not a git repository (run from inside a repo).');
    }
    else if (/does not have any commits yet/i.test(message)) {
      console.error('git-hours: this repository has no commits yet.');
    }
    else {
      console.error(`git-hours: failed to read git log: ${message.trim()}`);
    }
    process.exit(1);
  }

  if (!raw)
    return [];

  return applyExcludeAuthors(parseLogOutput(raw), opts.excludeAuthor);
}
