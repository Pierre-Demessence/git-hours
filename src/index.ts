import type { CommitEntry } from './types.ts';
import process from 'node:process';
import { parseArgs } from './cli.ts';
import { computeDailyBreakdown, estimateHours, pickAutoGap } from './estimate.ts';
import { formatHours } from './format.ts';
import { getCommits } from './git.ts';
import { printHeatmap } from './heatmap.ts';
import { printCsv, printJson } from './output.ts';
import { printDailyBreakdown, printResult } from './print.ts';

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const commits = getCommits(opts);

  if (opts.autoGap)
    opts.gapMinutes = pickAutoGap(commits);

  if (opts.format === 'json') {
    printJson(commits, opts);
    return;
  }
  if (opts.format === 'csv') {
    printCsv(commits, opts);
    return;
  }

  const dateRange = opts.since || opts.until
    ? `${opts.since ?? 'beginning'} → ${opts.until ?? 'now'}`
    : 'all time';

  const gapLabel = opts.autoGap ? `${opts.gapMinutes}min (auto)` : `${opts.gapMinutes}min`;
  console.log(`\n⏱  Git Hours — ${dateRange}`);
  console.log(`   Gap threshold: ${gapLabel} | First-commit credit: ${opts.firstCommitMinutes}min\n`);

  if (opts.allAuthors) {
    const byAuthor = new Map<string, CommitEntry[]>();
    for (const c of commits) {
      const key = `${c.author} <${c.email}>`;
      const list = byAuthor.get(key) ?? [];
      list.push(c);
      byAuthor.set(key, list);
    }

    let grandTotal = 0;
    const ranked = [...byAuthor.entries()]
      .map(([author, authorCommits]) => ({ author, result: estimateHours(authorCommits, opts) }))
      .sort((a, b) => b.result.hours - a.result.hours);
    const totalAuthors = ranked.length;
    const shown = opts.top ? ranked.slice(0, opts.top) : ranked;
    for (const { author, result } of shown) {
      printResult(author, result);
      grandTotal += result.hours;
      console.log();
    }
    if (opts.top && opts.top < totalAuthors)
      console.log(`  (showing top ${shown.length} of ${totalAuthors} authors)`);
    console.log(`  Grand total: ${formatHours(grandTotal)}\n`);
  }
  else {
    const result = estimateHours(commits, opts);
    printResult('Total', result);
    console.log();
  }

  if (commits.length > 0 && opts.daily) {
    const daily = computeDailyBreakdown(commits, opts);
    printDailyBreakdown(daily);
  }

  if (commits.length > 0 && opts.heatmap)
    printHeatmap(commits);
}

main();
