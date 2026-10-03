import type { CommitEntry, CommitFilter, DateWindow } from './types.ts';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { toLocalGitDate } from './dates.ts';
import { GitError } from './errors.ts';

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

// Keep commits whose *author* date falls in [since, until).
export function filterByAuthorDate(commits: CommitEntry[], range: Pick<DateWindow, 'since' | 'until'>): CommitEntry[] {
  return commits.filter(c =>
    (range.since === null || c.timestamp >= range.since)
    && (range.until === null || c.timestamp < range.until));
}

export function buildLogArgs(filter: CommitFilter, range: Pick<DateWindow, 'since' | 'until'>): string[] {
  // %aN / %aE apply the repo's .mailmap so identity aliases collapse.
  const args = ['log', `--format=%at${FS}%aN${FS}%aE${FS}%s`, '--no-merges'];

  // git's --since/--until filter on *committer* date, but hours are bucketed
  // by *author* date, so a commit written in February and rebased in March
  // would leak into March. The committer date is (practically) never earlier
  // than the author date, so --since is still a safe lower bound that lets git
  // stop walking early; the exact range is applied on author date afterwards.
  if (range.since !== null)
    args.push(`--since=${toLocalGitDate(new Date(range.since))}`);
  if (filter.author)
    // Fixed-string, case-insensitive: a substring match like --exclude-author.
    args.push('--fixed-strings', '--regexp-ignore-case', `--author=${filter.author}`);
  if (filter.allBranches)
    args.push('--all');
  else if (filter.branch)
    args.push(filter.branch);
  return args;
}

// Turn git's stderr into a short, user-facing message.
export function describeGitFailure(stderr: string, repo?: string): string {
  if (/not a git repository/i.test(stderr))
    return repo ? `not a git repository: ${repo}` : 'not a git repository (run from inside a repo).';
  if (/does not have any commits yet/i.test(stderr))
    return repo ? `repository has no commits yet: ${repo}` : 'this repository has no commits yet.';
  return `failed to read git log${repo ? ` in ${repo}` : ''}: ${stderr.trim()}`;
}

// Run git asynchronously and resolve with its stdout. Async (rather than
// execFileSync) keeps the event loop free for the progress spinner and lets
// several repositories be read in parallel.
export function runGit(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (e: NodeJS.ErrnoException) => {
      reject(new GitError(e.code === 'ENOENT' ? 'git is not installed or not on PATH' : e.message));
    });
    child.on('close', (code) => {
      if (code === 0)
        resolve(Buffer.concat(out).toString('utf-8'));
      else
        reject(new GitError(describeGitFailure(Buffer.concat(err).toString('utf-8'), cwd)));
    });
  });
}

// Read the commits of one repository matching `filter` within `range`.
export async function readCommits(repo: string | undefined, filter: CommitFilter, range: Pick<DateWindow, 'since' | 'until'>): Promise<CommitEntry[]> {
  const raw = (await runGit(buildLogArgs(filter, range), repo)).trim();
  const inRange = filterByAuthorDate(parseLogOutput(raw), range);
  return applyExcludeAuthors(inRange, filter.excludeAuthor);
}
