/** Dates are always computed in the pinned browser/provider zone, never the (UTC) runner zone. */
export const ZONE = 'Australia/Sydney';

export function sydneyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Calendar arithmetic on a yyyy-mm-dd string via Date.UTC so DST can never shift the result. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

/** Wednesday of next week, a stable "future working day" for roster and trip set-up. */
export function nextWednesday(today: string = sydneyToday()): string {
  return addDays(mondayOf(today), 9);
}

/** "Wednesday 14 October" */
export function longDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}
