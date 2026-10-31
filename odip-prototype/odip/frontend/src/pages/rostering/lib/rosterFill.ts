import type { RosterFillDto, RosterFillWeekDto } from '@/api/types'

// Every string of the roster fill card (shape brief 2026-10-31, section 4). Dates are calendar strings split into parts, never `new Date(iso)`.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const num = (n: number) => n.toLocaleString('en-AU')

export const FILL_TITLE = 'How full the next weeks are'
export const FILL_SCOPE = "Counts every shift, whatever the board's filters. Select a week to show it on the board."
export const FILL_ERROR = "Couldn't load how full the next weeks are. The board below is unaffected."
export const FILL_STALE = "The chart couldn't be refreshed, so it may be out of date."
export const FILL_LOADING = 'Loading how full the next weeks are…'
/** The longest sentence the card can show, laid out unseen while it loads. */
export const SENTENCE_SAMPLE = '184 of the 1,240 shifts in the next 8 weeks are open. The week of 5 Jan 2027 has the most: 48 of its 190. 1,000 of the 1,240 are still drafts. 3 of the weeks have nothing rostered yet.'

const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number]

/** "3 Nov" */
export function weekLabel(iso: string): string {
  const [, m, d] = parts(iso)
  return `${d} ${MONTHS[m - 1]}`
}

/** "3 Nov", with the year added when it differs from today's: "5 Jan 2027". */
function dated(iso: string, today: string): string {
  return parts(iso)[0] === parts(today)[0] ? weekLabel(iso) : `${weekLabel(iso)} ${parts(iso)[0]}`
}

/** Index of the first week in a later year than the first week drawn, or -1. */
export function yearBreakIndex(weeks: RosterFillWeekDto[]): number {
  if (weeks.length === 0) return -1
  const first = parts(weeks[0].weekStart)[0]
  return weeks.findIndex(w => parts(w.weekStart)[0] !== first)
}

