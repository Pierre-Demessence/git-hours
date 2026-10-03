import type { CommitEntry } from '../src/types.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';
import { GitError } from '../src/errors.ts';
import { dedupeCommits, displayPath, expandHome, fetchAll, findRepos, globToRegExp, isExcluded, mapLimit, readAll } from '../src/scan.ts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });

function initRepo(dir: string, commits: [author: string, date: string][] = []): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  for (const [author, date] of commits) {
    execFileSync('git', ['-c', `user.name=${author}`, '-c', `user.email=${author}@x`, 'commit', '-q', '--allow-empty', '-m', date], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  }
}

describe('globToRegExp / isExcluded', () => {
  it('matches names at any depth when the pattern has no slash', () => {
    const p = ['archive*'];
    assert.ok(isExcluded('a/b/archive-2020', p.map(globToRegExp), p));
    assert.ok(!isExcluded('a/b/old', p.map(globToRegExp), p));
  });

  it('matches paths relative to the root when the pattern has a slash', () => {
    const p = ['clients/*/legacy'];
    assert.ok(isExcluded('clients/acme/legacy', p.map(globToRegExp), p));
    assert.ok(!isExcluded('other/clients/acme/legacy', p.map(globToRegExp), p));
  });

  it('supports ** and escapes regex characters', () => {
    assert.ok(globToRegExp('a/**/z').test('a/b/c/z'));
    assert.ok(globToRegExp('v1.0').test('v1.0'));
    assert.ok(!globToRegExp('v1.0').test('v1x0'));
  });
});

describe('expandHome', () => {
  it('expands a leading ~ only', () => {
    assert.equal(expandHome('~'), homedir());
    assert.equal(expandHome('~/dev'), join(homedir(), 'dev'));
    assert.equal(expandHome('a/~/b'), 'a/~/b');
  });
});

describe('displayPath', () => {
  it('resolves paths and abbreviates the home folder', () => {
    assert.equal(displayPath('~/dev'), '~/dev');
    assert.equal(displayPath(homedir()), '~');
    assert.equal(displayPath('/opt/x/../y'), '/opt/y');
  });
});

describe('mapLimit', () => {
  it('preserves order and respects the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise(r => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    assert.deepEqual(out, [50, 10, 40, 20, 30]);
    assert.equal(peak, 2);
  });
});

describe('dedupeCommits', () => {
  it('keeps the first commit of each hash', () => {
    const c = (hash: string | undefined, repo: string): CommitEntry => ({ author: 'a', email: 'a@x', hash, message: '', repo, timestamp: 0 });
    const out = dedupeCommits([c('h1', 'a'), c('h1', 'b'), c('h2', 'b'), c(undefined, 'x'), c(undefined, 'y')]);
    assert.deepEqual(out.map(x => x.repo), ['a', 'b', 'x', 'y']);
  });
});

describe('findRepos', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'git-hours-scan-'));
    initRepo(join(root, 'top'));
    initRepo(join(root, 'clients/acme/api'));
    initRepo(join(root, 'clients/acme/api/vendor/inner')); // inside a repo: not descended into
    initRepo(join(root, 'node_modules/dep')); // skipped
    initRepo(join(root, '.hidden/repo')); // skipped
    initRepo(join(root, 'archive/old')); // excluded below
    mkdirSync(join(root, 'empty/deeper'), { recursive: true });
    git(root, 'init', '-q', '--bare', 'bare.git');
    // A worktree-style `.git` file counts as a repo too.
    mkdirSync(join(root, 'worktree'));
    writeFileSync(join(root, 'worktree/.git'), 'gitdir: /elsewhere\n');
    // Symlink loops are not followed.
    symlinkSync(root, join(root, 'empty/loop'));
  });

  after(() => rmSync(root, { force: true, recursive: true }));

  it('finds repos recursively without descending into them', async () => {
    const repos = await findRepos([root], ['archive']);
    assert.deepEqual(repos.map(r => r.name), ['bare.git', 'clients/acme/api', 'top', 'worktree']);
    assert.equal(repos.find(r => r.name === 'top')?.path, join(root, 'top'));
  });

  it('prefixes names with the root name when several roots are scanned', async () => {
    const repos = await findRepos([join(root, 'clients'), join(root, 'top')], []);
    assert.deepEqual(repos.map(r => r.name), ['clients/acme/api', 'top']);
  });

  it('names a root that is itself a repo after its folder, and dedupes overlapping roots', async () => {
    const repos = await findRepos([join(root, 'top'), join(root, 'top')], []);
    assert.deepEqual(repos.map(r => r.name), ['top']);
  });

  it('warns about unreadable folders instead of failing', async () => {
    const warnings: string[] = [];
    const repos = await findRepos([join(root, 'does-not-exist')], [], w => warnings.push(w));
    assert.equal(repos.length, 0);
    assert.match(warnings[0], /cannot read/);
  });
});

