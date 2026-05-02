import type { CommitEntry } from './types.ts';

const SHADES = ['░', '▒', '▓', '█'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Returns a 7x24 grid of commit counts, rows ordered Mon..Sun in local time.
export function computeHeatmap(commits: CommitEntry[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }).fill(0));
  for (const c of commits) {
    const d = new Date(c.timestamp);
    // Date.getDay(): 0=Sun..6=Sat → remap so Monday is row 0.
    const day = (d.getDay() + 6) % 7;
    grid[day][d.getHours()]++;
  }
  return grid;
}

export function printHeatmap(commits: CommitEntry[]): void {
  if (commits.length === 0)
    return;

  const grid = computeHeatmap(commits);

  let max = 0;
  for (const row of grid) {
    for (const v of row) {
      if (v > max)
        max = v;
    }
  }
  if (max === 0)
    return;

  const header = `      ${Array.from({ length: 24 }, (_, h) => ` ${String(h).padStart(2, ' ')}`).join('')}`;
  console.log('  Heatmap (local time, commits per hour)');
  console.log(header);
  for (let i = 0; i < 7; i++) {
    const cells = grid[i].map((v) => {
      if (v === 0)
        return '   ';
      const idx = Math.min(SHADES.length - 1, Math.floor((v / max) * SHADES.length));
      return `  ${SHADES[idx]}`;
    }).join('');
    console.log(`  ${DAY_NAMES[i]} ${cells}`);
  }
  console.log();
}
