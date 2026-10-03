import type { CommitEntry, EstimateParams, SessionResult } from './types.ts';
import { dateKey } from './format.ts';

export function estimateHours(commits: CommitEntry[], params: EstimateParams): SessionResult {
  if (commits.length === 0) {
    return { commits: 0, firstCommit: null, hours: 0, lastCommit: null, sessions: 0 };
  }

  const sorted = [...commits].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = params.gapMinutes * 60 * 1000;
  const firstCommitMs = params.firstCommitMinutes * 60 * 1000;

  let totalMs = firstCommitMs;
  let sessions = 1;

  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].timestamp - sorted[i - 1].timestamp;
    if (diff > gapMs) {
      totalMs += firstCommitMs;
      sessions++;
    }
    else {
      totalMs += diff;
    }
  }

  return {
    commits: sorted.length,
    firstCommit: new Date(sorted[0].timestamp),
    hours: totalMs / (1000 * 60 * 60),
    lastCommit: new Date(sorted[sorted.length - 1].timestamp),
    sessions,
  };
}

// A grouping of commits: by author, by repository, ...
export type KeyFn = (c: CommitEntry) => string;
export const byAuthor: KeyFn = c => `${c.author} <${c.email}>`;
export const byRepo: KeyFn = c => c.repo ?? '';

export function groupBy(commits: CommitEntry[], keyOf: KeyFn): Map<string, CommitEntry[]> {
  const groups = new Map<string, CommitEntry[]>();
  for (const c of commits) {
    const key = keyOf(c);
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  return groups;
}

export interface GroupResult {
  key: string;
  result: SessionResult;
}

const byHoursDesc = (a: GroupResult, b: GroupResult) => b.result.hours - a.result.hours;

// Parameters of one group: its own entry in `perGroup` (e.g. a gap
// calibrated per author), else the shared `params`.
export type GroupParams = Map<string, EstimateParams>;
const paramsOf = (params: EstimateParams, key: string, perGroup?: GroupParams) => perGroup?.get(key) ?? params;

// Each group estimated on its own, ranked by hours descending.
export function estimateGroups(commits: CommitEntry[], params: EstimateParams, keyOf: KeyFn, perGroup?: GroupParams): GroupResult[] {
  return [...groupBy(commits, keyOf).entries()]
    .map(([key, list]) => ({ key, result: estimateHours(list, paramsOf(params, key, perGroup)) }))
    .sort(byHoursDesc);
}

function emptyResult(): SessionResult {
  return { commits: 0, firstCommit: null, hours: 0, lastCommit: null, sessions: 0 };
}

function minDate(a: Date | null, b: Date | null): Date | null {
  if (!a || !b)
    return a ?? b;
  return a.getTime() <= b.getTime() ? a : b;
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a || !b)
    return a ?? b;
  return a.getTime() >= b.getTime() ? a : b;
}

function addInto(target: SessionResult, r: SessionResult): void {
  target.commits += r.commits;
  target.hours += r.hours;
  target.sessions += r.sessions;
  target.firstCommit = minDate(target.firstCommit, r.firstCommit);
  target.lastCommit = maxDate(target.lastCommit, r.lastCommit);
}

export function sumResults(results: SessionResult[]): SessionResult {
  const total = emptyResult();
  for (const r of results)
    addInto(total, r);
  return total;
}

// Total for the whole selection. With `groupKey`, each group is estimated
// independently and summed: per author that gives person-hours, so
// interleaved commits from different people are never mistaken for one
// continuous session.
export function estimateTotal(commits: CommitEntry[], params: EstimateParams, groupKey?: KeyFn, perGroup?: GroupParams): SessionResult {
  if (!groupKey)
    return estimateHours(commits, params);
  return sumResults(estimateGroups(commits, params, groupKey, perGroup).map(g => g.result));
}

