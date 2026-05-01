import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dateKey, dayName, formatHours, isoWeekNumber } from '../src/format.ts';

describe('formatHours', () => {
  it('formats whole hours', () => {
    assert.equal(formatHours(2), '02h 00m');
  });

  it('formats fractional hours', () => {
    assert.equal(formatHours(1.5), '01h 30m');
  });

  it('rounds minutes', () => {
    assert.equal(formatHours(0.51), '00h 31m');
  });

  it('handles zero', () => {
    assert.equal(formatHours(0), '00h 00m');
  });
});

describe('isoWeekNumber', () => {
  // Reference values from ISO 8601 calendars.
  const cases: [string, string][] = [
    ['2023-01-01', 'W52'], // Sunday — belongs to W52 of 2022
    ['2024-01-01', 'W01'], // Monday — first week of 2024
    ['2024-12-30', 'W01'], // Monday — first week of 2025
    ['2025-01-01', 'W01'],
    ['2026-01-01', 'W01'], // Thursday — first week of 2026
    ['2020-12-31', 'W53'], // 2020 has 53 ISO weeks
  ];

  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => {
      assert.equal(isoWeekNumber(input), expected);
    });
  }
});

describe('dateKey', () => {
  it('produces YYYY-MM-DD from a timestamp', () => {
    const ts = new Date(2025, 2, 5, 14, 30).getTime();
    assert.equal(dateKey(ts), '2025-03-05');
  });
});

describe('dayName', () => {
  it('maps a Monday correctly', () => {
    assert.equal(dayName('2026-04-27'), 'Mon');
  });

  it('maps a Sunday correctly', () => {
    assert.equal(dayName('2026-05-03'), 'Sun');
  });
});
