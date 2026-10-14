// What the agreement wizard does with the pricing engine's answer, pure and JSX-free: which week stands for "a week", what each refusal means in plain words, how a plan compares with its budget, and what a failed request says.
// The engine is the authority on every number: nothing here prices anything, and a line's total is always the server's total.
import type { AxiosError } from 'axios'
import type { PlanFailureReason, PlanIssue, PlanBlock, PlanQuote } from '@/api/types'
import { isDateOnly, parseDateOnly, formatDayNumber } from './dateOnly'
import type { PlanStepKey } from './planBlocks'
import { plural } from './format'
import { apiErrorMessages } from './shiftPackageErrors'

// ── Dates ─────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** "Mon 5 Oct 2026": fixed words and day arithmetic, never Intl (a clock change or an ICU build cannot move it). '' for anything that is not a date. */
export function formatServiceDate(iso: string | null | undefined): string {
  const day = parseDateOnly(iso)
  if (day === null) return ''
  const date = new Date(day * 86_400_000)
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** The calendar day after `iso`. */
export function addDays(iso: string, days: number): string {
  const day = parseDateOnly(iso)
  return day === null ? iso : formatDayNumber(day + days)
}

/** The years the pricing engine answers for. */
export const PRICING_FIRST_YEAR = 2000
export const PRICING_LAST_YEAR = 2100

/**
 * "YYYY-MM-DD", a real day, in the years the engine prices. A date box lets a person type a year with five or six digits, which is no date to the server (a 400 the screen could not
 * read, review F1), and "2026-02-30" is no day: such a date is never sent to price anything.
 */
export function isPricingDate(value: string | null | undefined): boolean {
  if (!value || !isDateOnly(value) || parseDateOnly(value) === null) return false
  const year = Number(value.slice(0, 4))
  return year >= PRICING_FIRST_YEAR && year <= PRICING_LAST_YEAR
}

export type PeriodProblem = 'blank' | 'invalid' | 'reversed'

/**
 * What is wrong with the agreement's dates, or null when the plan can be priced over them: a date that is not typed (`blank`), one that is typed and is no day the engine prices (`invalid`: a
 * year of five digits, 30 February), and an end before the start (`reversed`), compared as days and not as text. Nothing is asked of the engine for any of them, so the screen has to say
 * so itself: it used to say "Pricing the plan..." with nothing in flight, or show the answer for the dates it had before (review N1).
 */
export function periodProblem(from: string, to: string): PeriodProblem | null {
  if (!from || !to) return 'blank'
  if (!isPricingDate(from) || !isPricingDate(to)) return 'invalid'
  return (parseDateOnly(from) as number) > (parseDateOnly(to) as number) ? 'reversed' : null
}

// ── "A week" ──────────────────────────────────────────────────────────────────

export interface ReferenceWeek { from: string; to: string }

/**
 * The seven days that stand for an ordinary week of the agreement: the first run of seven days from its start that no block meets a public holiday in, else the first seven.
 * Every weekday is in it once, so a block's weekly hours and cost are what it asks for in a week. null when the agreement is shorter than a week (a part week is not "a week").
 */
export function referenceWeek(from: string, to: string, holidayDates: readonly string[]): ReferenceWeek | null {
  const first = parseDateOnly(from), last = parseDateOnly(to)
  if (first === null || last === null || last - first + 1 < 7) return null
  const holidays = new Set(holidayDates.map(date => parseDateOnly(date)).filter((day): day is number => day !== null))
  const clean = (start: number) => { for (let day = start; day < start + 7; day += 1) if (holidays.has(day)) return false; return true }
  for (let start = first; start + 6 <= last; start += 7) {
    if (clean(start)) return { from: formatDayNumber(start), to: formatDayNumber(start + 6) }
  }
  return { from: formatDayNumber(first), to: formatDayNumber(first + 6) }
}

/** A figure that is not known, or that nothing can say: an en dash, as the dashboard's tiles do (DESIGN.md, The Quiet Zero Rule), never a 0 that reads as a price. */
export const NO_FIGURE = '–'

// ── What each refusal means, and what to do ───────────────────────────────────

export interface ReasonCopy {
  title: string
  advice: string
  /** The step where it is fixed. */
  step?: PlanStepKey
  /** The engine priced nothing from the block (or refused the plan): a revision cannot be saved until it is fixed. */
  refusal: boolean
}

export const REASON_COPY: Record<PlanFailureReason, ReasonCopy> = {
  InvalidInput: { title: 'A block breaks a rule', advice: 'Fix the field the message names. Nothing is priced from this block until it does.', step: 'times', refusal: true },
  RegistrationGroupNotHeld: { title: 'Your organisation does not hold this registration group', advice: 'Choose another support type, or an Admin can record the groups you hold in Settings, Plan pricing.', step: 'requirements', refusal: true },
  StaLegacyNotSupported: { title: 'Short-term accommodation is set to the legacy per-day items', advice: 'Those items end on 30 June 2027. An Admin can switch to the hourly items plus accommodation nights in Settings, Plan pricing.', refusal: true },
  NoItem: { title: 'Part of this block has no price item', advice: 'That part is left out of every total. Community access and group activities have no item between 00:00 and 06:00 on a weekday: keep the block clear of those hours, or use personal care.', step: 'times', refusal: false },
  CatalogueNotFound: { title: 'No catalogue prices for part of the agreement', advice: 'The support catalogue has not been imported for some of these dates, so those lines have no price. A SuperAdmin can import it in Settings, or shorten the agreement.', refusal: false },
  CatalogueAmbiguous: { title: 'Two catalogue prices clash', advice: 'Two rows of one catalogue version are valid on the same date. A SuperAdmin needs to fix the catalogue before this can be priced.', refusal: false },
  ZoneNotEligible: { title: 'This item has no price for the delivery zone', advice: 'The catalogue lists no price for this item in the price zone. Check the zone in the agreement details.', refusal: false },
  CatalogueNotPriced: { title: 'This item has no price limit', advice: 'The catalogue marks this item as quotable, so there is no maximum to price from.', refusal: false },
  UnexpectedUnit: { title: 'The catalogue item is not priced the way this line needs', advice: 'The item is not an hourly item, so a quantity of hours cannot be priced from it.', refusal: false },
  SleepoverNotAvailable: { title: 'This support type has no sleepover item', advice: 'Only personal care and short-term accommodation have one. Turn the sleepover off, or change the support type.', step: 'requirements', refusal: false },
  SleepoverNotQualifying: { title: 'The worker may sleep, but this is not a sleepover', advice: 'A sleepover needs 8 hours or more across midnight. It is priced by the hour and left for a person to look at.', step: 'times', refusal: false },
  TransportNotAvailable: { title: 'Transport does not go with this support type', advice: 'Activity-based transport goes with community access and group activities only.', step: 'travel', refusal: false },
  AccommodationNotAvailable: { title: 'Accommodation nights are a short-term accommodation item', advice: 'Use a short-term accommodation block for accommodation nights.', step: 'travel', refusal: false },
  TravelNotClaimable: { title: 'This item does not allow provider travel', advice: 'The support item for this block cannot carry provider travel, so no travel is priced.', step: 'travel', refusal: false },
  SleepoverClockChange: { title: 'The clocks change during this sleepover', advice: 'NDIA has not said how the 8 hours count on that night (question 13). It is priced on elapsed hours and marked provisional.', refusal: false },
  NamedDateNotInCalendar: { title: 'A public holiday is missing from the state calendar', advice: 'It is priced as an ordinary day and left for a person to decide. Choose Charge to price it as a public holiday, or Skip to drop the shift.', step: 'review', refusal: false },
  BlocksOverlap: { title: 'Two blocks are on at the same time', advice: 'The same hour would be priced twice. Move one block, or make it one block with 2 workers.', step: 'times', refusal: false },
  SupportInSkippedHour: { title: 'The whole support falls in the hour the clocks skip', advice: 'There is no time in it to price. Move the block out of that hour.', step: 'times', refusal: false },
}

/** The reasons that stop a revision being saved: the engine priced nothing from the block, or refused the plan. */
export function isRefusal(reason: PlanFailureReason): boolean {
  return REASON_COPY[reason]?.refusal ?? false
}

/** The issues of a quote that stop a save, in the order the engine gave them. */
export function refusals(issues: readonly PlanIssue[]): PlanIssue[] {
  return issues.filter(issue => isRefusal(issue.reason))
}

/** Reasons whose message says which thing is wrong (a field, a pair of blocks), so two of them are two problems. The rest are one problem met on several items. */
const ONE_PER_MESSAGE = new Set<PlanFailureReason>(['InvalidInput', 'BlocksOverlap'])

function mergeIssues(issues: readonly PlanIssue[], keyOf: (issue: PlanIssue) => string): PlanIssue[] {
  const merged = new Map<string, PlanIssue>()
  for (const issue of issues) {
    const key = keyOf(issue)
    const seen = merged.get(key)
    if (!seen) { merged.set(key, issue); continue }
    const earlier = !!issue.firstDate && (!seen.firstDate || issue.firstDate < seen.firstDate)
    // The same shift can carry several items, one message each: the shifts are counted once, so the larger count stands (a lower bound where they touch different shifts, never more).
    merged.set(key, { ...(earlier ? issue : seen), count: Math.max(seen.count, issue.count) })
  }
  return [...merged.values()]
}

/**
 * The engine keeps one issue for each block, reason and message, with the shifts it met it on; a block with two items missing from the catalogue has two, each counting the same shifts. A
 * person reads them as one: the message and the first day of the earliest, and the shifts counted once.
 */
export function groupIssues(issues: readonly PlanIssue[]): PlanIssue[] {
  return mergeIssues(issues, issue => `${issue.blockId}|${issue.reason}|${ONE_PER_MESSAGE.has(issue.reason) ? issue.message : ''}`)
}

/** Where an issue was met, in words: "24 shifts, the first on Tue 13 Oct 2026", or just the day when it was met once. */
export function issueWhere(issue: PlanIssue): string {
  if (issue.count > 1) return `${plural(issue.count, 'shift')}${issue.firstDate ? `, the first on ${formatServiceDate(issue.firstDate)}` : ''}`
  return issue.firstDate ? formatServiceDate(issue.firstDate) : ''
}

/**
 * The engine names a block by the id the screen gave it ("Block 'b2'", and for an overlap "Blocks 'b1' and 'b2'"); a coordinator knows it by its place in the plan ("Block 2",
 * "Blocks 1 and 2"). An id that is not in the plan is left as the engine wrote it. Its dates are ISO ("2027-07-05"), beside the en-AU ones the screen writes ("Mon 5 Jul 2027") in the same
 * sentence, so they are written the same way.
 */
export function friendlyMessage(message: string, blocks: readonly PlanBlock[]): string {
  const place = (id: string) => blocks.findIndex(block => block.id === id) + 1
  return message
    .replace(/Blocks '([^']+)' and '([^']+)'/g, (whole, first: string, second: string) => (place(first) > 0 && place(second) > 0 ? `Blocks ${place(first)} and ${place(second)}` : whole))
    .replace(/Block '([^']+)'/g, (whole, id: string) => (place(id) > 0 ? `Block ${place(id)}` : whole))
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (whole, iso: string) => formatServiceDate(iso) || whole)
}