function mondayOf(iso: string): string {
  const [y, m, d] = parts(iso)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

/** The first drawn week is "this week" when it starts on the Monday of the server's today. */
export function isFirstWeek(week: RosterFillWeekDto, today: string): boolean {
  return week.weekStart === mondayOf(today)
}

/** At most 1 decimal, en-AU, trailing ".0" dropped. */
export function hoursText(h: number): string {
  return h.toLocaleString('en-AU', { maximumFractionDigits: 1 })
}

export const plotLabel = (n: number) => `Shifts filled and open for each of the next ${n} weeks. Select a week to show it on the board.`

const draftText = (d: number) => (d === 1 ? '1 still a draft' : `${d} still drafts`)

export function fillSentence({ today, weeks }: RosterFillDto): string {
  const n = weeks.length
  const rostered = weeks.filter(w => w.shifts > 0)
  const R = rostered.length
  if (R === 0) return `Nothing is rostered for the next ${n} weeks yet.`
  const S = rostered.reduce((a, w) => a + w.shifts, 0)
  const O = rostered.reduce((a, w) => a + w.open, 0)
  const D = rostered.reduce((a, w) => a + w.draft, 0)
  const d = (w: RosterFillWeekDto) => dated(w.weekStart, today)
  let fill: string
  if (R === 1) {
    const w = rostered[0]
    fill = O > 0
      ? `Only the week of ${d(w)} has shifts so far: ${num(w.filled)} of ${num(w.shifts)} filled, ${num(w.open)} open.`
      : w.shifts === 1
        ? `Only the week of ${d(w)} has shifts so far, and its one shift is filled.`
        : `Only the week of ${d(w)} has shifts so far, and all ${num(w.shifts)} are filled.`
  } else if (O === 0) {
    fill = `All ${num(S)} shifts in the next ${n} weeks are filled.`
  } else {
    const most = rostered.reduce((best, w) => (w.open > best.open ? w : best))
    if (O === 1) fill = `1 of the ${num(S)} shifts in the next ${n} weeks is open, in the week of ${d(most)}.`
    else if (most.open === O) fill = `${num(O)} of the ${num(S)} shifts in the next ${n} weeks are open, all in the week of ${d(most)}.`
    else fill = `${num(O)} of the ${num(S)} shifts in the next ${n} weeks are open. The week of ${d(most)} has the most: ${num(most.open)} of its ${num(most.shifts)}.`
  }
  const out = [fill]
  if (D > 0) out.push(D === 1 ? `1 of the ${num(S)} is still a draft.` : D === S ? 'All of them are still drafts.' : `${num(D)} of the ${num(S)} are still drafts.`)
  const empty = weeks.filter(w => w.shifts === 0)
  if (R >= 2 && empty.length > 0) {
    out.push(empty.length === 1 ? `The week of ${d(empty[0])} has nothing rostered yet.`
      : empty.length === 2 ? `The weeks of ${d(empty[0])} and ${d(empty[1])} have nothing rostered yet.`
        : `${empty.length} of the weeks have nothing rostered yet.`)
  }
  return out.join(' ')
}

export type ReadoutRows = { header: string; empty: boolean; filled: string; open: string; hours: string; draft: string | null; last: string }

/** The floating readout (columns mode), or the detail line's parts. `touch` swaps the closing hint. */
export function readoutRows(week: RosterFillWeekDto, o: { today: string; boardWeek: string | undefined; touch: boolean }): ReadoutRows {
  const d = dated(week.weekStart, o.today)
  const last = week.weekStart === o.boardWeek ? 'On the board now' : o.touch ? 'Tap again to show it on the board' : 'Select to show it on the board'
  return {
    header: isFirstWeek(week, o.today) ? `This week, from ${d}` : `Week of ${d}`,
    empty: week.shifts === 0,
    filled: `${num(week.filled)} of ${num(week.shifts)}`,
    open: num(week.open),
    hours: `${hoursText(week.hoursFilled)} hours filled, ${hoursText(week.hoursOpen)} open`,
    draft: week.draft > 0 ? draftText(week.draft) : null,
    last,
  }
}

/** Rows mode: one line under the rows for the active week. Empty when no week is active or on the board. */
export function detailLine(week: RosterFillWeekDto | undefined, o: { today: string; boardWeek: string | undefined; touch: boolean }): string {
  if (!week) return ''
  const d = dated(week.weekStart, o.today)
  const end = week.weekStart === o.boardWeek ? 'On the board now.' : o.touch ? 'Tap again to show it on the board.' : 'Select to show it on the board.'
  if (week.shifts === 0) return `Week of ${d}: not rostered yet. ${end}`
  const drafts = week.draft > 0 ? ` ${week.draft === 1 ? '1 still a draft' : `${week.draft} still drafts`}.` : ''
  return `Week of ${d}: ${hoursText(week.hoursFilled)} hours filled, ${hoursText(week.hoursOpen)} open.${drafts} ${end}`
}

/** What a screen reader hears when the keyboard lands on a week. */
export function liveLine(week: RosterFillWeekDto, o: { today: string; boardWeek: string | undefined }): string {
  const d = dated(week.weekStart, o.today)
  const onBoard = week.weekStart === o.boardWeek
  const end = onBoard ? 'On the board now.' : 'Press Enter to show it on the board.'
  if (week.shifts === 0) return `Week of ${d}: not rostered yet. ${end}`
  const drafts = week.draft > 0 ? ` ${draftText(week.draft)}.` : ''
  return `Week of ${d}: ${num(week.filled)} of ${num(week.shifts)} filled, ${num(week.open)} open.${drafts} ${end}`
}

export const movedLine = (weekStart: string, today: string) => `Showing the week of ${dated(weekStart, today)} on the board.`

export const TABLE_COLUMNS = ['Week of', 'Shifts', 'Filled', 'Open', 'Hours filled', 'Hours open', 'Drafts']

export function tableRows({ today, weeks }: RosterFillDto, boardWeek: string | undefined) {
  return weeks.map(w => ({
    header: w.weekStart === boardWeek ? `${dated(w.weekStart, today)} (on the board)` : dated(w.weekStart, today),
    cells: w.shifts === 0
      ? ['Not rostered yet', 'none', 'none', 'none', 'none', 'none']
      : [num(w.shifts), num(w.filled), num(w.open), hoursText(w.hoursFilled), hoursText(w.hoursOpen), num(w.draft)],
  }))
}

export const tableCaption = (weeks: RosterFillWeekDto[], today: string) => `Shifts filled and open by week, from ${dated(weeks[0].weekStart, today)}`
