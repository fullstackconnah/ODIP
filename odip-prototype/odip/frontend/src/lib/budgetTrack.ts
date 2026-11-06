import type { BudgetSeries, BudgetSeriesPoint, BudgetSeriesScope } from '@/api/types'
import { money, unpricedShiftSentence } from './budgetLedger'
import { formatDayMonth } from './dateRange'
import { plural } from './format'
import { writtenDay, writtenSpan } from './fundingPlan'

// How the budget graph reads (Funding tab): its one sentence, its footnotes, its ticks and its readout. The server works every figure out; nothing here adds anything up. These only decide
// how a figure is written and which words go with it. Pure, so the chart and its tests say the same thing.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** A date in a sentence: "4 Oct" inside today's year, "30 Jun 2027" across a year boundary (the paceSentence rule). */
export const sentenceDay = (iso: string, today: string) => (iso.slice(0, 4) === today.slice(0, 4) ? formatDayMonth(iso) : writtenDay(iso))

/** Whether the expected line is drawn for this scope: an agreement was priced, and it reaches this scope's money. */
export const expectedDrawn = (series: BudgetSeries, scope: BudgetSeriesScope) => series.expected.status === 'Ok' && scope.points.some(p => p.expected !== undefined)

/** The day the budget is (or at this rate will be) reached, and whether that is still ahead. A reach today counts as reached. */
export function limitReach(series: BudgetSeries, scope: BudgetSeriesScope): { on: string; ahead: boolean } | undefined {
  const on = scope.summary.limitReachedOn
  return on === undefined ? undefined : { on, ahead: series.planIsCurrent && on > series.today }
}

/** The card's focal line, for the scope on screen. */
export function budgetTrackSentence(series: BudgetSeries, scope: BudgetSeriesScope): string {
  const s = scope.summary
  const day = (iso: string) => sentenceDay(iso, series.today)
  const planEnd = series.planEnd ?? series.today
  const agreement = series.expected.status === 'Ok' && s.expectedEnd !== undefined

  if (!series.planIsCurrent) {
    const left = s.leftAtEnd ?? 0
    const after = left >= 0 ? `${money(left)} was left unused.` : `It finished ${money(-left)} over the budget.`
    const expected = agreement ? ` The agreement expected ${money(s.expectedEnd!)}.` : ''
    const reached = s.limitReachedOn ? ` It reached the budget on ${day(s.limitReachedOn)}.` : ''
    return `${scope.name}: used ${money(s.used)} of ${money(scope.limit)} over the plan, which ended on ${day(planEnd)}. ${after}${reached}${expected}`
  }

  const booked = s.bookedEnd !== undefined ? ` Booked shifts take it to ${money(s.bookedEnd)}.` : ''
  if (s.used === 0) return `${scope.name}: nothing used yet of ${money(scope.limit)}. An even spread would have used ${money(s.evenToDate)} by ${day(series.today)}.${booked}`

  const gap = Math.abs(s.aheadOfEven) < 0.005 ? 'in step with an even spread' : `${money(Math.abs(s.aheadOfEven))} ${s.aheadOfEven > 0 ? 'more' : 'less'} than an even spread`
  let sentence = `${scope.name}: used ${money(s.used)} of ${money(scope.limit)} so far, ${gap} by ${day(series.today)}.`
  const reach = limitReach(series, scope)
  if (reach && !reach.ahead) sentence += ` It reached the budget on ${day(reach.on)}.`
  if (s.pace !== undefined) {
    const end = s.paceGapAtEnd ?? 0
    const against = Math.abs(end) < 0.005 ? 'in line with the budget' : `${money(Math.abs(end))} ${end > 0 ? 'over' : 'under'} the budget`
    sentence += ` At this rate it reaches ${money(s.pace)} by ${day(planEnd)}, ${against}${reach?.ahead ? `, and reaches the budget on ${day(reach.on)}` : ''}.`
  }
  sentence += booked
  if (agreement) sentence += ` The agreement expects ${money(s.expectedEnd!)} by ${day(s.expectedEndDate ?? planEnd)}.`
  return sentence
}

