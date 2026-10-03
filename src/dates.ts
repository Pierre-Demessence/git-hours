import type { DateWindow } from './types.ts';
import { UsageError } from './errors.ts';
import { dateKey, formatDateTime } from './format.ts';

// Policy: every window is computed in the user's local timezone, matching the
// local-time bucketing of dateKey(). All windows are half-open: [since, until).

// Format a Date as a bare local-time string (no Z, no T): "YYYY-MM-DD HH:mm:ss".
export function toLocalGitDate(d: Date): string {
  return formatDateTime(d);
}

// Parse a user-supplied date bound to epoch ms, or null if invalid.
// A bare YYYY-MM-DD means local midnight: `Date.parse` would treat it as UTC,
// and git would treat it as that day at the *current* time of day.
export function parseDateBound(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [y, mo, d] = m.slice(1).map(Number);
    const date = new Date(y, mo - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d)
      return null;
    return date.getTime();
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

// Monday of the week containing `d` (getDay(): 0=Sun..6=Sat).
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  return addDays(x, x.getDay() === 0 ? -6 : 1 - x.getDay());
}

function window(label: string, since: Date | null, until: Date | null): DateWindow {
  return { label, since: since?.getTime() ?? null, until: until?.getTime() ?? null };
}

export const SHORTCUTS = ['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'last-month'] as const;
export type Shortcut = typeof SHORTCUTS[number];

export function isShortcut(value: string): value is Shortcut {
  return (SHORTCUTS as readonly string[]).includes(value);
}

export function shortcutWindow(name: Shortcut, now: Date = new Date()): DateWindow {
  let since: Date;
  let until: Date;
  switch (name) {
    case 'today':
      since = startOfDay(now);
      until = addDays(since, 1);
      break;
    case 'yesterday':
      until = startOfDay(now);
      since = addDays(until, -1);
      break;
    case 'this-week':
      since = startOfWeek(now);
      until = addDays(since, 7);
      break;
    case 'last-week':
      until = startOfWeek(now);
      since = addDays(until, -7);
      break;
    case 'this-month':
      since = new Date(now.getFullYear(), now.getMonth(), 1);
      until = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      break;
    case 'last-month':
      since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      until = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
  }
  return window(`${name} (${dateKey(since.getTime())}..${dateKey(until.getTime())})`, since, until);
}

// "YYYY-MM" → that whole month.
export function monthWindow(value: string, flag = 'month'): DateWindow {
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (!m)
    throw new UsageError(`--${flag} must be YYYY-MM (e.g. 2025-03), got "${value}"`);
  const [y, mo] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12)
    throw new UsageError(`--${flag} must have a month between 01 and 12, got "${value}"`);
  return window(value, new Date(y, mo - 1, 1), new Date(y, mo, 1));
}

// "YYYY-MM-DD" → the Monday-based week containing that date.
export function weekWindow(value: string, flag = 'week'): DateWindow {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateBound(value) : null;
  if (since === null)
    throw new UsageError(`--${flag} must be YYYY-MM-DD (e.g. 2025-03-24), got "${value}"`);
  const monday = startOfWeek(new Date(since));
  return window(`week of ${dateKey(monday.getTime())}`, monday, addDays(monday, 7));
}

// Explicit bounds; either may be omitted (open-ended).
export function rangeWindow(since: string | undefined, until: string | undefined, label?: string): DateWindow {
  const parse = (value: string | undefined, name: string): number | null => {
    if (value === undefined || value === '')
      return null;
    const t = parseDateBound(value);
    if (t === null)
      throw new UsageError(`--${name} must be a valid date, got "${value}"`);
    return t;
  };
  const s = parse(since, 'since');
  const u = parse(until, 'until');
  if (s !== null && u !== null && s >= u)
    throw new UsageError(`--since must be before --until`);
  if (s === null && u === null)
    return { label: label ?? 'all time', since: null, until: null };
  return { label: label ?? `${since || 'beginning'} → ${until || 'now'}`, since: s, until: u };
}

// One spec string for a window, shared by --compare and the main range flags:
//   a shortcut (today, yesterday, this-week, last-week, this-month, last-month),
//   YYYY-MM (a whole month), or START..END with either side optional
//   (each side a date like YYYY-MM-DD or "YYYY-MM-DD HH:mm"; END is exclusive).
export function parseWindowSpec(spec: string, flag = 'compare', now: Date = new Date()): DateWindow {
  if (isShortcut(spec))
    return shortcutWindow(spec, now);
  if (/^\d{4}-\d{2}$/.test(spec))
    return monthWindow(spec, flag);
  const parts = spec.split('..');
  if (parts.length === 2 && (parts[0] || parts[1])) {
    try {
      return rangeWindow(parts[0], parts[1], spec);
    }
    catch (err) {
      throw new UsageError(`--${flag} range "${spec}": ${(err as Error).message.replace(/^--\w+ /, '')}`);
    }
  }
  throw new UsageError(`--${flag}: unrecognized window "${spec}". Expected one of: ${SHORTCUTS.join(', ')}, YYYY-MM, or START..END (e.g. 2025-03-01..2025-03-08)`);
}

export interface RangeFlags {
  month?: string;
  shortcuts: Shortcut[];
  since?: string;
  until?: string;
  week?: string;
}

// Resolve the main analysis window from the CLI flags, rejecting combinations
// that would silently override each other.
export function resolveWindow(flags: RangeFlags, now: Date = new Date()): DateWindow {
  const chosen: string[] = [
    ...flags.shortcuts.map(s => `--${s}`),
    ...(flags.month !== undefined ? ['--month'] : []),
    ...(flags.week !== undefined ? ['--week'] : []),
    ...(flags.since !== undefined || flags.until !== undefined ? ['--since/--until'] : []),
  ];
  if (chosen.length > 1)
    throw new UsageError(`only one date range may be given (got ${chosen.join(', ')})`);

  if (flags.shortcuts.length === 1)
    return shortcutWindow(flags.shortcuts[0], now);
  if (flags.month !== undefined)
    return monthWindow(flags.month);
  if (flags.week !== undefined)
    return weekWindow(flags.week);
  return rangeWindow(flags.since, flags.until);
}
