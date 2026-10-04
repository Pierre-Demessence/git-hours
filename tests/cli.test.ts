import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';
import { parseArgs } from '../src/cli.ts';
import { ExitRequest, UsageError } from '../src/errors.ts';

describe('parseArgs', () => {
  it('applies defaults', () => {
    const o = parseArgs([]);
    assert.equal(o.format, 'text');
    assert.equal(o.authorMode, 'git-config');
    assert.equal(o.report.gapMinutes, 90);
    assert.equal(o.report.gapSource, 'default');
    assert.equal(o.report.firstCommitMinutes, 30);
    assert.equal(o.report.perAuthor, false);
    assert.equal(o.window.label, 'all time');
    assert.deepEqual(o.filter, { allBranches: false, authors: [], branch: undefined, excludeAuthor: [] });
    assert.equal(o.configPath, undefined);
  });

  it('groups filter, report and window options', () => {
    const o = parseArgs(['--month', '2025-03', '--author', 'me', 'me@x', '--exclude-author', 'bot', '--all-branches', '--gap', '90']);
    assert.equal(o.window.label, '2025-03');
    assert.equal(o.authorMode, 'patterns');
    assert.deepEqual(o.filter, { allBranches: true, authors: ['me', 'me@x'], branch: undefined, excludeAuthor: ['bot'] });
    assert.equal(o.report.gapMinutes, 90);
  });

  it('selects authors: --all-authors counts everyone, --per-author breaks them down', () => {
    const all = parseArgs(['--all-authors']);
    assert.equal(all.authorMode, 'all');
    assert.equal(all.report.perAuthor, false);
    const per = parseArgs(['--per-author', '--top', '2']);
    assert.equal(per.authorMode, 'all');
    assert.equal(per.report.perAuthor, true);
    assert.equal(per.report.top, 2);
  });

  it('--csv implies --daily', () => {
    const o = parseArgs(['--csv']);
    assert.equal(o.format, 'csv');
    assert.equal(o.report.daily, true);
  });

  it('parses --compare with the shared window syntax', () => {
    const o = parseArgs(['--month', '2025-03', '--compare', '2025-02-01..2025-03-01']);
    assert.equal(o.compare?.label, '2025-02-01..2025-03-01');
  });

  it('parses --scan with and without folders', () => {
    const bare = parseArgs(['--scan']);
    assert.deepEqual(bare.scan, { exclude: [], fetch: true, roots: ['.'] });
    assert.equal(bare.report.repoMode, 'shared');

    const o = parseArgs(['--scan', '.', 'src', '--scan-exclude', 'old', '--no-fetch', '--independent-repos', '--top', '3', '--all-authors']);
    assert.deepEqual(o.scan, { exclude: ['old'], fetch: false, roots: ['.', 'src'] });
    assert.equal(o.report.repoMode, 'independent');
    assert.equal(o.report.top, 3);
    assert.equal(o.authorMode, 'all');
  });

  it('--csv only implies --daily without --scan', () => {
    assert.equal(parseArgs(['--scan', '--csv']).report.daily, false);
    assert.equal(parseArgs(['--scan', '--csv', '--daily']).report.daily, true);
  });

  it('throws ExitRequest for --help and --version', () => {
    // Commander writes help/version to stdout; silence it for the test.
    const write = process.stdout.write;
    process.stdout.write = () => true;
    try {
      assert.throws(() => parseArgs(['--version']), ExitRequest);
      assert.throws(() => parseArgs(['--help']), ExitRequest);
    }
    finally {
      process.stdout.write = write;
    }
  });

  const invalid: [string[], RegExp][] = [
    [['--bogus'], /unknown option/],
    [['--gap', '-5'], /non-negative/],
    [['--auto-gap'], /--auto-gap was removed in 3\.0/],
    [['--json', '--csv'], /cannot be used with/],
    [['--top', '3'], /requires --per-author or --scan/],
    [['--per-author', '--top', '1.5'], /positive integer/],
    [['--author', 'me', '--all-authors'], /cannot be used with/],
    [['--author', 'me', '--per-author'], /cannot be used with/],
    [['--branch', '--all'], /must not start with '-'/],
    [['--month', '2025-03', '--last-month'], /only one date range/],
    [['--since', 'yesterday-ish'], /valid date/],
    [['--csv', '--compare', 'last-month'], /not supported with --compare/],
    [['--repo', '/definitely/not/here'], /does not exist/],
    [['--scan', '--repo', '.'], /cannot be used with/],
    [['--scan', '--per-author'], /cannot be used with/],
    [['--scan', '--branch', 'main'], /cannot be used with/],
    [['--scan', '/definitely/not/here'], /--scan path does not exist/],
    [['--no-fetch'], /requires --scan/],
    [['--fetch'], /requires --scan/],
    [['--independent-repos'], /--independent-repos requires --scan/],
    [['--scan-exclude', 'x'], /--scan-exclude requires --scan/],
    [['--config', '/definitely/not/here.json'], /config file not found/],
  ];
  for (const [argv, message] of invalid) {
    it(`rejects ${argv.join(' ')}`, () => {
      assert.throws(() => parseArgs(argv), (err: unknown) => err instanceof UsageError && message.test(err.message));
    });
  }
});

