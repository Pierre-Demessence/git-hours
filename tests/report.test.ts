import type { CommitEntry, DateWindow, ReportOptions } from '../src/types.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderCsv } from '../src/render/csv.ts';
import { buildJson } from '../src/render/json.ts';
import { renderText } from '../src/render/text.ts';
import { buildReport } from '../src/report.ts';

const opts: ReportOptions = {
  allAuthors: false,
  autoGap: false,
  daily: false,
  firstCommitMinutes: 30,
  gapMinutes: 120,
  heatmap: false,
  repoMode: 'shared',
};
const ALL: DateWindow = { label: 'all time', since: null, until: null };
const MIN = 60_000;
const T = new Date(2025, 2, 5, 9).getTime(); // Wed 2025-03-05 09:00 local

function commit(timestamp: number, author = 'Alice', email = `${author.toLowerCase()}@x`): CommitEntry {
  return { author, email, message: 'm', timestamp };
}

describe('buildReport', () => {
  it('estimates the total', () => {
    const r = buildReport({ commits: [commit(T), commit(T + 60 * MIN)], window: ALL }, opts);
    assert.equal(r.total.hours, 1.5);
    assert.equal(r.authors, undefined);
    assert.equal(r.daily, undefined);
  });

  it('ranks authors, applies --top, and keeps the total over all authors', () => {
    const commits = [commit(T, 'Alice'), commit(T + 10 * MIN, 'Bob'), commit(T + 60 * MIN, 'Alice')];
    const r = buildReport({ commits, window: ALL }, { ...opts, allAuthors: true, top: 1 });
    assert.equal(r.authors?.count, 2);
    assert.deepEqual(r.authors?.shown.map(a => a.author), ['Alice <alice@x>']);
    assert.equal(r.total.hours, 2); // Alice 1h30 + Bob 30m
  });

  it('builds a daily breakdown that sums to the total', () => {
    const commits = [commit(T), commit(T + 60 * MIN), commit(T + 24 * 60 * MIN)];
    const r = buildReport({ commits, window: ALL }, { ...opts, daily: true });
    assert.deepEqual(r.daily?.map(d => [d.date, d.day, d.week]), [['2025-03-05', 'Wed', 'W10'], ['2025-03-06', 'Thu', 'W10']]);
    assert.equal(r.daily?.reduce((s, d) => s + d.result.hours, 0), r.total.hours);
  });

  it('picks the auto gap from the main window', () => {
    // Commits every 5 minutes → P90 is tiny → clamped to 60.
    const commits = Array.from({ length: 30 }, (_, i) => commit(T + i * 5 * MIN));
    const r = buildReport({ commits, window: ALL }, { ...opts, autoGap: true });
    assert.equal(r.params.gapMinutes, 60);
    assert.equal(r.params.autoGap, true);
  });

  it('computes a comparison', () => {
    const r = buildReport({
      commits: [commit(T)],
      compare: { commits: [commit(T - 7 * 24 * 60 * MIN), commit(T - 7 * 24 * 60 * MIN + 30 * MIN)], window: { label: 'prev', since: null, until: null } },
      window: ALL,
    }, opts);
    assert.equal(r.compare?.total.hours, 1);
    assert.equal(r.compare?.delta.hours, -0.5);
    assert.equal(r.compare?.delta.commits, -1);
    assert.equal(r.compare?.delta.hoursPct, -50);
  });

  it('reports a null percentage when the compared window is empty', () => {
    const r = buildReport({ commits: [commit(T)], compare: { commits: [], window: ALL }, window: ALL }, opts);
    assert.equal(r.compare?.delta.hoursPct, null);
  });
});

describe('renderText', () => {
  it('prints a negative delta with its sign', () => {
    const r = buildReport({ commits: [], compare: { commits: [commit(T)], window: { label: 'prev', since: null, until: null } }, window: ALL }, opts);
    assert.match(renderText(r), /Delta: {2}-00h 30m {2}\(-1 commits, -100\.0% hours\)/);
  });

  it('says when no commits were found', () => {
    assert.match(renderText(buildReport({ commits: [], window: ALL }, opts)), /Total: No commits found/);
  });

  it('labels the grand total when --top hides authors', () => {
    const commits = [commit(T, 'Alice'), commit(T, 'Bob')];
    const out = renderText(buildReport({ commits, window: ALL }, { ...opts, allAuthors: true, top: 1 }));
    assert.match(out, /showing top 1 of 2 authors/);
    assert.match(out, /Grand total \(all 2 authors\): 01h 00m/);
  });
});

describe('buildJson', () => {
  it('returns null first/last commit when range is empty', () => {
    const p = buildJson(buildReport({ commits: [], window: ALL }, opts)) as { total: { firstCommit: null; lastCommit: null } };
    assert.equal(p.total.firstCommit, null);
    assert.equal(p.total.lastCommit, null);
  });

  it('emits range bounds as local date-time strings', () => {
    const window: DateWindow = { label: '2025-03', since: new Date(2025, 2, 1).getTime(), until: new Date(2025, 3, 1).getTime() };
    const p = buildJson(buildReport({ commits: [], window }, opts)) as { range: unknown };
    assert.deepEqual(p.range, { label: '2025-03', since: '2025-03-01 00:00:00', until: '2025-04-01 00:00:00' });
  });

  it('includes perAuthor, daily, heatmap and compare sections when requested', () => {
    const r = buildReport(
      { commits: [commit(T)], compare: { commits: [], window: ALL }, window: ALL },
      { ...opts, allAuthors: true, daily: true, heatmap: true },
    );
    const p = buildJson(r) as Record<string, unknown>;
    assert.equal(p.totalAuthors, 1);
    assert.equal((p.daily as unknown[]).length, 1);
    assert.equal((p.byHourDayOfWeek as number[][]).length, 7);
    assert.deepEqual((p.compare as { delta: unknown }).delta, { commits: 1, hours: 0.5, hoursPct: null });
  });
});

