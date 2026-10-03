import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { GitError } from '../src/errors.ts';
import { applyExcludeAuthors, buildLogArgs, describeGitFailure, filterByAuthorDate, parseLogOutput, readCommits } from '../src/git.ts';

const FS = '\x1F';

describe('parseLogOutput', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(parseLogOutput(''), []);
  });

  it('parses a single commit line', () => {
    const raw = `1700000000${FS}abc123${FS}Alice${FS}alice@example.com${FS}fix: bug`;
    const [c] = parseLogOutput(raw);
    assert.equal(c.author, 'Alice');
    assert.equal(c.email, 'alice@example.com');
    assert.equal(c.message, 'fix: bug');
    assert.equal(c.timestamp, 1700000000_000);
    assert.equal(c.hash, 'abc123');
  });

  it('keeps `|` characters in author and message intact', () => {
    const raw = `1700000000${FS}abc123${FS}Bob | The Builder${FS}bob@example.com${FS}fix(a|b): pipe in scope`;
    const [c] = parseLogOutput(raw);
    assert.equal(c.author, 'Bob | The Builder');
    assert.equal(c.message, 'fix(a|b): pipe in scope');
  });

  it('rejoins extra separators in message', () => {
    const raw = `1700000000${FS}abc123${FS}Alice${FS}alice@example.com${FS}msg${FS}with${FS}seps`;
    const [c] = parseLogOutput(raw);
    assert.equal(c.message, `msg${FS}with${FS}seps`);
  });

  it('parses multiple lines', () => {
    const raw = [
      `1700000000${FS}abc123${FS}Alice${FS}alice@example.com${FS}a`,
      `1700000060${FS}abc123${FS}Bob${FS}bob@example.com${FS}b`,
    ].join('\n');
    const out = parseLogOutput(raw);
    assert.equal(out.length, 2);
    assert.equal(out[1].author, 'Bob');
  });
});

describe('applyExcludeAuthors', () => {
  const commits = [
    { author: 'Alice', email: 'alice@example.com', message: '', timestamp: 0 },
    { author: 'dependabot[bot]', email: 'noreply@github.com', message: '', timestamp: 0 },
    { author: 'Bob', email: 'bob@work.com', message: '', timestamp: 0 },
  ];

  it('returns input unchanged when excludes are empty', () => {
    assert.equal(applyExcludeAuthors(commits, []).length, 3);
  });

  it('matches author name substring case-insensitively', () => {
    const out = applyExcludeAuthors(commits, ['ALICE']);
    assert.equal(out.length, 2);
    assert.ok(!out.some(c => c.author === 'Alice'));
  });

  it('matches email substring (e.g. bot domain)', () => {
    const out = applyExcludeAuthors(commits, ['noreply@github.com']);
    assert.equal(out.length, 2);
    assert.ok(!out.some(c => c.author === 'dependabot[bot]'));
  });

  it('combines multiple patterns', () => {
    const out = applyExcludeAuthors(commits, ['alice', 'bot']);
    assert.equal(out.length, 1);
    assert.equal(out[0].author, 'Bob');
  });
});

describe('filterByAuthorDate', () => {
  const at = (timestamp: number) => ({ author: 'a', email: 'a@x', message: '', timestamp });
  const commits = [at(100), at(200), at(300)];

  it('keeps everything without bounds', () => {
    assert.equal(filterByAuthorDate(commits, { since: null, until: null }).length, 3);
  });

  it('uses an inclusive start and exclusive end', () => {
    assert.deepEqual(filterByAuthorDate(commits, { since: 200, until: 300 }).map(c => c.timestamp), [200]);
  });
});

describe('buildLogArgs', () => {
  const filter = { allBranches: false, excludeAuthor: [] };

  it('passes only a lower bound to git', () => {
    const args = buildLogArgs(filter, { since: new Date(2025, 2, 1).getTime(), until: new Date(2025, 3, 1).getTime() });
    assert.ok(args.includes('--since=2025-03-01 00:00:00'));
    assert.ok(!args.some(a => a.startsWith('--until')));
  });

  it('matches --author as a case-insensitive fixed string', () => {
    const args = buildLogArgs({ ...filter, author: 'a.b' }, { since: null, until: null });
    assert.deepEqual(args.slice(-3), ['--fixed-strings', '--regexp-ignore-case', '--author=a.b']);
  });

  it('prefers --all over a branch', () => {
    const args = buildLogArgs({ ...filter, allBranches: true, branch: 'dev' }, { since: null, until: null });
    assert.ok(args.includes('--all'));
    assert.ok(!args.includes('dev'));
  });
});

describe('describeGitFailure', () => {
  it('recognises common failures', () => {
    assert.match(describeGitFailure('fatal: not a git repository (or any parent)'), /run from inside a repo/);
    assert.match(describeGitFailure('fatal: not a git repository', 'x'), /not a git repository: x/);
    assert.match(describeGitFailure(`fatal: your current branch 'main' does not have any commits yet`), /no commits yet/);
    assert.match(describeGitFailure('fatal: boom\n'), /failed to read git log: fatal: boom$/);
  });
});

describe('readCommits (real git)', () => {
  let dir: string;
  const commitAt = (name: string, authorDate: string, committerDate = authorDate) =>
    execFileSync('git', ['-c', `user.name=${name}`, '-c', `user.email=${name}@x`, 'commit', '-q', '--allow-empty', '-m', authorDate], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: committerDate },
    });

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'git-hours-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    commitAt('alice', '2025-02-27T10:00:00', '2025-03-02T10:00:00'); // rebased later
    commitAt('alice', '2025-03-01T00:30:00', '2025-03-02T11:00:00');
    commitAt('bob', '2025-03-03T09:00:00');
  });

  after(() => rmSync(dir, { force: true, recursive: true }));

  const march = { since: new Date(2025, 2, 1).getTime(), until: new Date(2025, 3, 1).getTime() };
  const filter = { allBranches: false, excludeAuthor: [] };

  it('filters on author date, not committer date', async () => {
    const commits = await readCommits(dir, filter, march);
    assert.deepEqual(commits.map(c => c.message).sort(), ['2025-03-01T00:30:00', '2025-03-03T09:00:00']);
  });

  it('applies author filters', async () => {
    assert.equal((await readCommits(dir, { ...filter, author: 'BOB' }, march)).length, 1);
    assert.equal((await readCommits(dir, { ...filter, excludeAuthor: ['bob'] }, march)).length, 1);
  });

  it('rejects with a GitError outside a repository', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'git-hours-norepo-'));
    try {
      await assert.rejects(readCommits(outside, filter, march), (err: unknown) => err instanceof GitError && /not a git repository/.test(err.message));
    }
    finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });
});
