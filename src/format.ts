export function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

export function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayName(key: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[new Date(key).getDay()];
}

// ISO 8601: weeks start Monday; week 1 contains the first Thursday.
// Algorithm: shift to the Thursday of the same week, then count weeks from
// the year-start Thursday.
export function isoWeekNumber(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const diffDays = (d.getTime() - firstThursday.getTime()) / 86_400_000;
  const weekNum = 1 + Math.round((diffDays - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `W${String(weekNum).padStart(2, '0')}`;
}
