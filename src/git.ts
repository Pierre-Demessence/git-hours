import type { CommitEntry, CommitFilter, DateWindow } from './types.ts';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { toLocalGitDate } from './dates.ts';
import { EmptyRepoError, GitError } from './errors.ts';

// ASCII Unit Separator (0x1F) avoids collisions with `|` or other punctuation
// that may legitimately appear in author names or commit subjects.
const FS = '\x1F';

export function parseLogOutput(raw: string): CommitEntry[] {
  if (!raw)
    return [];
  return raw.split('\n').map((line) => {
    const [ts, hash, author, email, ...msgParts] = line.split(FS);
    return {
      author,
      email,
      hash,
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
  const args = ['log', `--format=%at${FS}%H${FS}%aN${FS}%aE${FS}%s`, '--no-merges'];

  // git's --since/--until filter on *committer* date, but hours are bucketed
  // by *author* date, so a commit written in February and rebased in March
  // would leak into March. The committer date is (practically) never earlier
  // than the author date, so --since is still a safe lower bound that lets git
  // stop walking early; the exact range is applied on author date afterwards.
  if (range.since !== null)
    args.push(`--since=${toLocalGitDate(new Date(range.since))}`);
  if (filter.authors.length > 0) {
    // Fixed-string, case-insensitive: a substring match like --exclude-author.
    // Several --author flags are OR'ed by git.
    args.push('--fixed-strings', '--regexp-ignore-case', ...filter.authors.map(a => `--author=${a}`));
  }
  if (filter.allBranches)
    args.push('--all');
  else if (filter.branch)
    args.push(filter.branch);
  return args;
}

// Turn git's stderr into a short, user-facing message.
export function describeGitFailure(stderr: string, repo?: string, action = 'read git log'): string {
  if (/not a git repository/i.test(stderr))
    return repo ? `not a git repository: ${repo}` : 'not a git repository (run from inside a repo).';
  if (/does not have any commits yet/i.test(stderr))
    return repo ? `repository has no commits yet: ${repo}` : 'this repository has no commits yet.';
  return `failed to ${action}${repo ? ` in ${repo}` : ''}: ${stderr.trim()}`;
}

export interface RunGitOptions {
  // Used in error messages: "failed to <action> in <repo>".
  action?: string;
  // Never let git (or ssh) ask for credentials or host-key confirmation:
  // fail instead. For unattended network operations like fetch.
  noPrompt?: boolean;
  timeoutMs?: number;
}

// Run git asynchronously and resolve with its stdout. Async (rather than
// execFileSync) keeps the event loop free for the progress spinner and lets
// several repositories be read in parallel.
export function runGit(args: string[], cwd?: string, options: RunGitOptions = {}): Promise<string> {
  const { action, noPrompt = false, timeoutMs } = options;
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      // Without a controlling terminal (new session via setsid), ssh cannot
      // open /dev/tty to ask for a passphrase or confirm a host key, so it
      // fails fast instead of hanging. GIT_TERMINAL_PROMPT=0 covers HTTPS.
      detached: noPrompt && process.platform !== 'win32',
      env: noPrompt ? { ...process.env, GIT_TERMINAL_PROMPT: '0' } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeoutMs)
      : undefined;
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new GitError(e.code === 'ENOENT' ? 'git is not installed or not on PATH' : e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new GitError(`failed to ${action ?? 'run git'}${cwd ? ` in ${cwd}` : ''}: timed out after ${Math.round(timeoutMs! / 1000)}s`));
      }
      else if (code === 0) {
        resolve(Buffer.concat(out).toString('utf-8'));
      }
      else {
        const stderr = Buffer.concat(err).toString('utf-8');
        const ErrorClass = /does not have any commits yet/i.test(stderr) ? EmptyRepoError : GitError;
        reject(new ErrorClass(describeGitFailure(stderr, cwd, action)));
      }
    });
  });
}

// A git config value as git resolves it for `repo` (including includeIf),
// or undefined when unset.
export async function readGitConfig(key: string, repo?: string): Promise<string | undefined> {
  try {
    const value = (await runGit(['config', '--get', key], repo, { action: `read ${key}` })).trim();
    return value || undefined;
  }
  catch (err) {
    // `git config --get` exits 1 when the key is unset; anything else (not a
    // repository, git missing) surfaces when the log is read.
    if (err instanceof GitError)
      return undefined;
    throw err;
  }
}

// The author patterns identifying "me" in `repo`: user.email and user.name
// from git config. Matching the name too catches commits made with another
// address (e.g. GitHub's noreply email for web edits).
export async function gitIdentity(repo?: string): Promise<string[]> {
  const [email, name] = await Promise.all([readGitConfig('user.email', repo), readGitConfig('user.name', repo)]);
  return [email, name].filter((v): v is string => v !== undefined);
}

// Update all remotes of a repository, never prompting for credentials.
export async function fetchRepo(repo: string, timeoutMs = 60_000): Promise<void> {
  await runGit(['fetch', '--all', '--prune', '--quiet'], repo, { action: 'fetch', noPrompt: true, timeoutMs });
}

// Read the commits of one repository matching `filter` within `range`.
export async function readCommits(repo: string | undefined, filter: CommitFilter, range: Pick<DateWindow, 'since' | 'until'>): Promise<CommitEntry[]> {
  const raw = (await runGit(buildLogArgs(filter, range), repo)).trim();
  const inRange = filterByAuthorDate(parseLogOutput(raw), range);
  return applyExcludeAuthors(inRange, filter.excludeAuthor);
}
