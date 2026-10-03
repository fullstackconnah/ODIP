import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { DraftBlock, PlanBlock, PlanHolidayDecision, PlanHolidayOccurrence, PlanIssue, PlanQuote } from '@/api/types'
import { usePlanBlockQuote } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { FormField } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { TONE } from '@/lib/tone'
import { PLAN_STEPS, formatHours, type BlockProblem, type PlanStepKey } from '@/lib/planBlocks'
import {
  KIND_LABEL, NO_FIGURE, asSentence, bandLabel, describeQuoteError, formatServiceDate, friendlyMessage, groupLines, periodProblem, periodPrompt, questionShort, quantityLabel, referenceWeek, ruleWords, totalsCaption, type LineGroup, type ReferenceWeek,
} from '@/lib/planQuote'
import { plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { FlagBadges, IssueList, PlanNotices } from './PlanMessages'
import { WeekStrip } from './WeekStrip'

const DECISIONS: { key: PlanHolidayDecision; label: string }[] = [
  { key: 'Review', label: 'Decide later' },
  { key: 'Charge', label: 'Charge the holiday rate' },
  { key: 'Skip', label: 'Skip the shift' },
]

const DECISION_WORDS: Record<PlanHolidayDecision, string> = {
  Review: 'Priced at the holiday rate and flagged, so a person decides before this agreement is approved.',
  Charge: 'The public holiday rate is charged, and the flag clears.',
  Skip: 'The whole shift is skipped, not only the part that falls on the holiday: nothing is priced for that day, even if it starts or ends on an ordinary one.',
}

type ReviewStepProps = {
  entry: DraftBlock
  /** The block as the engine takes it (its delivery location is the agreement's). */
  quoted: PlanBlock
  /** The plan's other blocks, drawn beside this one. */
  others: readonly PlanBlock[]
  /** This block's place in the plan, counted from 0 (the end when it is a block being added): a message names the blocks by their places, "Block 2", as the overview does. */
  position?: number
  from: string
  to: string
  /**
   * The ordinary week the plan's weekly figures are for (null when the plan's budget has not answered yet, or the agreement is shorter than a week). With none, the week is worked out
   * here from this block's own holidays, so a long agreement is never told it is shorter than a week while the budget is on its way.
   */
  week: ReferenceWeek | null
  /** What the whole plan's quote said about this block (an overlap needs the other blocks to be seen). */
  planIssues: readonly PlanIssue[]
  /** What is wrong with the block before it can be asked about. */
  problems: readonly BlockProblem[]
  onChange: (next: DraftBlock) => void
  onGoTo: (step: PlanStepKey) => void
}

function stepLabel(step: PlanStepKey): string {
  return PLAN_STEPS.find(candidate => candidate.key === step)?.label ?? step
}

const bandOf = (group: LineGroup) => (group.kind === 'Support' ? bandLabel(group.band) : KIND_LABEL[group.kind])

/**
 * The lines, one for each item, band and price, with what each is in an ordinary week beside what it is over the agreement. A line the engine could not price has no price, no weekly
 * figure and no agreement total: an en dash, never a $0.00 that reads as a price. Its shifts are still counted.
 */
function lineColumns(whyKey: string | null, onWhy: (key: string) => void): Column<LineGroup>[] {
  return [
    {
      key: 'itemCode', header: 'Code', minWidth: '9rem',
      render: group => group.itemCode ? <span className="font-mono text-[13px] tabular-nums">{group.itemCode}</span> : <span className="text-[var(--color-muted-foreground)]">No item</span>,
    },
    { key: 'band', header: 'Band', minWidth: '9rem', render: bandOf },
    { key: 'weeklyQty', header: 'Hours a week', align: 'right', render: group => group.weeklyQty === null || group.weeklyQty === 0 ? NO_FIGURE : quantityLabel(group.kind, group.unit, group.weeklyQty) },
    { key: 'unitPrice', header: 'Unit price', align: 'right', render: group => group.unpriced ? NO_FIGURE : formatCurrency(group.unitPrice) },
    { key: 'weeklyTotal', header: 'A week', align: 'right', render: group => group.unpriced || group.weeklyTotal === null || group.weeklyTotal === 0 ? NO_FIGURE : formatCurrency(group.weeklyTotal) },
    {
      key: 'periodTotal', header: 'The agreement', align: 'right', wrap: true,
      render: group => <span className="flex flex-col items-end leading-tight"><span className="tabular-nums">{group.unpriced ? NO_FIGURE : formatCurrency(group.periodTotal)}</span><span className="text-xs text-[var(--color-muted-foreground)]">{plural(group.occurrences, 'shift')}</span></span>,
    },
    { key: 'flags', header: 'Flags', wrap: true, render: group => <FlagBadges flags={group.sample.flags} unpriced={group.unpriced !== undefined} /> },
    {
      key: 'actions', header: '',
      render: group => (
        <Button
          variant={whyKey === group.key ? 'primary' : 'secondary'} size="sm" aria-expanded={whyKey === group.key} aria-controls="plan-why-panel" aria-label={`Why ${group.itemCode ?? 'this line'}, ${bandOf(group)}`}
          onClick={() => onWhy(group.key)}
        >Why</Button>
      ),
    },
  ]
}

/** The reasoning behind one line: the sentence the engine wrote, each rule it applied in plain words, and the catalogue row the price came from. */
function WhyContent({ group, onClose }: { group: LineGroup; onClose: () => void }) {
  const trace = group.sample.trace
  const basis = [trace.catalogueVersion ? `catalogue ${trace.catalogueVersion}` : null, trace.priceBasisFrom ? `the price row from ${formatServiceDate(trace.priceBasisFrom)}` : null].filter(Boolean).join(', ')
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <p><span className="font-medium">{group.itemCode ?? 'No item'}</span>, {bandOf(group)}: {friendlyMessage(trace.why, [])}</p>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onClose}>Close</Button>
      </div>
      <ul className="list-disc pl-5 text-[13px]">
        {trace.rules.map(rule => <li key={rule}>{ruleWords(rule)}</li>)}
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        {basis && (<><dt className="text-[var(--color-muted-foreground)]">Price basis</dt><dd>{basis}</dd></>)}
        {trace.maximumUnitPrice !== undefined && (<><dt className="text-[var(--color-muted-foreground)]">NDIS maximum</dt><dd className="tabular-nums">{formatCurrency(trace.maximumUnitPrice)} before the group arithmetic ({trace.workers}:{trace.participantsPresent})</dd></>)}
        {trace.policy && (<><dt className="text-[var(--color-muted-foreground)]">Crossing policy</dt><dd>{trace.policy === 'B' ? 'B: the higher of the parts' : 'A: each part at its own item'}</dd></>)}
        {trace.holidayName && (<><dt className="text-[var(--color-muted-foreground)]">Public holiday</dt><dd>{trace.holidayName}</dd></>)}
        <dt className="text-[var(--color-muted-foreground)]">Example shift</dt><dd>{formatServiceDate(group.sample.serviceDate)}</dd>
      </dl>
      {group.openQuestions.length > 0 && (
        <p className="text-[13px] text-[var(--color-muted-foreground)]">Rests on {group.openQuestions.map(questionShort).join('; ')}.</p>
      )}
    </>
  )
}

