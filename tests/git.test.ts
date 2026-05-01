import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyExcludeAuthors, parseLogOutput } from '../src/git.ts';

const FS = '\x1f';

describe('parseLogOutput', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(parseLogOutput(''), []);
  });

  it('parses a single commit line', () => {
    const raw = `1700000000${FS}Alice${FS}alice@example.com${FS}fix: bug`;
    const [c] = parseLogOutput(raw);
    assert.equal(c.author, 'Alice');
    assert.equal(c.email, 'alice@example.com');
    assert.equal(c.message, 'fix: bug');
    assert.equal(c.timestamp, 1700000000_000);
  });

  it('keeps `|` characters in author and message intact', () => {
    const raw = `1700000000${FS}Bob | The Builder${FS}bob@example.com${FS}fix(a|b): pipe in scope`;
    const [c] = parseLogOutput(raw);
    assert.equal(c.author, 'Bob | The Builder');
    assert.equal(c.message, 'fix(a|b): pipe in scope');
  });

  it('rejoins extra separators in message', () => {
    const raw = `1700000000${FS}Alice${FS}alice@example.com${FS}msg${FS}with${FS}seps`;
    const [c] = parseLogOutput(raw);
    assert.equal(c.message, `msg${FS}with${FS}seps`);
  });

  it('parses multiple lines', () => {
    const raw = [
      `1700000000${FS}Alice${FS}alice@example.com${FS}a`,
      `1700000060${FS}Bob${FS}bob@example.com${FS}b`,
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
    assert.ok(!out.find(c => c.author === 'Alice'));
  });

  it('matches email substring (e.g. bot domain)', () => {
    const out = applyExcludeAuthors(commits, ['noreply@github.com']);
    assert.equal(out.length, 2);
    assert.ok(!out.find(c => c.author === 'dependabot[bot]'));
  });

  it('combines multiple patterns', () => {
    const out = applyExcludeAuthors(commits, ['alice', 'bot']);
    assert.equal(out.length, 1);
    assert.equal(out[0].author, 'Bob');
  });
});
