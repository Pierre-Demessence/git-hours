import type { CommitEntry, Options } from './types.ts';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

// ASCII Unit Separator (0x1F) avoids collisions with `|` or other punctuation
// that may legitimately appear in author names or commit subjects.
const FS = '\x1F';

// Extract a human-readable error message from a thrown value.
// `execFileSync` rejects with an Error that may expose `stderr` (Buffer or
// string) when the child wrote to stderr before failing; otherwise we fall back
// to `.message`. Runtime-validated rather than cast through `as`, so an unknown
// error shape can't silently masquerade as one with a `stderr` field.
export function extractGitErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = (err as { stderr: unknown }).stderr;
    if (typeof stderr === 'string')
      return stderr;
    if (stderr instanceof Uint8Array)
      return Buffer.from(stderr).toString('utf-8');
  }
  if (err instanceof Error)
    return err.message;
  return String(err);
}

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

  // execFileSync blocks the event loop, so a true animated spinner isn't
  // possible without going async. We print a static progress hint to a TTY
  // stderr before the call and clear it after — confirms the tool is alive on
  // large repos. Suppressed when stderr is piped/redirected.
  const clearProgress = showProgressHint();

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
    clearProgress();
    const message = extractGitErrorMessage(err);
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
  clearProgress();

  if (!raw)
    return [];

  return applyExcludeAuthors(parseLogOutput(raw), opts.excludeAuthor);
}

function showProgressHint(): () => void {
  if (!process.stderr.isTTY)
    return () => {};
  process.stderr.write('⏳ Reading git log...');
  let cleared = false;
  return () => {
    if (cleared)
      return;
    cleared = true;
    // \r returns cursor to column 0; ESC[2K clears the entire line.
    process.stderr.write('\r\x1B[2K');
  };
}
