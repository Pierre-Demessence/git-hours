import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArgs } from '../src/cli.ts';
import { ExitRequest, UsageError } from '../src/errors.ts';

describe('parseArgs', () => {
  it('applies defaults', () => {
    const o = parseArgs([]);
    assert.equal(o.format, 'text');
    assert.equal(o.report.gapMinutes, 120);
    assert.equal(o.report.firstCommitMinutes, 30);
    assert.equal(o.window.label, 'all time');
    assert.deepEqual(o.filter.excludeAuthor, []);
  });

  it('groups filter, report and window options', () => {
    const o = parseArgs(['--month', '2025-03', '--author', 'me', '--exclude-author', 'bot', '--all-branches', '--gap', '90']);
    assert.equal(o.window.label, '2025-03');
    assert.deepEqual(o.filter, { allBranches: true, author: 'me', branch: undefined, excludeAuthor: ['bot'] });
    assert.equal(o.report.gapMinutes, 90);
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
    [['--json', '--csv'], /cannot be used with/],
    [['--top', '3'], /requires --all-authors/],
    [['--all-authors', '--top', '1.5'], /positive integer/],
    [['--branch', '--all'], /must not start with '-'/],
    [['--month', '2025-03', '--last-month'], /only one date range/],
    [['--since', 'yesterday-ish'], /valid date/],
    [['--csv', '--compare', 'last-month'], /not supported with --compare/],
    [['--repo', '/definitely/not/here'], /does not exist/],
  ];
  for (const [argv, message] of invalid) {
    it(`rejects ${argv.join(' ')}`, () => {
      assert.throws(() => parseArgs(argv), (err: unknown) => err instanceof UsageError && message.test(err.message));
    });
  }
});
