import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeHeatmap } from '../src/heatmap.ts';

function commit(timestamp: number) {
  return { author: 'A', email: 'a@b.c', message: 'm', timestamp };
}

describe('computeHeatmap', () => {
  it('returns a 7x24 grid', () => {
    const grid = computeHeatmap([]);
    assert.equal(grid.length, 7);
    for (const row of grid)
      assert.equal(row.length, 24);
  });

  it('counts commits at the right (day, hour) cell using local time', () => {
    // 2025-03-25 (Tuesday) at local 14:30
    const ts = new Date(2025, 2, 25, 14, 30).getTime();
    const grid = computeHeatmap([commit(ts), commit(ts)]);
    // Tuesday is row 1 (Mon=0..Sun=6), hour 14
    assert.equal(grid[1][14], 2);
    // Other cells stay zero
    assert.equal(grid[0][14], 0);
    assert.equal(grid[1][13], 0);
  });

  it('puts Sunday in row 6 (Monday-first)', () => {
    // 2025-03-23 (Sunday) at local 09:00
    const ts = new Date(2025, 2, 23, 9, 0).getTime();
    const grid = computeHeatmap([commit(ts)]);
    assert.equal(grid[6][9], 1);
  });
});