// Walk ONE timeline with the same session rules as estimateHours, crediting
// time to (key, local day) buckets:
// - a commit counts in its own key and day;
// - the first-commit credit and the session count go to the commit that opens
//   the session;
// - elapsed time between two commits goes to the key of the commit that ends
//   it, split at local midnight across days.
// So all buckets together always sum to estimateHours() of the same commits.
export function attributeDaily(commits: CommitEntry[], params: EstimateParams, keyOf: KeyFn): Map<string, Map<string, SessionResult>> {
  const out = new Map<string, Map<string, SessionResult>>();
  const bucket = (key: string, day: string): SessionResult => {
    let days = out.get(key);
    if (!days) {
      days = new Map();
      out.set(key, days);
    }
    let r = days.get(day);
    if (!r) {
      r = emptyResult();
      days.set(day, r);
    }
    return r;
  };
  const MS_PER_HOUR = 60 * 60 * 1000;

  const addSpan = (key: string, start: number, end: number): void => {
    let t = start;
    while (t < end) {
      const d = new Date(t);
      const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const segEnd = Math.min(end, nextMidnight);
      bucket(key, dateKey(t)).hours += (segEnd - t) / MS_PER_HOUR;
      t = segEnd;
    }
  };

  const sorted = [...commits].sort((a, b) => a.timestamp - b.timestamp);
  const gapMs = params.gapMinutes * 60 * 1000;
  const firstCommitHours = params.firstCommitMinutes / 60;

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const key = keyOf(c);
    const day = bucket(key, dateKey(c.timestamp));
    const at = new Date(c.timestamp);
    day.commits++;
    day.firstCommit = minDate(day.firstCommit, at);
    day.lastCommit = maxDate(day.lastCommit, at);

    const prev = i > 0 ? sorted[i - 1].timestamp : null;
    if (prev === null || c.timestamp - prev > gapMs) {
      day.sessions++;
      day.hours += firstCommitHours;
    }
    else {
      addSpan(key, prev, c.timestamp);
    }
  }
  return out;
}

// Groups sharing one timeline (see attributeDaily), ranked by hours. Unlike
// estimateGroups, a session that moves between groups is counted once, so
// the groups sum exactly to estimateHours() of all commits.
export function attributeGroups(commits: CommitEntry[], params: EstimateParams, keyOf: KeyFn): GroupResult[] {
  return [...attributeDaily(commits, params, keyOf).entries()]
    .map(([key, days]) => ({ key, result: sumResults([...days.values()]) }))
    .sort(byHoursDesc);
}

function dailyForStream(commits: CommitEntry[], params: EstimateParams): Map<string, SessionResult> {
  return attributeDaily(commits, params, () => '').get('') ?? new Map();
}

function mergeDaily(maps: Iterable<Map<string, SessionResult>>): Map<string, SessionResult> {
  const merged = new Map<string, SessionResult>();
  for (const map of maps) {
    for (const [day, r] of map) {
      const target = merged.get(day) ?? emptyResult();
      addInto(target, r);
      merged.set(day, target);
    }
  }
  return merged;
}

// Per-day breakdown. Sessions crossing midnight are split between the days.
// With `groupKey` it is the sum of each group's own breakdown, so it always
// adds up to estimateTotal() with the same grouping.
export function computeDailyBreakdown(commits: CommitEntry[], params: EstimateParams, groupKey?: KeyFn, perGroup?: GroupParams): Map<string, SessionResult> {
  if (!groupKey)
    return dailyForStream(commits, params);
  return mergeDaily([...groupBy(commits, groupKey).entries()].map(([key, list]) => dailyForStream(list, paramsOf(params, key, perGroup))));
}

// Per-group, per-day breakdown: on one shared timeline (`shared`) or with
// each group estimated on its own.
export function dailyByGroup(commits: CommitEntry[], params: EstimateParams, keyOf: KeyFn, shared: boolean, perGroup?: GroupParams): Map<string, Map<string, SessionResult>> {
  if (shared)
    return attributeDaily(commits, params, keyOf);
  return new Map([...groupBy(commits, keyOf).entries()].map(([key, list]) => [key, dailyForStream(list, paramsOf(params, key, perGroup))]));
}