/** The screen-reader table's caption: what it covers, the limit, when the plan ends, and when the budget is or will be reached. */
export function budgetTrackCaption(series: BudgetSeries, scope: BudgetSeriesScope): string {
  const start = series.planStart ?? scope.points[0].date
  const end = series.planEnd ?? scope.points[scope.points.length - 1].date
  const reach = limitReach(series, scope)
  const reached = !reach ? '' : reach.ahead ? ` At this rate it reaches the budget on ${sentenceDay(reach.on, series.today)}.` : ` It reached the budget on ${sentenceDay(reach.on, series.today)}.`
  return `Weekly figures for ${scope.name}, ${writtenSpan(start, end)}. Budget ${money(scope.limit)}. Plan ${series.planIsCurrent ? 'ends' : 'ended'} ${writtenDay(end)}.${reached}`
}

export interface BudgetTrackFootnote {
  text: string
  tone: 'muted' | 'warning'
}

/** The one footnote every drawn expected line carries; the loading card lays it out unseen to hold its height. */
export const EXPECTED_FOOTNOTE = "Expected re-prices the current agreement on the NDIS price list for each date, so it can differ from the total that was approved."

/** The notes under the chart, in order: the agreement's revisions and edges, why there is no expected line, what is left out, and that the expected line is an estimate. */
export function budgetTrackFootnotes(series: BudgetSeries, scope: BudgetSeriesScope): BudgetTrackFootnote[] {
  const notes: BudgetTrackFootnote[] = []
  const muted = (text: string) => notes.push({ text, tone: 'muted' })
  const drawn = expectedDrawn(series, scope)
  const { expected } = series
  if (drawn) {
    for (const change of expected.revisionChanges) muted(`The agreement changed on ${writtenDay(change)}; the expected line follows each version for its own dates.`)
    if (expected.startsOn) muted(`The agreement starts on ${writtenDay(expected.startsOn)}, so the expected line starts there.`)
    if (expected.endsOn) muted(`The agreement ends on ${writtenDay(expected.endsOn)}, so the expected line stops there.`)
  }
  if (expected.status === 'NoAgreement') muted("No approved service agreement with a weekly routine covers this plan, so there's no expected line.")
  if (expected.status === 'Unavailable') muted("The expected line couldn't be worked out just now. It will show the next time this tab loads.")
  const lines = expected.unpricedLineCount
  if (drawn && lines > 0)
    muted(`${plural(lines, 'line')} of the agreement ${lines === 1 ? 'has' : 'have'} no price on the NDIS price list for each date, so the expected line leaves ${lines === 1 ? 'it' : 'them'} out.`)
  if (scope.unpricedShiftCount > 0) notes.push({ text: unpricedShiftSentence(scope.unpricedShiftCount, scope.unpricedShiftReasons), tone: 'warning' })
  if (drawn) muted(EXPECTED_FOOTNOTE)
  return notes
}

const compact = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 })

/** An axis tick: "$0", "$10K", "$12.5K", "$1.2M". Only ticks are compact; every other figure is money(). */
export const compactAud = (n: number) => compact.format(n)

/** The y ticks from $0: 5 on a plot 200px tall or more, else 3, stepped by 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10 × 10ⁿ so the top tick covers `max` and stays under 1.5 times it (not 1.25: compact labels would round 3,750 to "$3.8K"). */
export function yTicks(max: number, plotH: number): number[] {
  const gaps = plotH >= 200 ? 4 : 2
  const raw = Math.max(max, 1) / gaps
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(m => m * magnitude).find(s => s >= raw)!
  return Array.from({ length: gaps + 1 }, (_, i) => i * step)
}

