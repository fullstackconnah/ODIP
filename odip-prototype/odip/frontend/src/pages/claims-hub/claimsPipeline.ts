import type { PipelineDto } from '@/api/types'
import { formatCurrency } from '@/lib/utils'

// Every string of the claims sent-and-paid-by-week card (shape brief 2026-11-01, "Copy"). Weeks are "yyyy-MM-dd" Mondays split into parts, never `new Date(iso)`.
// Money is formatted by formatCurrency (cents always), the same as the hub's tables; only the axis ticks are compact.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const parts = (date: string) => date.split('-').map(Number) as [number, number, number]

export const PIPELINE_TITLE = 'Claims sent and paid by week'
export const PIPELINE_SCOPE = 'NDIA-managed claims sent in files from this page, by the week each file was confirmed uploaded and the week each line was marked paid. A line sent again counts again.'
export const PIPELINE_LABEL = 'Dollars sent to the NDIA and paid in each of the last 12 weeks.'
export const PIPELINE_ERROR = "Couldn't load claims sent and paid by week. The rest of this page is unaffected."
export const PIPELINE_STALE = "The chart couldn't be refreshed, so it may be out of date."
export const PIPELINE_LOADING = 'Loading claims sent and paid by week…'
export const PIPELINE_EMPTY = 'Nothing has been sent to the NDIA from this page in the last 12 weeks.'
/** The longest sentence the card can show, laid out unseen while it loads. */
export const SENTENCE_SAMPLE = "$1,234,567.89 sent to the NDIA in the last 12 weeks and $1,234,567.89 paid. $1,234,567.89 is waiting on the NDIA's results and $1,234,567.89 is accepted but not paid yet."
/** The longest scope-adjacent line, laid out unseen while it loads. */
export const FOOTNOTE_SAMPLE = "$1,234,567.89 paid before payments were dated isn't shown in the weeks."

/** "26 Oct" */
export function weekShort(weekStart: string): string {
  const [, m, d] = parts(weekStart)
  return `${d} ${MONTHS[m - 1].slice(0, 3)}`
}

const weekLong = (weekStart: string) => {
  const [, m, d] = parts(weekStart)
  return `${d} ${MONTHS[m - 1]}`
}

const isCurrent = (data: PipelineDto, i: number) => i === data.weeks.length - 1
const cents = (n: number) => Math.round(n * 100)
/** A total over weeks, added in whole cents so 0.1 + 0.2 is $0.30. */
const total = (data: PipelineDto, pick: (w: PipelineDto['weeks'][number]) => number) => formatCurrency(data.weeks.reduce((n, w) => n + cents(pick(w)), 0) / 100)

/** The weeks that carry an x label: all of them when wide, else every third counting back from the current week (12, 9, 6, 3). */
export function labelledWeeks(count: number, narrow: boolean): number[] {
  return Array.from({ length: count }, (_, i) => i).filter(i => !narrow || (count - 1 - i) % 3 === 0)
}

const owedClause = (data: PipelineDto) => {
  const waiting = data.withNdia > 0
  const accepted = data.acceptedUnpaid > 0
  if (waiting && accepted) return ` ${formatCurrency(data.withNdia)} is waiting on the NDIA's results and ${formatCurrency(data.acceptedUnpaid)} is accepted but not paid yet.`
  if (waiting) return ` ${formatCurrency(data.withNdia)} is waiting on the NDIA's results.`
  if (accepted) return ` ${formatCurrency(data.acceptedUnpaid)} is accepted but not paid yet.`
  return ' Nothing is waiting on the NDIA.'
}

/** No dollars sent or paid in any of the 12 weeks. */
export const weeksEmpty = (data: PipelineDto) => data.weeks.every(w => w.sent === 0 && w.paid === 0)

/** The claim the card carries: what went out and came back over the window, then where the money stands today. */
export function pipelineSentence(data: PipelineDto): string {
  if (weeksEmpty(data)) return PIPELINE_EMPTY + owedClause(data)
  return `${total(data, w => w.sent)} sent to the NDIA in the last 12 weeks and ${total(data, w => w.paid)} paid.${owedClause(data)}`
}

export const rejectedLink = (n: number) => (n === 1 ? '1 rejected line needs action' : `${n.toLocaleString('en-AU')} rejected lines need action`)
export const undatedFootnote = (amount: number) => `${formatCurrency(amount)} paid before payments were dated isn't shown in the weeks.`

const header = (data: PipelineDto, i: number) => `Week of ${weekLong(data.weeks[i].weekStart)}${isCurrent(data, i) ? ' (so far)' : ''}`

/** What a screen reader hears when the keyboard lands on a week. */
export function liveLine(data: PipelineDto, i: number): string {
  const w = data.weeks[i]
  return `Week of ${weekLong(w.weekStart)}: ${formatCurrency(w.sent)} sent, ${formatCurrency(w.paid)} paid, ${formatCurrency(w.rejected)} rejected.`
}

/** The floating readout's text for one week. */
export function readoutRows(data: PipelineDto, i: number) {
  const w = data.weeks[i]
  return {
    header: header(data, i),
    empty: w.sent === 0 && w.paid === 0 && w.rejected === 0,
    sent: formatCurrency(w.sent),
    paid: formatCurrency(w.paid),
    rejected: w.rejectedLines === 0 && w.rejected === 0 ? 'Nothing rejected' : `Rejected ${formatCurrency(w.rejected)} (${w.rejectedLines === 1 ? '1 line' : `${w.rejectedLines.toLocaleString('en-AU')} lines`})`,
  }
}

export const TABLE_COLUMNS = ['Week', 'Sent', 'Paid', 'Rejected']

export const tableCaption = (data: PipelineDto) => {
  const [y, m, d] = parts(data.weeks[0].weekStart)
  return `Claims sent and paid by week, from the week of ${d} ${MONTHS[m - 1]} ${y}`
}

export function tableRows(data: PipelineDto) {
  return data.weeks.map((w, i) => ({ header: header(data, i), cells: [formatCurrency(w.sent), formatCurrency(w.paid), formatCurrency(w.rejected)] }))
}
