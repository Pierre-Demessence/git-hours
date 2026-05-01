import process from 'node:process';
import { parseArgs } from './cli.ts';
import { computeDailyBreakdown, estimateHours, pickAutoGap } from './estimate.ts';
import { formatHours } from './format.ts';
import { getCommits } from './git.ts';
import { printDailyBreakdown, printResult } from './print.ts';
import type { CommitEntry } from './types.ts';

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const commits = getCommits(opts);

  if (opts.autoGap)
    opts.gapMinutes = pickAutoGap(commits);

  const dateRange = opts.since || opts.until
    ? `${opts.since ?? 'beginning'} → ${opts.until ?? 'now'}`
    : 'all time';

  const gapLabel = opts.autoGap ? `${opts.gapMinutes}min (auto)` : `${opts.gapMinutes}min`;
  console.log(`\n⏱  Git Hours — ${dateRange}`);
  console.log(`   Gap threshold: ${gapLabel} | First-commit credit: ${opts.firstCommitMinutes}min\n`);

  if (opts.allAuthors) {
    const byAuthor = new Map<string, CommitEntry[]>();
    for (const c of commits) {
      const list = byAuthor.get(c.author) ?? [];
      list.push(c);
      byAuthor.set(c.author, list);
    }

    let grandTotal = 0;
    for (const [author, authorCommits] of [...byAuthor.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const result = estimateHours(authorCommits, opts);
      printResult(author, result);
      grandTotal += result.hours;
      console.log();
    }
    console.log(`  Grand total: ${formatHours(grandTotal)}\n`);
  }
  else {
    const result = estimateHours(commits, opts);
    printResult('Total', result);
    console.log();
  }

  if (commits.length > 0 && !opts.summaryOnly) {
    const daily = computeDailyBreakdown(commits, opts);
    printDailyBreakdown(daily);
  }
}

main();
