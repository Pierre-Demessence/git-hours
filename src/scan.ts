import type { Dirent } from 'node:fs';
import type { CommitEntry, CommitFilter, DateWindow } from './types.ts';
import { readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { EmptyRepoError, GitError } from './errors.ts';
import { fetchRepo, readCommits } from './git.ts';

export interface FoundRepo {
  // Display name: the path relative to the scan root (prefixed with the
  // root's name when several roots are scanned).
  name: string;
  path: string;
}

// Folders never worth descending into.
const SKIP_DIRS = new Set(['node_modules']);

export function expandHome(p: string): string {
  return p === '~' || p.startsWith(`~${sep}`) || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;
}

// Absolute path for display, with the home folder shown as `~`.
export function displayPath(p: string): string {
  const abs = resolve(expandHome(p));
  const home = homedir();
  return abs === home ? '~' : abs.startsWith(home + sep) ? `~${abs.slice(home.length)}` : abs;
}

// Glob → RegExp: `**` any path, `*` any run within one segment, `?` one char.
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
    }
    else if (ch === '*') {
      re += '[^/]*';
    }
    else if (ch === '?') {
      re += '[^/]';
    }
    else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

// A pattern with a `/` matches the folder's path relative to the scan root;
// one without matches the folder's own name, at any depth.
export function isExcluded(relPath: string, patterns: RegExp[], rawPatterns: string[]): boolean {
  const rel = relPath.split(sep).join('/');
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  return patterns.some((re, i) => re.test(rawPatterns[i].includes('/') ? rel : name));
}

function looksLikeBareRepo(entries: Dirent[]): boolean {
  const has = (name: string, dir: boolean) => entries.some(e => e.name === name && (dir ? e.isDirectory() : e.isFile()));
  return has('HEAD', false) && has('objects', true) && has('refs', true);
}

// Recursively find git repositories under `roots`. A folder containing `.git`
// (a directory, or a file for worktrees/submodules) or that is itself a bare
// repository counts as a repo, and the search does not descend into it.
// Hidden folders, node_modules, symlinks and excluded folders are skipped;
// unreadable folders are reported through `onWarning`.
export async function findRepos(roots: string[], exclude: string[], onWarning: (msg: string) => void = () => {}): Promise<FoundRepo[]> {
  const patterns = exclude.map(globToRegExp);
  const seen = new Set<string>();
  const found: FoundRepo[] = [];

  for (const rawRoot of roots) {
    const root = resolve(expandHome(rawRoot));
    const prefix = roots.length > 1 ? basename(root) : '';

    const visit = async (dir: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      }
      catch (err) {
        onWarning(`cannot read ${dir}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
        return;
      }

      if (entries.some(e => e.name === '.git') || looksLikeBareRepo(entries)) {
        const real = await realpath(dir);
        if (!seen.has(real)) {
          seen.add(real);
          const rel = relative(root, dir).split(sep).join('/');
          const name = [prefix, rel].filter(Boolean).join('/') || basename(root);
          found.push({ name, path: dir });
        }
        return;
      }

      const subdirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
        .filter(e => !isExcluded(relative(root, join(dir, e.name)), patterns, exclude));
      await Promise.all(subdirs.map(e => visit(join(dir, e.name))));
    };

    await visit(root);
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

// Run `fn` over `items` with at most `limit` in flight, preserving order.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Keep the first occurrence of each commit hash, so a commit present in
// several repos (a fork and its upstream, two clones, a worktree) counts once.
export function dedupeCommits(commits: CommitEntry[]): CommitEntry[] {
  const seen = new Set<string>();
  return commits.filter((c) => {
    if (!c.hash)
      return true;
    if (seen.has(c.hash))
      return false;
    seen.add(c.hash);
    return true;
  });
}

export const CONCURRENCY = 8;

export interface ScanHooks {
  onProgress: (text: string) => void;
  onWarning: (msg: string) => void;
}

export async function fetchAll(repos: FoundRepo[], hooks: ScanHooks): Promise<void> {
  let done = 0;
  await mapLimit(repos, CONCURRENCY, async (repo) => {
    try {
      await fetchRepo(repo.path);
    }
    catch (err) {
      hooks.onWarning(`${repo.name}: ${(err as Error).message.replace(` in ${repo.path}`, '')}`);
    }
    hooks.onProgress(`Fetching ${++done}/${repos.length} repos...`);
  });
}

// Read every repo for each window. A repo that fails is reported and skipped;
// if all of them fail, that is an error. Commits are tagged with their repo
// name and de-duplicated across repos (repos are visited in name order).
export async function readAll(repos: FoundRepo[], filter: CommitFilter, windows: DateWindow[], hooks: ScanHooks): Promise<CommitEntry[][]> {
  let done = 0;
  let failed = 0;
  const perRepo = await mapLimit(repos, CONCURRENCY, async (repo) => {
    try {
      const lists = await Promise.all(windows.map(w => readCommits(repo.path, filter, w)));
      return lists.map(list => list.map(c => ({ ...c, repo: repo.name })));
    }
    catch (err) {
      // A repo without any commit yet simply has no activity.
      if (!(err instanceof EmptyRepoError)) {
        failed++;
        hooks.onWarning(`skipping ${repo.name}: ${(err as Error).message}`);
      }
      return windows.map(() => []);
    }
    finally {
      hooks.onProgress(`Reading ${++done}/${repos.length} repos...`);
    }
  });
  if (repos.length > 0 && failed === repos.length)
    throw new GitError('could not read any of the scanned repositories');
  return windows.map((_, w) => dedupeCommits(perRepo.flatMap(lists => lists[w])));
}
