import type { CommitEntry, Options, SessionResult } from './types.ts';
import process from 'node:process';
import { parseArgs } from './cli.ts';
import { computeDailyBreakdown, estimateHours, pickAutoGap } from './estimate.ts';
import { formatHours } from './format.ts';
import { getCommits } from './git.ts';
import { printHeatmap } from './heatmap.ts';
import { printCsv, printJson } from './output.ts';
import { printDailyBreakdown, printResult } from './print.ts';

function describeRange(opts: Pick<Options, 'since' | 'until'>): string {
  return opts.since || opts.until ? `${opts.since ?? 'beginning'} → ${opts.until ?? 'now'}` : 'all time';
}

function pctDelta(current: number, base: number): string {
  if (base === 0)
    return current === 0 ? '0%' : '+∞%';
  const pct = ((current - base) / base) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function printCompareSummary(currentLabel: string, current: SessionResult, compareLabel: string, compare: SessionResult): void {
  const dh = current.hours - compare.hours;
  const dc = current.commits - compare.commits;
  const sign = (n: number) => (n > 0 ? '+' : '');
  console.log('  Comparison');
  console.log(`    Current (${currentLabel}):  ${formatHours(current.hours)}  (${current.commits} commits)`);
  console.log(`    Compare (${compareLabel}):  ${formatHours(compare.hours)}  (${compare.commits} commits)`);
  console.log(`    Delta:               ${sign(dh)}${formatHours(Math.abs(dh))}  (${sign(dc)}${dc} commits, ${pctDelta(current.hours, compare.hours)} hours)`);
  console.log();
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const commits = getCommits(opts);

  if (opts.autoGap)
    opts.gapMinutes = pickAutoGap(commits);

  if (opts.format === 'csv' && opts.compare) {
    console.error('git-hours: --csv is not supported with --compare');
    process.exit(2);
  }

  if (opts.format === 'json') {
    if (opts.compare) {
      const compareCommits = getCommits({ ...opts, since: opts.compare.since, until: opts.compare.until });
      // Re-use printJson by extending payload via temporary side channel? Simpler: build payload inline.
      const current = estimateHours(commits, opts);
      const compare = estimateHours(compareCommits, { ...opts, since: opts.compare.since, until: opts.compare.until });
      const dh = current.hours - compare.hours;
      const dc = current.commits - compare.commits;
      const payload = {
        current: { label: describeRange(opts), since: opts.since ?? null, until: opts.until ?? null, hours: current.hours, commits: current.commits, sessions: current.sessions },
        compare: { label: opts.compare.label, since: opts.compare.since, until: opts.compare.until, hours: compare.hours, commits: compare.commits, sessions: compare.sessions },
        delta: { hours: dh, commits: dc, hoursPct: compare.hours === 0 ? null : ((current.hours - compare.hours) / compare.hours) * 100 },
      };
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    printJson(commits, opts);
    return;
  }
  if (opts.format === 'csv') {
    printCsv(commits, opts);
    return;
  }

  const dateRange = describeRange(opts);

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

    if (opts.compare) {
      const compareCommits = getCommits({ ...opts, since: opts.compare.since, until: opts.compare.until });
      const compareResult = estimateHours(compareCommits, { ...opts, since: opts.compare.since, until: opts.compare.until });
      printResult(`Compare (${opts.compare.label})`, compareResult);
      console.log();
      printCompareSummary(dateRange, result, opts.compare.label, compareResult);
    }
  }

  if (commits.length > 0 && opts.daily) {
    const daily = computeDailyBreakdown(commits, opts);
    printDailyBreakdown(daily);
  }

  if (commits.length > 0 && opts.heatmap)
    printHeatmap(commits);
}

main();
