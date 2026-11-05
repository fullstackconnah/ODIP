const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "2026-10-01" -> "October 2026". */
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

/** "2026-11-06" -> "Fri 6 Nov 2026". */
export function longDate(date: string) {
  const d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`
}

/** "2026-10-12T14:30:00" (the provider's wall clock) -> "Mon 12 Oct 2026, 14:30". */
export const usedAtLabel = (localDateTime: string) => `${longDate(localDateTime.slice(0, 10))}, ${localDateTime.slice(11, 16)}`

/** The first day of the month after `month`, as the lodge date's earliest value. */
export function nextMonthStart(month: string) {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