describe('readAll / fetchAll (real git)', () => {
  let root: string;
  const march = { label: '2025-03', since: new Date(2025, 2, 1).getTime(), until: new Date(2025, 3, 1).getTime() };
  const filter = { allBranches: false, excludeAuthor: [] };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'git-hours-read-'));
    initRepo(join(root, 'a'), [['me', '2025-03-03T09:00:00'], ['me', '2025-03-03T10:00:00']]);
    // A clone of `a` (same hashes) plus one commit of its own.
    git(root, 'clone', '-q', join(root, 'a'), 'a-clone');
    execFileSync('git', ['-c', 'user.name=me', '-c', 'user.email=me@x', 'commit', '-q', '--allow-empty', '-m', 'own'], {
      cwd: join(root, 'a-clone'),
      env: { ...process.env, GIT_AUTHOR_DATE: '2025-03-04T09:00:00', GIT_COMMITTER_DATE: '2025-03-04T09:00:00' },
    });
    initRepo(join(root, 'empty')); // no commits yet
    // Not a repository any more: reading it fails.
    mkdirSync(join(root, 'broken/.git'), { recursive: true });
    // A repo whose remote does not exist.
    initRepo(join(root, 'bad-remote'), [['me', '2025-03-05T09:00:00']]);
    git(join(root, 'bad-remote'), 'remote', 'add', 'origin', join(root, 'nowhere'));
  });

  after(() => rmSync(root, { force: true, recursive: true }));

  const hooks = () => {
    const warnings: string[] = [];
    return { hooks: { onProgress: () => {}, onWarning: (w: string) => warnings.push(w) }, warnings };
  };

  it('reads all repos, tags commits, dedupes shared history and skips broken repos', async () => {
    const repos = await findRepos([root], []);
    const { hooks: h, warnings } = hooks();
    const [commits] = await readAll(repos, filter, [march], h);
    const count = (repo: string) => commits.filter(c => c.repo === repo).length;
    assert.equal(count('a'), 2);
    assert.equal(count('a-clone'), 1); // only its own commit
    assert.equal(count('bad-remote'), 1);
    // `empty` has no commits: inactive, not an error. `broken` is skipped.
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^skipping broken: /);
  });

  it('reads several windows in one pass', async () => {
    const repos = (await findRepos([root], [])).filter(r => r.name === 'a');
    const feb = { label: '2025-02', since: new Date(2025, 1, 1).getTime(), until: new Date(2025, 2, 1).getTime() };
    const [m, f] = await readAll(repos, filter, [march, feb], hooks().hooks);
    assert.equal(m.length, 2);
    assert.equal(f.length, 0);
  });

  it('fails when no repo at all can be read', async () => {
    const repos = (await findRepos([root], [])).filter(r => r.name === 'broken');
    await assert.rejects(readAll(repos, filter, [march], hooks().hooks), GitError);
  });

  it('is fine when every repo is merely empty', async () => {
    const repos = (await findRepos([root], [])).filter(r => r.name === 'empty');
    assert.deepEqual(await readAll(repos, filter, [march], hooks().hooks), [[]]);
  });

  it('turns fetch failures into warnings', async () => {
    const repos = await findRepos([root], []);
    const { hooks: h, warnings } = hooks();
    await fetchAll(repos, h);
    // a-clone fetches from `a` fine, and repos without remotes are no-ops;
    // bad-remote's origin does not exist and broken is not a repository.
    assert.deepEqual(warnings.map(w => w.split(':')[0]).sort(), ['bad-remote', 'broken']);
    assert.match(warnings.find(w => w.startsWith('bad-remote'))!, /failed to fetch/);
  });
});