type HolidayRow = PlanHolidayOccurrence & { key: string }

function holidayColumns(): Column<HolidayRow>[] {
  return [
    { key: 'date', header: 'Date', render: occurrence => formatServiceDate(occurrence.date) },
    { key: 'holidayName', header: 'Public holiday', wrap: true, render: occurrence => `${occurrence.holidayName}${occurrence.state ? ` (${occurrence.state})` : ''}` },
    { key: 'atHolidayRates', header: 'At holiday rates', align: 'right', render: occurrence => occurrence.atHolidayRates === undefined ? NO_FIGURE : formatCurrency(occurrence.atHolidayRates) },
    { key: 'atOrdinaryRates', header: 'Ordinary day', align: 'right', render: occurrence => occurrence.atOrdinaryRates === undefined ? NO_FIGURE : formatCurrency(occurrence.atOrdinaryRates) },
    { key: 'uplift', header: 'Difference', align: 'right', render: occurrence => occurrence.uplift === undefined ? NO_FIGURE : `+${formatCurrency(occurrence.uplift)}` },
    { key: 'decision', header: 'What happens', wrap: true, render: occurrence => occurrence.skipped ? 'Skipped' : occurrence.decision === 'Charge' ? 'Charged' : 'Needs a decision' },
  ]
}

