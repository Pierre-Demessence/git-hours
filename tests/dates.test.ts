import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { monthWindow, parseDateBound, parseWindowSpec, resolveWindow, shortcutWindow, weekWindow } from '../src/dates.ts';
import { UsageError } from '../src/errors.ts';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
// Wednesday 2025-03-12, 15:00 local.
const NOW = new Date(2025, 2, 12, 15);

describe('parseDateBound', () => {
  // Regression: a bare date must mean local midnight, not UTC midnight (Date.parse)
  // nor "that day at the current time of day" (git's approxidate).
  it('parses a bare YYYY-MM-DD as local midnight', () => {
    assert.equal(parseDateBound('2025-03-01'), local(2025, 3, 1));
  });

  it('parses local date-time strings', () => {
    assert.equal(parseDateBound('2025-03-01 10:30:00'), local(2025, 3, 1, 10, 30));
  });

  it('rejects invalid dates', () => {
    assert.equal(parseDateBound('not a date'), null);
    assert.equal(parseDateBound('2025-02-30'), null);
  });
});

describe('shortcutWindow', () => {
  const cases: [Parameters<typeof shortcutWindow>[0], number, number][] = [
    ['today', local(2025, 3, 12), local(2025, 3, 13)],
    ['yesterday', local(2025, 3, 11), local(2025, 3, 12)],
    ['this-week', local(2025, 3, 10), local(2025, 3, 17)],
    ['last-week', local(2025, 3, 3), local(2025, 3, 10)],
    ['this-month', local(2025, 3, 1), local(2025, 4, 1)],
    ['last-month', local(2025, 2, 1), local(2025, 3, 1)],
  ];
  for (const [name, since, until] of cases) {
    it(name, () => {
      const w = shortcutWindow(name, NOW);
      assert.equal(w.since, since);
      assert.equal(w.until, until);
      assert.match(w.label, new RegExp(`^${name} \\(`));
    });
  }

  it('last-month in January is December of the previous year', () => {
    const w = shortcutWindow('last-month', new Date(2025, 0, 15));
    assert.equal(w.since, local(2024, 12, 1));
    assert.equal(w.until, local(2025, 1, 1));
  });
});

describe('monthWindow / weekWindow', () => {
  it('covers a whole month, December rolling over', () => {
    const w = monthWindow('2024-12');
    assert.equal(w.since, local(2024, 12, 1));
    assert.equal(w.until, local(2025, 1, 1));
    assert.equal(w.label, '2024-12');
  });

  it('rejects bad months', () => {
    assert.throws(() => monthWindow('2025-13'), /between 01 and 12/);
    assert.throws(() => monthWindow('2025-3'), /YYYY-MM/);
  });

  it('snaps a week to its Monday', () => {
    const w = weekWindow('2025-03-16'); // a Sunday
    assert.equal(w.since, local(2025, 3, 10));
    assert.equal(w.until, local(2025, 3, 17));
  });

  it('rejects bad week dates', () => {
    assert.throws(() => weekWindow('2025-02-30'), UsageError);
  });
});

describe('parseWindowSpec', () => {
  it('accepts shortcuts', () => {
    assert.equal(parseWindowSpec('last-month', 'compare', NOW).since, local(2025, 2, 1));
  });

  it('accepts YYYY-MM', () => {
    assert.equal(parseWindowSpec('2025-03').since, local(2025, 3, 1));
  });

  it('accepts START..END with exclusive end', () => {
    const w = parseWindowSpec('2025-03-01..2025-03-08');
    assert.equal(w.since, local(2025, 3, 1));
    assert.equal(w.until, local(2025, 3, 8));
    assert.equal(w.label, '2025-03-01..2025-03-08');
  });

  it('accepts open-ended ranges', () => {
    assert.equal(parseWindowSpec('2025-03-01..').until, null);
    assert.equal(parseWindowSpec('..2025-03-01').since, null);
  });

  it('rejects reversed ranges and garbage', () => {
    assert.throws(() => parseWindowSpec('2025-03-08..2025-03-01'), /before/);
    assert.throws(() => parseWindowSpec('bogus'), /unrecognized window/);
    assert.throws(() => parseWindowSpec('..'), /unrecognized window/);
  });
});

describe('resolveWindow', () => {
  it('defaults to all time', () => {
    assert.deepEqual(resolveWindow({ shortcuts: [] }), { label: 'all time', since: null, until: null });
  });

  it('uses --since/--until with their raw values as label', () => {
    const w = resolveWindow({ shortcuts: [], since: '2025-03-01' });
    assert.equal(w.since, local(2025, 3, 1));
    assert.equal(w.until, null);
    assert.equal(w.label, '2025-03-01 → now');
  });

  it('rejects combining range flags', () => {
    assert.throws(() => resolveWindow({ shortcuts: [], month: '2025-03', since: '2025-03-01' }), /only one date range/);
    assert.throws(() => resolveWindow({ shortcuts: [], month: '2025-03', week: '2025-03-03' }), /only one date range/);
    assert.throws(() => resolveWindow({ shortcuts: ['today', 'yesterday'] }), /only one date range/);
  });

  it('rejects --since after --until', () => {
    assert.throws(() => resolveWindow({ shortcuts: [], since: '2025-03-05', until: '2025-03-01' }), /before --until/);
  });
});
