// The greeting and the date at the top of the dashboard: how the app says "good morning" and names today, in one place. Pure and JSX-free.
//
//   greetingFor(new Date(2026, 9, 2, 9, 30), 'Sarah Mitchell')  -> "Good morning, Sarah"
//   formatToday(new Date(2026, 9, 2, 9, 30))                    -> "Friday 2 October"
//
// Both read the VIEWER's wall clock: the hour on the screen, and the calendar day on the wall (`localIsoDate`, DESIGN.md "Time on the wire"), never
// the UTC date, which is still yesterday until 10:00 or 11:00 in Sydney. The browser has no provider zone of its own (the server resolves that from
// the provider's state), so the viewer's own day is the stand-in the rest of the app uses for "today". The names are fixed words, not Intl: en-AU
// punctuates a long date differently from one ICU build to the next, and a header string must not change with the browser.
import { localIsoDate } from './dateOnly'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
] as const

export type DayPart = 'morning' | 'afternoon' | 'evening'

/** Before noon is morning, before 6 pm is afternoon, and the rest of the day is evening. */
export function dayPartOf(now: Date): DayPart {
  const hour = now.getHours()
  if (hour < 12) return 'morning'
  return hour < 18 ? 'afternoon' : 'evening'
}

/** "Sarah" from "Sarah Mitchell": the first word of the full name the sign-in response carries. '' when there is no name to use. */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? ''
}

/** "Good morning, Sarah", or just "Good morning" when the name is not known. */
export function greetingFor(now: Date, fullName?: string | null): string {
  const hello = `Good ${dayPartOf(now)}`
  const name = firstNameOf(fullName)
  return name ? `${hello}, ${name}` : hello
}

/** Today's calendar day as the viewer's wall calendar shows it ("Friday 2 October"), or '' for an invalid Date. */
export function formatToday(now: Date): string {
  const iso = localIsoDate(now)
  if (!iso) return ''
  // A date-only ISO string is UTC midnight, so the UTC getters read that day itself in every zone.
  const day = new Date(iso)
  return `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`
}