/**
 * The hours of the block in the ordinary week, priced and not priced apart: the engine's hours (and the budget bar's) are the priced lines' only, so counting a line with no price here
 * would make the same block read 15 h in one place and 10 h in the other, beside a dollar figure that pays for 10. null when there is no week to count in.
 */
function weeklyHoursOf(groups: readonly LineGroup[]): { priced: number; unpriced: number } | null {
  if (groups.some(group => group.weeklyQty === null)) return null
  const hours = groups.filter(group => (group.kind === 'Support' || group.kind === 'SleepoverActiveHours') && group.unit === 'H')
  const sum = (of: readonly LineGroup[]) => of.reduce((total, group) => total + (group.weeklyQty ?? 0), 0)
  return { priced: sum(hours.filter(group => group.unpriced === undefined)), unpriced: sum(hours.filter(group => group.unpriced !== undefined)) }
}

/**
 * Review: the focal moment of the stepper. In the order a coordinator needs it: the block drawn on the week beside the others, what has to be looked at (when anything has), the lines it
 * produces (code, band, hours a week, unit price, what it costs in a week and over the agreement) with the block's total directly under them, the public holidays it meets with the choice
 * of what to do about them, and the questions it waits on. Every number is the pricing engine's; a line's "Why" opens the rules and the catalogue row behind it. Nothing here blocks anything:
 * Review issues are for the approval to stop.
 */
