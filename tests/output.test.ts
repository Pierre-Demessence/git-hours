import type { CommitEntry, Options } from '../src/types.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildJsonPayload, formatCsv } from '../src/output.ts';

const baseOpts: Options = {
  allAuthors: false,
  allBranches: false,
  autoGap: false,
  daily: false,
  excludeAuthor: [],
  firstCommitMinutes: 30,
  format: 'json',
  gapMinutes: 120,
  heatmap: false,
};

function commit(timestamp: number, author = 'Alice', email = 'alice@example.com'): CommitEntry {
  return { author, email, message: 'm', timestamp };
}

describe('buildJsonPayload', () => {
  it('returns null first/last commit when range is empty', () => {
    const p = buildJsonPayload([], baseOpts) as { total: { firstCommit: null; lastCommit: null } };
    assert.equal(p.total.firstCommit, null);
    assert.equal(p.total.lastCommit, null);
  });

  it('sorts perAuthor by hours descending', () => {
    const day = 24 * 60 * 60 * 1000;
    const t = Date.UTC(2025, 0, 1, 9, 0, 0);
    const commits = [
      commit(t, 'Alice', 'a@x'),
      commit(t + day, 'Bob', 'b@x'),
      commit(t + day + 60_000, 'Bob', 'b@x'),
      commit(t + 2 * day, 'Bob', 'b@x'),
    ];
    const p = buildJsonPayload(commits, { ...baseOpts, allAuthors: true }) as {
      perAuthor: Array<{ author: string; hours: number }>;
    };
    assert.equal(p.perAuthor.length, 2);
    assert.ok(p.perAuthor[0].hours >= p.perAuthor[1].hours);
    assert.match(p.perAuthor[0].author, /Bob/);
  });

  it('respects --top to slice perAuthor', () => {
    const t = Date.UTC(2025, 0, 1);
    const commits = [
      commit(t, 'Alice', 'a@x'),
      commit(t + 86_400_000, 'Bob', 'b@x'),
      commit(t + 2 * 86_400_000, 'Carol', 'c@x'),
    ];
    const p = buildJsonPayload(commits, { ...baseOpts, allAuthors: true, top: 2 }) as {
      perAuthor: unknown[];
      totalAuthors: number;
    };
    assert.equal(p.perAuthor.length, 2);
    assert.equal(p.totalAuthors, 3);
  });
});

describe('formatCsv', () => {
  it('emits header only for empty input', () => {
    assert.equal(formatCsv([], baseOpts), 'date,day,week,hours,commits,sessions\n');
  });

  it('emits one data row per day', () => {
    const t = Date.UTC(2025, 0, 1, 9, 0, 0);
    const out = formatCsv([commit(t)], baseOpts);
    const lines = out.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^\d{4}-\d{2}-\d{2},/);
  });
});