/**
 * The reasons that mean something a person asked for has no price: a line, or a part of one, is not in any total. A refusal (nothing at all priced from the block), a flag that is only for
 * review (a sleepover that does not qualify, a day the calendar lacks, a night when the clocks change) and an overlap are something else.
 */
const LEFT_OUT: ReadonlySet<PlanFailureReason> = new Set<PlanFailureReason>([
  'NoItem', 'CatalogueNotFound', 'CatalogueAmbiguous', 'ZoneNotEligible', 'CatalogueNotPriced', 'UnexpectedUnit', 'SleepoverNotAvailable', 'TransportNotAvailable', 'AccommodationNotAvailable',
  'TravelNotClaimable', 'SupportInSkippedHour',
])

/**
 * How many shifts have a part that is not priced. A shift can be short of several items (one issue each, counting the same shifts), so a block counts its largest, and the blocks add up:
 * a figure that is never more than the truth, in the unit a coordinator thinks in. (The engine's own count of lines is shifts times items, and means nothing on a screen.)
 */
export function shiftsNotPriced(issues: readonly PlanIssue[]): number {
  const byBlock = new Map<string, number>()
  for (const issue of groupIssues(issues)) {
    if (LEFT_OUT.has(issue.reason)) byBlock.set(issue.blockId, Math.max(byBlock.get(issue.blockId) ?? 0, issue.count))
  }
  return [...byBlock.values()].reduce((sum, count) => sum + count, 0)
}