describe('parseArgs with a config file', () => {
  let dir: string;
  let path: string;
  const write = (config: unknown) => writeFileSync(path, JSON.stringify(config));
  const parse = (argv: string[] = []) => parseArgs(argv, { defaultConfigPath: path });

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'git-hours-config-'));
    path = join(dir, 'config.json');
  });
  after(() => rmSync(dir, { force: true, recursive: true }));

  it('ignores a missing default config file', () => {
    assert.equal(parseArgs([], { defaultConfigPath: join(dir, 'nope.json') }).configPath, undefined);
  });

  it('applies config values when the CLI does not set them', () => {
    write({ allBranches: true, author: 'me@x', excludeAuthor: ['bot'], fetch: false, firstCommitCredit: 15, gap: 90, independentRepos: true, scan: [dir], scanExclude: ['old'] });
    const o = parse(['--scan']);
    assert.equal(o.configPath, path);
    assert.equal(o.authorMode, 'patterns');
    assert.deepEqual(o.filter, { allBranches: true, authors: ['me@x'], branch: undefined, excludeAuthor: ['bot'] });
    assert.equal(o.report.gapMinutes, 90);
    assert.equal(o.report.gapSource, 'set');
    assert.equal(o.report.firstCommitMinutes, 15);
    assert.equal(o.report.repoMode, 'independent');
    assert.deepEqual(o.scan, { exclude: ['old'], fetch: false, roots: [dir] });
  });

  it('scan-only settings do not require --scan when they come from the config', () => {
    write({ fetch: false, independentRepos: true, scanExclude: ['x'] });
    assert.equal(parse().scan, undefined);
  });

  it('lets CLI flags win, group by group', () => {
    write({ allBranches: true, author: 'me@x', excludeAuthor: ['bot'], fetch: false, gap: 90, scan: ['/elsewhere'] });
    const o = parse(['--all-authors', '--gap', '45', '--exclude-author', 'ci', '--scan', '.', '--fetch']);
    assert.equal(o.authorMode, 'all');
    assert.deepEqual(o.filter.authors, []);
    assert.equal(o.report.gapMinutes, 45);
    assert.equal(o.report.gapSource, 'set');
    assert.deepEqual(o.filter.excludeAuthor, ['ci']);
    assert.deepEqual(o.scan, { exclude: [], fetch: true, roots: ['.'] });
  });

  it('--author on the CLI replaces the config author; --per-author overrides it too', () => {
    write({ author: ['me@x', 'Me'] });
    assert.deepEqual(parse(['--author', 'other']).filter.authors, ['other']);
    assert.equal(parse(['--per-author']).authorMode, 'all');
  });

  it('--branch on the CLI overrides a config allBranches', () => {
    write({ allBranches: true });
    const o = parse(['--branch', 'dev']);
    assert.equal(o.filter.allBranches, false);
    assert.equal(o.filter.branch, 'dev');
  });

  it('--no-config ignores the file and --config picks another one', () => {
    write({ gap: 90 });
    assert.equal(parse(['--no-config']).report.gapMinutes, 90);
    const other = join(dir, 'other.json');
    writeFileSync(other, JSON.stringify({ gap: 30 }));
    const o = parse(['--config', other]);
    assert.equal(o.report.gapMinutes, 30);
    assert.equal(o.configPath, other);
  });

  const badConfigs: [unknown, RegExp][] = [
    [[], /must be a JSON object/],
    [{ gapp: 90 }, /unknown key "gapp"/],
    [{ gap: '90' }, /"gap" must be a non-negative number/],
    [{ allBranches: 'yes' }, /"allBranches" must be true or false/],
    [{ scan: [] }, /"scan" must be a non-empty string/],
    [{ author: 'me', allAuthors: true }, /cannot both be set/],
    [{ autoGap: true }, /"autoGap" was removed in 3\.0/],
  ];
  for (const [config, message] of badConfigs) {
    it(`rejects config ${JSON.stringify(config)}`, () => {
      write(config);
      assert.throws(() => parse(), (err: unknown) => err instanceof UsageError && message.test(err.message));
    });
  }

  it('rejects invalid JSON with the file path', () => {
    writeFileSync(path, '{ "gap": 90, }');
    assert.throws(() => parse(), (err: unknown) => err instanceof UsageError && err.message.includes(path));
  });
});
