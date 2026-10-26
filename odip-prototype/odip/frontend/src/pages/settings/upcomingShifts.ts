import { addDays, format, parseISO } from 'date-fns'

// The dates an upcoming-shifts import allows. Mirrors ImportShiftRows on the server (PatternStartDays 28, MaxWeeks 12, DatedHorizonDays 83),
// which re-checks every one against the organisation's own "today". All values are yyyy-MM-dd days.
const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const plus = (day: string, days: number) => iso(addDays(parseISO(day), days))

/** The Monday after `today`: a Sunday or a Monday both give the next day-one of a week. */
export const nextMonday = (today: string) => plus(today, 8 - (parseISO(today).getDay() || 7))
/** A pattern may start from today up to 28 days ahead. */
export const maxFrom = (today: string) => plus(today, 28)
/** The last day of a pattern that starts on `from` and runs `weeks` weeks. */
export const spanEnd = (from: string, weeks: number) => plus(from, weeks * 7 - 1)
/** Dated rows may fall from today up to 12 weeks (83 days) ahead. */
export const datedLimit = (today: string) => plus(today, 83)

/** "Mon 2 Nov", the house day format. */
export const sayDay = (day: string) => format(parseISO(day), 'EEE d MMM')
export const spanLine = (from: string, weeks: number) => `Makes shifts from ${sayDay(from)} to ${sayDay(spanEnd(from, weeks))}.`