/**
 * Whether `shiftsNotPriced` is a lower bound and not the count. A block with one issue counts exactly the shifts it was met on. A block with several (two items missing, or two gaps in the
 * catalogue) counts its largest, and the others may touch shifts that one did not: the figure is then "at least", and printing it as exact overstated what is known (review N10).
 */
export function shiftsNotPricedAtLeast(issues: readonly PlanIssue[]): boolean {
  const perBlock = new Map<string, number>()
  for (const issue of issues) {
    if (LEFT_OUT.has(issue.reason)) perBlock.set(issue.blockId, (perBlock.get(issue.blockId) ?? 0) + 1)
  }
  return [...perBlock.values()].some(count => count > 1)
}

/**
 * What the figures beside it leave out or cannot yet say, in one line, in shifts with their nouns: "186 shifts with a part not priced · 1 block cannot be priced · 15 public holiday
 * shifts to decide · some lines use provisional rates", and "at least 186 shifts..." when the count is a lower bound (`shiftsNotPricedAtLeast`). Nothing for what is not so. `notFullyPriced`
 * is true when anything is missing from the totals (a part not priced, or a block that cannot be priced at all): a total that leaves work out has to say so beside the figure.
 */
export function totalsCaption(answer: Pick<PlanQuote, 'issues' | 'holidayOccurrences' | 'totals'>): { text: string; notFullyPriced: boolean } {
  const notPriced = shiftsNotPriced(answer.issues)
  const refused = new Set(refusals(answer.issues).map(issue => issue.blockId)).size
  const holidays = answer.holidayOccurrences.filter(occurrence => occurrence.decision === 'Review' && !occurrence.skipped).length
  const parts: string[] = []
  if (notPriced > 0) parts.push(`${shiftsNotPricedAtLeast(answer.issues) ? 'at least ' : ''}${plural(notPriced, 'shift')} with a part not priced`)
  if (refused > 0) parts.push(`${plural(refused, 'block')} cannot be priced`)
  if (holidays > 0) parts.push(`${plural(holidays, 'public holiday shift')} to decide`)
  if (answer.totals.provisionalLines > 0) parts.push('some lines use provisional rates')
  return { text: parts.join(' · '), notFullyPriced: notPriced > 0 || refused > 0 }
}

