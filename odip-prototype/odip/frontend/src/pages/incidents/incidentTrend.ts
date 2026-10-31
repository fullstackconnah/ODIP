import type { IncidentTrendDto, IncidentTrendMonthDto } from '@/api/types'

// Every string of the incidents-by-month card (shape brief 2026-10-31, "Copy"). Months are "yyyy-MM" strings split into parts, never `new Date(iso)`.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const num = (n: number) => n.toLocaleString('en-AU')
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`
const parts = (month: string) => month.split('-').map(Number) as [number, number]

export const TREND_TITLE = 'Incidents by month'
export const TREND_SCOPE = "Counted by the date each incident happened. Closed and archived reports count; drafts don't. The list's filters don't apply."
export const TREND_ERROR = "Couldn't load incidents by month. The list below is unaffected."
export const TREND_STALE = "The chart couldn't be refreshed, so it may be out of date."
export const TREND_LOADING = 'Loading incidents by month…'
export const TREND_LABEL = 'Incidents in each of the last 6 months, split into restrictive practice uses and other incidents.'
/** The longest sentence the card can show, laid out unseen while it loads. */
export const SENTENCE_SAMPLE = '1,240 incidents since November 2025, 1,000 of them restrictive practice uses. September had 240, down from 260 in August. Restrictive practice uses went from 120 to 100.'

/** "Sep" */
export function monthShort(month: string): string {
  return MONTHS[parts(month)[1] - 1].slice(0, 3)
}

const monthName = (month: string) => MONTHS[parts(month)[1] - 1]
/** "September 2026" */
const monthYear = (month: string) => `${monthName(month)} ${parts(month)[0]}`

/** The restrictive practice uses in a total, as a trailing clause: ", 3 of them restrictive practice uses". */
export function rpPart(t: number, r: number): string {
  if (r === 0) return t === 1 ? ', not a restrictive practice use' : ', none of them restrictive practice uses'
  if (r === t) return t === 1 ? ', a restrictive practice use' : ', all of them restrictive practice uses'
  return r === 1 ? ', 1 of them a restrictive practice use' : `, ${num(r)} of them restrictive practice uses`
}

/** A count of 0 inside a clause reads "none". */
const count = (n: number) => (n === 0 ? 'none' : num(n))

/** The claim the card carries. The current month is partial, so only the last two complete months are compared. */
export function trendSentence({ today, months }: IncidentTrendDto): string {
  const first = months[0].month
  const since = parts(first)[0] === parts(today)[0] ? monthName(first) : monthYear(first)
  const t = months.reduce((n, m) => n + m.incidents, 0)
  if (t === 0) return `No incidents have been reported since ${since}.`
  const r = months.reduce((n, m) => n + m.rpUses, 0)
  const only = months.find(m => m.incidents === t)
  const clause1 = only
    ? t === 1 ? `1 incident since ${since}, in ${monthName(only.month)}${rpPart(t, r)}.` : `${num(t)} incidents since ${since}, all in ${monthName(only.month)}${rpPart(t, r)}.`
    : `${num(t)} incidents since ${since}${rpPart(t, r)}.`
  const c = months[months.length - 2]
  const p = months[months.length - 3]
  const clause2 = c.incidents + p.incidents === 0 ? '' : c.incidents > p.incidents
    ? ` ${monthName(c.month)} had ${count(c.incidents)}, up from ${count(p.incidents)} in ${monthName(p.month)}.`
    : c.incidents < p.incidents
      ? ` ${monthName(c.month)} had ${count(c.incidents)}, down from ${count(p.incidents)} in ${monthName(p.month)}.`
      : ` ${monthName(c.month)} had ${count(c.incidents)}, the same as ${monthName(p.month)}.`
  const clause3 = c.rpUses === p.rpUses ? '' : ` Restrictive practice uses went from ${count(p.rpUses)} to ${count(c.rpUses)}.`
  return clause1 + clause2 + clause3
}

const isCurrent = (data: IncidentTrendDto, i: number) => i === data.months.length - 1

/** What a screen reader hears when the keyboard lands on a month. */
export function liveLine(data: IncidentTrendDto, i: number): string {
  const m = data.months[i]
  const label = monthYear(m.month)
  if (m.incidents === 0) return `${label}: no incidents.`
  return `${label}${isCurrent(data, i) ? ' so far' : ''}: ${plural(m.incidents, 'incident', 'incidents')}${rpPart(m.incidents, m.rpUses)}.`
}

/** The floating readout's text for one month. */
export function readoutRows(data: IncidentTrendDto, i: number) {
  const m: IncidentTrendMonthDto = data.months[i]
  return {
    header: `${monthYear(m.month)}${isCurrent(data, i) ? ' so far' : ''}`,
    empty: m.incidents === 0,
    rp: num(m.rpUses),
    rpText: m.rpUses === 1 ? 'restrictive practice use' : 'restrictive practice uses',
    other: num(m.otherIncidents),
    otherText: m.otherIncidents === 1 ? 'other incident' : 'other incidents',
    last: `${num(m.incidents)} in all`,
  }
}

export const TABLE_COLUMNS = ['Month', 'Incidents', 'Restrictive practice uses', 'Other incidents']

export const tableCaption = (data: IncidentTrendDto) => `Incidents by month, from ${monthYear(data.months[0].month)}`

export function tableRows(data: IncidentTrendDto) {
  return data.months.map((m, i) => ({
    header: `${monthYear(m.month)}${isCurrent(data, i) ? ' (so far)' : ''}`,
    cells: [num(m.incidents), num(m.rpUses), num(m.otherIncidents)],
  }))
}
