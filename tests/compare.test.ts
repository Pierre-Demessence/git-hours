import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCompareRef } from '../src/cli.ts';

describe('resolveCompareRef', () => {
  it('resolves a known token', () => {
    const w = resolveCompareRef('last-month');
    assert.equal(w.label, 'last-month');
    assert.ok(Date.parse(w.since) < Date.parse(w.until));
  });

  it('resolves a YYYY-MM month', () => {
    const w = resolveCompareRef('2025-03');
    assert.equal(w.label, '2025-03');
    assert.equal(new Date(w.since).getMonth(), 2);
    assert.equal(new Date(w.until).getMonth(), 3);
  });

  it('resolves a YYYY-MM-DD..YYYY-MM-DD range', () => {
    const w = resolveCompareRef('2025-03-01..2025-03-08');
    assert.equal(w.label, '2025-03-01..2025-03-08');
    assert.ok(Date.parse(w.since) < Date.parse(w.until));
  });

  it('rejects unknown tokens', () => {
    assert.throws(() => resolveCompareRef('bogus'), /unrecognized ref/);
  });

  it('rejects months with bad numbers', () => {
    assert.throws(() => resolveCompareRef('2025-13'), /between 01 and 12/);
  });

  it('rejects reversed ranges', () => {
    assert.throws(() => resolveCompareRef('2025-03-08..2025-03-01'), /start must be before end/);
  });
});