/** A caption stands on a line of its own in the bar and in Review, so what it starts with has a capital there ("At least 10 shifts...", "Some lines use provisional rates"). */
export function asSentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The answer priced nothing: not one line has a price (each is missing one, or the engine refused every block, or there is no shift in the period). A total of $0.00 beside that would read as a
 * price, and "all of the plan budget is left" as a fact, and neither is: the screen shows an en dash (review N6).
 */
export function pricedNothing(answer: Pick<PlanQuote, 'totals'>): boolean {
  return answer.totals.lineCount - answer.totals.unpricedLines <= 0
}

// ── The budget categories ─────────────────────────────────────────────────────
// (The agreement is compared with the participant's real pools by the server - POST participants/{id}/funding/agreement-check - and not here: the sum of the Billing funding sources this file used
// to compare it with is gone, with no fallback.)

/** The PACE categories the engine totals by, in words short enough for a bar. */
export const CATEGORY_SHORT: Record<number, string> = { 1: 'Daily life', 2: 'Transport', 4: 'Community participation', 16: 'Home and living' }

export function categoryLabel(category: { paceCategory: number; name: string }): string {
  return CATEGORY_SHORT[category.paceCategory] ?? (category.name || `Category ${category.paceCategory}`)
}

// ── When a request fails ──────────────────────────────────────────────────────

export interface FriendlyError {
  title: string
  detail: string
  /** Trying again can help (the service was busy, or the connection dropped). */
  retryable: boolean
}

function statusOf(error: unknown): number | undefined {
  return (error as AxiosError | undefined)?.response?.status
}

/**
 * The server's own words for what went wrong. The app's envelope sends `errors` as a list; a request the framework refuses before the action runs (a number box that was cleared and
 * became null, a date with five digits in its year) is a ValidationProblemDetails whose `errors` is an OBJECT keyed by field. apiErrorMessages reads both; spreading the object threw
 * inside render and took the unsaved plan with it (review F1). Never throws.
 */
function messagesOf(error: unknown): string[] {
  return apiErrorMessages(error).filter((text): text is string => typeof text === 'string' && text.length > 0)
}

/** Text the framework writes about a value it could not bind: true of the plan's own sentences never, and of no use to a person. */
const FRAMEWORK_TEXT = /JSON value could not be converted|Path: \$|LineNumber|BytePositionInLine|is not valid for|non-empty request body is required|could not be mapped/i
export const CLEARED_BOX_MESSAGE = 'A box in the plan is empty or is not a number. Check the days, times and numbers on each step.'