/** Month-start ticks inside the plan, stepped by 1, 2, 3, 6 or 12 months so at most one fits every 64px. "Jan" carries its year, and so does the first tick. */
export function xTicks(planStart: string, planEnd: string, plotW: number): Array<{ date: string; label: string }> {
  const [y0, m0, d0] = planStart.split('-').map(Number)
  const months: Array<{ y: number; m: number }> = []
  for (let y = y0, m = d0 === 1 ? m0 - 1 : m0; ; m++) {
    if (m === 12) { m = 0; y++ }
    const date = `${y}-${String(m + 1).padStart(2, '0')}-01`
    if (date > planEnd) break
    months.push({ y, m })
  }
  const fits = Math.max(1, Math.floor(plotW / 64))
  const step = [1, 2, 3, 6, 12].find(n => Math.ceil(months.length / n) <= fits) ?? 12
  return months
    .filter((_, i) => i % step === 0)
    .map(({ y, m }, i) => ({ date: `${y}-${String(m + 1).padStart(2, '0')}-01`, label: m === 0 || i === 0 ? `${MONTHS[m]} ${y}` : MONTHS[m] }))
}

/** The readout's and the table's heading for a point: "Plan start, 1 Jul 2026", "Today, 4 Oct", "Plan end, 30 Jun 2027" or "Week to 12 Jan 2027". */
export function readoutHeader(point: BudgetSeriesPoint, series: BudgetSeries): string {
  if (point.date === series.planStart && point.budget === 0) return `Plan start, ${writtenDay(point.date)}`   // the start-of-day point; a today point on the plan start carries that day's budget
  if (point.date === series.today && series.planIsCurrent) return `Today, ${formatDayMonth(point.date)}`
  if (point.date === series.planEnd) return `Plan end, ${writtenDay(point.date)}`
  return `Week to ${writtenDay(point.date)}`
}

export interface ReadoutRow {
  series: 'budget' | 'used' | 'booked' | 'expected'
  label: string
  value: string
}

/** The readout's rows for stop `index`: the budget, used (or used and booked, after today), and expected, plus "Agreement revised 1 Dec" on the stop a revision falls in and, from the week the budget is reached, "Over the budget from 14 Mar at this rate". */
export function readoutRows(stops: BudgetSeriesPoint[], index: number, series: BudgetSeries, scope?: BudgetSeriesScope): { rows: ReadoutRow[]; note?: string; over?: string } {
  const point = stops[index]
  const rows: ReadoutRow[] = [{ series: 'budget', label: 'Budget, spread evenly', value: money(point.budget) }]
  const afterToday = !series.planIsCurrent ? false : point.date > series.today
  if (afterToday && point.usedAndBooked !== undefined) rows.push({ series: 'booked', label: 'Used and booked', value: money(point.usedAndBooked) })
  else if (point.used !== undefined) rows.push({ series: 'used', label: 'Used', value: money(point.used) })
  if (series.expected.status === 'Ok') rows.push({ series: 'expected', label: 'Expected', value: point.expected === undefined ? 'Not covered' : money(point.expected) })
  const previous = stops[index - 1]?.date ?? ''
  const change = series.expected.status === 'Ok' ? series.expected.revisionChanges.find(d => d > previous && d <= point.date) : undefined
  const reach = scope && limitReach(series, scope)
  const over = reach && point.date >= reach.on ? (reach.ahead ? `Over the budget from ${sentenceDay(reach.on, series.today)} at this rate` : `Over the budget since ${sentenceDay(reach.on, series.today)}`) : undefined
  return { rows, note: change ? `Agreement revised ${formatDayMonth(change)}` : undefined, over }
}

/** What the polite live region says on each keyboard step: the readout in one line. */
export function liveLine(stops: BudgetSeriesPoint[], index: number, series: BudgetSeries): string {
  const { rows } = readoutRows(stops, index, series)
  const parts = rows.map(r => `${r.label === 'Budget, spread evenly' ? 'budget' : r.label.toLowerCase()} ${r.value === 'Not covered' ? 'not covered' : r.value}`)
  return `${readoutHeader(stops[index], series)}: ${parts.join(', ')}.`
}

/** The plot's height for a width: 2:1 between 440 and 720, never under 220 or over 360. */
export const chartHeight = (width: number) => Math.min(360, Math.max(220, Math.round(width / 2)))
