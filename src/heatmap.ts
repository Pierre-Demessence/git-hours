import type { CommitEntry } from './types.ts';

// Returns a 7x24 grid of commit counts, rows ordered Mon..Sun in local time.
export function computeHeatmap(commits: CommitEntry[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array.from<number>({ length: 24 }).fill(0));
  for (const c of commits) {
    const d = new Date(c.timestamp);
    // Date.getDay(): 0=Sun..6=Sat → remap so Monday is row 0.
    const day = (d.getDay() + 6) % 7;
    grid[day][d.getHours()]++;
  }
  return grid;
}