/** The server's sentence as a person should read it: the framework's binding errors become one plain line, everything the engine itself said stays as it was. */
function plain(text: string): string {
  return FRAMEWORK_TEXT.test(text) ? CLEARED_BOX_MESSAGE : text
}

/** What a failed quote says: the busy service, an answer too big to list, a refusal in the server's words, and a dropped connection are four different things. */
export function describeQuoteError(error: unknown): FriendlyError {
  const status = statusOf(error)
  const messages = messagesOf(error)
  // The hooks have already asked a few times by the time this shows (a 429 is retried after the pause the server names), so it does not promise another try: it offers one.
  if (status === 429) return { title: 'The pricing service is busy', detail: 'Other plans for your organisation are being priced right now. It asked a few times and the service is still busy: try again in a moment.', retryable: true }
  if (status === 400 && messages.some(text => /ask for the totals only|one answer carries/i.test(text))) {
    return { title: 'This plan has too many lines to list', detail: 'The agreement and its blocks make more lines than one answer can carry. Shorten the agreement period or price fewer blocks; the totals are still worked out.', retryable: false }
  }
  if (status === 400) return { title: 'This plan cannot be priced yet', detail: plain(messages[0] ?? 'The pricing service refused the request.'), retryable: false }
  if (status === 403) return { title: 'You cannot price plans', detail: 'Pricing is for Admins and Coordinators. Ask one of them to build the plan.', retryable: false }
  if (status === 413) return { title: 'The plan is too large to send', detail: 'Price fewer blocks at a time.', retryable: false }
  return { title: 'The plan could not be priced', detail: 'Check your connection and try again. Nothing you entered is lost.', retryable: true }
}

/** The newer version a save was refused for (409, code "draft-version-conflict": somebody else saved first), or null for any other failure, including any other 409. */
export function conflictVersionOf(error: unknown): number | null {
  const response = (error as AxiosError<{ code?: string; data?: { currentVersion?: unknown } }> | undefined)?.response
  if (response?.status !== 409 || response.data?.code !== 'draft-version-conflict') return null
  const version = response.data.data?.currentVersion
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : null
}

export interface SaveFailure {
  title: string
  /** Every reason the server gave, one line each. */
  messages: string[]
}

/** What a failed save says. The server names every reason a revision was refused (a rule a block breaks, a group not held), and they are all shown. */
export function describeSaveError(error: unknown): SaveFailure {
  const status = statusOf(error)
  const messages = messagesOf(error)
  if (status === 429) return { title: 'The server is busy', messages: ['Too many requests just now. Wait a moment and save again. Nothing you entered is lost.'] }
  if (status === 403) return { title: 'You cannot save this draft', messages: ['Only Admins and Coordinators can save agreement drafts.'] }
  if (status === 413) return { title: 'The plan is too large to save', messages: ['Save fewer blocks, or split the agreement.'] }
  if (status === 400 || status === 404) return { title: 'The draft was not saved', messages: messages.length > 0 ? [...new Set(messages.map(plain))] : ['The server refused the draft.'] }
  return { title: 'The draft was not saved', messages: ['The server could not price and save this draft. Check your connection and try again; nothing you entered is lost.'] }
}

/** The words of a renewal refused because no plan of the participant's covers its first day (409, code "plan-needed"), or null for any other failure (agreement PR 2). */
export function planNeededMessageOf(error: unknown): string | null {
  const response = (error as AxiosError<{ code?: string; errors?: unknown }> | undefined)?.response
  if (response?.status !== 409 || response.data?.code !== 'plan-needed') return null
  // The server names the day in ISO; the screen says it as it says every date (fix round 2).
  return messagesOf(error)[0]?.replace(/\d{4}-\d{2}-\d{2}/, iso => formatServiceDate(iso)) ?? null
}

/** What a refused renewal says. The two 409s (a newer revision, no plan for the first day) are read apart, by conflictVersionOf and planNeededMessageOf. */
export function describeRenewError(error: unknown): SaveFailure {
  const status = statusOf(error)
  const messages = messagesOf(error)
  if (status === 429) return { title: 'The server is busy', messages: ['Too many requests just now. Wait a moment and renew again.'] }
  if ((status === 400 || status === 403 || status === 404) && messages.length > 0) return { title: 'The agreement was not renewed', messages: [...new Set(messages.map(plain))] }
  return { title: 'The agreement was not renewed', messages: ['It could not be renewed just now. Check your connection and try again.'] }
}