describe('renderCsv', () => {
  it('emits header only for empty input', () => {
    const r = buildReport({ commits: [], window: ALL }, { ...opts, daily: true });
    assert.equal(renderCsv(r), 'date,day,week,hours,commits,sessions\n');
  });

  it('emits one data row per day', () => {
    const r = buildReport({ commits: [commit(T)], window: ALL }, { ...opts, daily: true });
    assert.equal(renderCsv(r), 'date,day,week,hours,commits,sessions\n2025-03-05,Wed,W10,0.5000,1,1\n');
  });
});

describe('scan reports', () => {
  const scanCommit = (repo: string, timestamp: number): CommitEntry => ({ author: 'me', email: 'me@x', message: 'm', repo, timestamp });
  // A 09:00, B 09:30, A 10:00, and C alone the next day.
  const commits = [scanCommit('A', T), scanCommit('B', T + 30 * MIN), scanCommit('A', T + 60 * MIN), scanCommit('C', T + 24 * 60 * MIN)];
  const scan = { repos: [{ name: 'A', path: '/r/A' }, { name: 'B', path: '/r/B' }, { name: 'C', path: '/r/C' }, { name: 'D', path: '/r/D' }], roots: ['/r'] };

  it('shared mode: projects sum to the total and are ranked', () => {
    const r = buildReport({ commits, scan, window: ALL }, opts);
    assert.deepEqual(r.repos?.shown.map(x => [x.name, x.path, x.result.hours]), [['A', '/r/A', 1], ['B', '/r/B', 0.5], ['C', '/r/C', 0.5]]);
    assert.equal(r.repos?.scanned, 4);
    assert.equal(r.repos?.active, 3);
    assert.equal(r.total.hours, 2);
  });

  it('independent mode: the total is the sum of independent estimates', () => {
    const r = buildReport({ commits, scan, window: ALL }, { ...opts, repoMode: 'independent' });
    assert.equal(r.repos?.shown[0].result.hours, 1.5);
    assert.equal(r.total.hours, 2.5);
  });

  it('--top limits the listed projects but not the total', () => {
    const r = buildReport({ commits, scan, window: ALL }, { ...opts, top: 1 });
    assert.equal(r.repos?.shown.length, 1);
    assert.equal(r.total.hours, 2);
    assert.match(renderText(r), /showing top 1 of 3 projects/);
  });

  it('renders a project table with a total row', () => {
    const out = renderText(buildReport({ commits, scan, window: ALL }, opts));
    assert.match(out, /Scanned 4 repos in \/r · 3 with activity/);
    assert.match(out, /^ {2}A +01h 00m +2 +1 +2025-03-05 +2025-03-05$/m);
    assert.match(out, /^ {2}Total +02h 00m +4 +2 +2025-03-05 +2025-03-06$/m);
    assert.doesNotMatch(out, /Total time/);
  });

  it('emits perRepo and scan metadata in JSON', () => {
    const p = buildJson(buildReport({ commits, scan, window: ALL }, { ...opts, daily: true })) as {
      perRepo: Array<{ daily: unknown[]; hours: number; name: string; path: string }>;
      scan: unknown;
    };
    assert.deepEqual(p.scan, { activeRepos: 3, mode: 'shared', roots: ['/r'], scannedRepos: 4 });
    assert.deepEqual(p.perRepo.map(x => [x.name, x.path, x.hours, x.daily.length]), [['A', '/r/A', 1, 1], ['B', '/r/B', 0.5, 1], ['C', '/r/C', 0.5, 1]]);
  });

  it('renders CSV per project, or per project per day with --daily', () => {
    const plain = renderCsv(buildReport({ commits, scan, window: ALL }, opts)).trim().split('\n');
    assert.equal(plain[0], 'project,path,hours,commits,sessions,firstCommit,lastCommit');
    assert.match(plain[1], /^A,\/r\/A,1\.0000,2,1,/);

    const daily = renderCsv(buildReport({ commits, scan, window: ALL }, { ...opts, daily: true })).trim().split('\n');
    assert.deepEqual(daily, [
      'date,day,week,project,hours,commits,sessions',
      '2025-03-05,Wed,W10,A,1.0000,2,1',
      '2025-03-05,Wed,W10,B,0.5000,1,0',
      '2025-03-06,Thu,W10,C,0.5000,1,1',
    ]);
  });

  it('quotes CSV fields containing commas', () => {
    const r = buildReport({ commits: [scanCommit('a,b', T)], scan: { repos: [{ name: 'a,b', path: '/x' }], roots: ['/'] }, window: ALL }, opts);
    assert.match(renderCsv(r), /^"a,b",/m);
  });
});