export function ReviewStep({ entry, quoted, others, position, from, to, week, planIssues, problems, onChange, onGoTo }: ReviewStepProps) {
  // The dates, as days: typed, real, and the end not before the start. Compared as text a year of five digits was a period, and Review showed neither the prompt nor a spinner nor an error (review N1).
  const dates = periodProblem(from, to)
  const quoteable = problems.length === 0 && dates === null
  const quote = usePlanBlockQuote(quoteable ? quoted : null, from, to, quoteable)
  const [whyKey, setWhyKey] = useState<string | null>(null)
  const panel = useRef<HTMLElement>(null)
  // The query keeps the previous answer while a new one is asked for, and keeps it when none will be (the dates or the block can no longer be asked about): that is not an answer to what is on screen.
  const data: PlanQuote | undefined = quoteable ? quote.data : undefined

  const ordinaryWeek = useMemo(
    () => week ?? (data ? referenceWeek(from, to, data.holidayOccurrences.map(occurrence => occurrence.date)) : null),
    [week, data, from, to],
  )
  const groups = useMemo(() => (data ? groupLines(data.lines, ordinaryWeek) : []), [data, ordinaryWeek])
  const allBlocks = useMemo(() => {
    const at = Math.min(Math.max(position ?? others.length, 0), others.length)
    return [...others.slice(0, at), quoted, ...others.slice(at)]
  }, [others, quoted, position])
  const issues = useMemo(() => {
    const own = data?.issues ?? []
    const extra = planIssues.filter(issue => issue.blockId === quoted.id && !own.some(known => known.reason === issue.reason && known.message === issue.message))
    return [...own, ...extra]
  }, [data, planIssues, quoted.id])
  const holidays = data?.holidayOccurrences.filter(occurrence => occurrence.blockId === quoted.id) ?? []
  const why = groups.find(group => group.key === whyKey) ?? null
  const nothingPriced = groups.length > 0 && groups.every(group => group.unpriced !== undefined)
  const weeklyTotal = ordinaryWeek && groups.length > 0 ? groups.reduce((sum, group) => sum + (group.weeklyTotal ?? 0), 0) : null
  const weeklyHours = weeklyHoursOf(groups)
  const uplift = holidays.reduce((sum, occurrence) => sum + (occurrence.uplift ?? 0), 0)
  const failure = quote.isError ? describeQuoteError(quote.error) : null
  const caption = data ? totalsCaption(data) : null
  // The lines on screen are the previous block's while a newer answer is on its way (after "Skip the shift", say): everything the answer holds is dimmed (the lines, the block's total and the week, what
  // to look at, the holidays) and said to be updating, and a screen reader is told once, politely, because it follows a choice the person made and not typing.
  const updating = quoteable && quote.isPlaceholderData === true

  // The reasoning opens under the table, which on a phone is below the last card: so opening it moves the view and focus there, and it has a Close that goes back to the line it was opened for.
  useEffect(() => { if (whyKey !== null) panel.current?.focus() }, [whyKey])
  const toggleWhy = (key: string) => setWhyKey(current => (current === key ? null : key))
  const closeWhy = () => {
    // The Why that is open is the line it was opened for: focus goes back to it.
    const trigger = document.querySelector<HTMLElement>('button[aria-controls="plan-why-panel"][aria-expanded="true"]')
    setWhyKey(null)
    trigger?.focus()
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <WeekStrip blocks={allBlocks} highlightId={quoted.id} />

      {problems.length === 0 && dates !== null && (
        <Callout tone="info" className="max-w-prose" title={periodPrompt(dates, 'this block')}>
          {dates === 'reversed'
            ? 'Prices come from the catalogue on the date of each shift, so the end date has to be on or after the start date (in Draft details, above the plan).'
            : 'Prices come from the catalogue on the date of each shift, so the agreement needs a start and an end date, each a real day with a four digit year (in Draft details, above the plan).'}
        </Callout>
      )}

      {problems.length > 0 && (
        <Callout tone="warning" className="max-w-prose" title="This block cannot be priced yet">
          <ul className="mt-1 flex flex-col gap-1">
            {problems.map(problem => (
              <li key={`${problem.step}-${problem.field}`} className="flex flex-wrap items-center gap-2">
                <span>{problem.message}</span>
                <Button variant="secondary" size="sm" onClick={() => onGoTo(problem.step)}>Go to {stepLabel(problem.step)}</Button>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {quoteable && quote.isLoading && (
        <p role="status" aria-busy="true" className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Pricing this block…</p>
      )}

      {quoteable && quote.isError && !data && failure && (
        <Callout tone="error" className="max-w-prose" title={failure.title}>
          {failure.detail}
          {failure.retryable && <span className="mt-2 block"><Button variant="secondary" size="sm" onClick={() => { void quote.refetch() }}>Try again</Button></span>}
        </Callout>
      )}

      {/* In the page from the start, so that what is put into it is announced: a status that is inserted already holding its text is not reliably spoken (review N9). */}
      <p role="status" className="sr-only">{updating ? 'Updating prices' : ''}</p>

      {data && (
        <div className={`flex flex-col gap-[var(--section-gap)] transition-opacity${updating ? ' opacity-60' : ''}`} aria-busy={updating}>
          {issues.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="plan-issues-heading">
              <h4 id="plan-issues-heading" className="text-sm font-semibold">To look at</h4>
              <IssueList issues={issues} blocks={allBlocks} onFix={(_, step) => onGoTo(step)} />
            </section>
          )}

          <section className="flex flex-col gap-2" aria-labelledby="plan-lines-heading" aria-busy={updating}>
            <h4 id="plan-lines-heading" className="text-sm font-semibold">Lines this block produces{updating && <span aria-hidden="true" className="font-normal text-[var(--color-muted-foreground)]"> · updating…</span>}</h4>
            {groups.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">Nothing is priced from this block, so it adds no lines to the agreement.</p>
            ) : (
              <DataTable data={groups} keyField="key" columns={lineColumns(whyKey, toggleWhy)} emptyMessage="No lines." />
            )}
            {groups.length > 0 && (
              <div className="flex flex-col gap-0.5 text-sm tabular-nums">
                <p>
                  <span className="text-base font-bold">{nothingPriced ? NO_FIGURE : formatCurrency(data.totals.amount)}</span>{' '}
                  <span className="font-medium">over the agreement</span>, {plural(data.totals.byBlock.find(total => total.blockId === quoted.id)?.occurrences ?? 0, 'shift')}.
                </p>
                <p>
                  {ordinaryWeek && weeklyTotal !== null && weeklyHours !== null
                    ? nothingPriced
                      ? <span className={TONE.warning.ink}>{formatHours(weeklyHours.unpriced)} h in an ordinary week are not priced.</span>
                      : <><span className="font-medium">{formatHours(weeklyHours.priced)} h and {formatCurrency(weeklyTotal)} in an ordinary week</span>{weeklyHours.unpriced > 0 && <span className={TONE.warning.ink}> · {formatHours(weeklyHours.unpriced)} h not priced</span>}{'.'}</>
                    : <span className="text-[var(--color-muted-foreground)]">The agreement is shorter than a week, so there is no weekly figure.</span>}
                </p>
                {caption?.text && <p className={`text-[13px] ${caption.notFullyPriced ? TONE.warning.ink : 'text-[var(--color-muted-foreground)]'}`}>{asSentence(caption.text)}.</p>}
              </div>
            )}
            {/* Always in the page, hidden until a line's Why opens it, so that aria-controls on every Why resolves. */}
            <section id="plan-why-panel" ref={panel} tabIndex={-1} hidden={why === null} aria-label="Why this price" className="flex scroll-mt-20 scroll-mb-40 flex-col gap-2 border-t border-[var(--color-border)] pt-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
              {why && <WhyContent group={why} onClose={closeWhy} />}
            </section>
          </section>

          {holidays.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="plan-holidays-heading">
              <h4 id="plan-holidays-heading" className="text-sm font-semibold">Public holidays</h4>
              <p className="text-sm">
                {plural(holidays.length, 'shift')} {holidays.length === 1 ? 'falls' : 'fall'} on a public holiday{uplift > 0 ? `, adding ${formatCurrency(uplift)} over ordinary days` : ''}.
              </p>
              <FormField label="When a shift falls on a public holiday">
                <ToggleGroup className="flex-wrap" ariaLabel="When a shift falls on a public holiday" options={DECISIONS} value={entry.block.onPublicHoliday} onChange={value => onChange({ ...entry, block: { ...entry.block, onPublicHoliday: value as PlanHolidayDecision } })} />
              </FormField>
              <p className="max-w-prose text-[13px] text-[var(--color-muted-foreground)]" aria-live="polite">{DECISION_WORDS[entry.block.onPublicHoliday]}</p>
              <p className="max-w-prose text-[13px] text-[var(--color-muted-foreground)]">
                This is one choice for every shift of the block that falls on a public holiday. A single shift cannot be moved to another day: changing the block&apos;s days under {stepLabel('times')} moves that day in every week.
              </p>
              {/* The dates are the detail, and nine of them are as long as the rest of the step: shut unless there are one or two. */}
              <details open={holidays.length <= 2} className="text-sm">
                <summary className="cursor-pointer select-none font-medium">Dates and what each adds ({holidays.length})</summary>
                <div className="mt-2">
                  <DataTable data={holidays.map(occurrence => ({ ...occurrence, key: `${occurrence.blockId}-${occurrence.date}` }))} keyField="key" columns={holidayColumns()} emptyMessage="No holidays." />
                </div>
              </details>
            </section>
          )}

          <PlanNotices notices={data.notices} scope="review" />

          {data.openQuestions.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer select-none font-medium">Questions this block waits on ({data.openQuestions.length})</summary>
              <ul className="mt-2 flex flex-col gap-2 text-[13px] text-[var(--color-muted-foreground)]">
                {data.openQuestions.map(question => <li key={question.number}><span className="font-medium text-[var(--color-foreground)]">Question {question.number}.</span> {question.text}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
