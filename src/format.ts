export function formatHours(hours: number): string {
  // Round to whole minutes first so e.g. 1.9999h renders as 02h 00m, not 01h 60m.
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

export function formatTimeOfDay(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatDateTime(date: Date): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const t = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  return `${d} ${t}`;
}

// Format a Date as a bare local-time string (no Z, no T): "YYYY-MM-DD HH:mm:ss".
// Git interprets this as local time, matching the local-time bucketing used by
// dateKey(). Using .toISOString() (UTC, with Z) would silently shift commits
// across day boundaries for non-UTC users.
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

export function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Policy: all date bucketing and formatting uses the user's local timezone.
// Commit timestamps from `git log %at` are absolute UTC instants; we project
// them into local time so "what day did I commit on" matches the user's wall
// clock. YYYY-MM-DD strings produced by dateKey are treated as local-midnight
// when re-parsed (via parseLocalDate), which avoids day-of-week / week-number
// drift for users in negative-offset timezones.

function parseLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dayName(key: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[parseLocalDate(key).getDay()];
}

// ISO 8601: weeks start Monday; week 1 contains the first Thursday.
// Algorithm: shift to the Thursday of the same week, then count weeks from
// the year-start Thursday.
export function isoWeekNumber(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const diffDays = (d.getTime() - firstThursday.getTime()) / 86_400_000;
  const weekNum = 1 + Math.round((diffDays - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `W${String(weekNum).padStart(2, '0')}`;
}
