import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { DraftBlock, PlanBlock, PlanHolidayDecision, PlanHolidayOccurrence, PlanIssue, PlanQuote } from '@/api/types'
import { usePlanBlockQuote } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { FormField } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { PLAN_STEPS, formatHours, type BlockProblem, type PlanStepKey } from '@/lib/planBlocks'
import {
  KIND_LABEL, bandLabel, describeQuoteError, formatServiceDate, groupLines, questionShort, quantityLabel, ruleWords, type LineGroup, type ReferenceWeek,
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
  /** The ordinary week the plan's weekly figures are for (null for an agreement shorter than a week). */
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

/** The lines, one for each item, band and price, with what each is in an ordinary week beside what it is over the agreement. */
function lineColumns(whyKey: string | null, onWhy: (key: string) => void): Column<LineGroup>[] {
  return [
    {
      key: 'itemCode', header: 'Code', minWidth: '9rem',
      render: group => group.itemCode ? <span className="font-mono text-[13px] tabular-nums">{group.itemCode}</span> : <span className="text-[var(--color-muted-foreground)]">No item</span>,
    },
    { key: 'band', header: 'Band', minWidth: '9rem', render: group => group.kind === 'Support' ? bandLabel(group.band) : KIND_LABEL[group.kind] },
    { key: 'weeklyQty', header: 'Hours a week', align: 'right', render: group => group.weeklyQty === null || group.weeklyQty === 0 ? '—' : quantityLabel(group.kind, group.unit, group.weeklyQty) },
    { key: 'unitPrice', header: 'Unit price', align: 'right', render: group => group.unpriced ? '—' : formatCurrency(group.unitPrice) },
    { key: 'weeklyTotal', header: 'A week', align: 'right', render: group => group.weeklyTotal === null || group.weeklyTotal === 0 ? '—' : formatCurrency(group.weeklyTotal) },
    {
      key: 'periodTotal', header: 'The agreement', align: 'right', wrap: true,
      render: group => <span className="flex flex-col items-end leading-tight"><span className="tabular-nums">{formatCurrency(group.periodTotal)}</span><span className="text-xs text-[var(--color-muted-foreground)]">{plural(group.occurrences, 'shift')}</span></span>,
    },
    { key: 'flags', header: 'Flags', wrap: true, render: group => <FlagBadges flags={group.sample.flags} unpriced={group.unpriced !== undefined} /> },
    {
      key: 'actions', header: '',
      render: group => (
        <Button variant="secondary" size="sm" aria-expanded={whyKey === group.key} aria-controls="plan-why-panel" aria-label={`Why ${group.itemCode ?? 'this line'}, ${group.kind === 'Support' ? bandLabel(group.band) : KIND_LABEL[group.kind]}`} onClick={() => onWhy(group.key)}>Why</Button>
      ),
    },
  ]
}

/** The reasoning behind one line: the sentence the engine wrote, each rule it applied in plain words, and the catalogue row the price came from. */
function WhyPanel({ group }: { group: LineGroup }) {
  const trace = group.sample.trace
  const basis = [trace.catalogueVersion ? `catalogue ${trace.catalogueVersion}` : null, trace.priceBasisFrom ? `the price row from ${formatServiceDate(trace.priceBasisFrom)}` : null].filter(Boolean).join(', ')
  return (
    <section id="plan-why-panel" aria-label="Why this price" className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3 text-sm">
      <p><span className="font-medium">{group.itemCode ?? 'No item'}</span>, {group.kind === 'Support' ? bandLabel(group.band) : KIND_LABEL[group.kind]}: {trace.why}</p>
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
    </section>
  )
}

type HolidayRow = PlanHolidayOccurrence & { key: string }

function holidayColumns(): Column<HolidayRow>[] {
  return [
    { key: 'date', header: 'Date', render: occurrence => formatServiceDate(occurrence.date) },
    { key: 'holidayName', header: 'Public holiday', wrap: true, render: occurrence => `${occurrence.holidayName}${occurrence.state ? ` (${occurrence.state})` : ''}` },
    { key: 'atHolidayRates', header: 'At holiday rates', align: 'right', render: occurrence => occurrence.atHolidayRates === undefined ? '—' : formatCurrency(occurrence.atHolidayRates) },
    { key: 'atOrdinaryRates', header: 'Ordinary day', align: 'right', render: occurrence => occurrence.atOrdinaryRates === undefined ? '—' : formatCurrency(occurrence.atOrdinaryRates) },
    { key: 'uplift', header: 'Difference', align: 'right', render: occurrence => occurrence.uplift === undefined ? '—' : `+${formatCurrency(occurrence.uplift)}` },
    { key: 'decision', header: 'What happens', wrap: true, render: occurrence => occurrence.skipped ? 'Skipped' : occurrence.decision === 'Charge' ? 'Charged' : 'Needs a decision' },
  ]
}

/** Weekly hours of the block: the support and active hours in the ordinary week. */
function weeklyHoursOf(groups: readonly LineGroup[]): number | null {
  if (groups.some(group => group.weeklyQty === null)) return null
  return groups.filter(group => group.kind === 'Support' || group.kind === 'SleepoverActiveHours').reduce((sum, group) => sum + (group.weeklyQty ?? 0), 0)
}

/**
 * Review: the focal moment of the stepper. The block is drawn on the week beside the others, above the lines it produces (code, band, hours a week, unit price, what it costs
 * in a week and over the agreement), the public holidays it meets with the choice of what to do about them, and anything a person has to look at, each beside what to do.
 * Every number is the pricing engine's; a line's "Why" opens the rules and the catalogue row behind it. Nothing here blocks anything: Review issues are for the approval to stop.
 */
export function ReviewStep({ entry, quoted, others, position, from, to, week, planIssues, problems, onChange, onGoTo }: ReviewStepProps) {
  const hasPeriod = !!from && !!to && from <= to
  const quoteable = problems.length === 0 && hasPeriod
  const quote = usePlanBlockQuote(quoteable ? quoted : null, from, to, quoteable)
  const [whyKey, setWhyKey] = useState<string | null>(null)
  const data: PlanQuote | undefined = quote.data

  const groups = useMemo(() => (data ? groupLines(data.lines, week) : []), [data, week])
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
  const weeklyTotal = week && groups.length > 0 ? groups.reduce((sum, group) => sum + (group.weeklyTotal ?? 0), 0) : null
  const weeklyHours = weeklyHoursOf(groups)
  const uplift = holidays.reduce((sum, occurrence) => sum + (occurrence.uplift ?? 0), 0)
  const failure = quote.isError ? describeQuoteError(quote.error) : null

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <WeekStrip blocks={allBlocks} highlightId={quoted.id} />

      {problems.length === 0 && !hasPeriod && (
        <Callout tone="info" title="Enter the agreement dates to price this block">
          Prices come from the catalogue on the date of each shift, so the agreement needs a start and an end date (in Draft details, above the plan).
        </Callout>
      )}

      {problems.length > 0 && (
        <Callout tone="warning" title="This block cannot be priced yet">
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
        <Callout tone="error" title={failure.title} actions={failure.retryable ? <Button variant="secondary" size="sm" onClick={() => { void quote.refetch() }}>Try again</Button> : undefined}>
          {failure.detail}
        </Callout>
      )}

      {data && (
        <>
          <PlanNotices notices={data.notices} />

          <section className="flex flex-col gap-2" aria-labelledby="plan-lines-heading">
            <h3 id="plan-lines-heading" className="text-sm font-semibold">Lines this block produces</h3>
            {groups.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">Nothing is priced from this block, so it adds no lines to the agreement.</p>
            ) : (
              <DataTable data={groups} keyField="key" columns={lineColumns(whyKey, key => setWhyKey(current => (current === key ? null : key)))} emptyMessage="No lines." />
            )}
            {groups.length > 0 && (
              <p className="text-sm tabular-nums">
                {week && weeklyTotal !== null && weeklyHours !== null ? <><span className="font-medium">{formatHours(weeklyHours)} h and {formatCurrency(weeklyTotal)} in an ordinary week</span>{'. '}</> : <span className="text-[var(--color-muted-foreground)]">The agreement is shorter than a week, so there is no weekly figure. </span>}
                <span className="font-medium">{formatCurrency(data.totals.amount)}</span> over the agreement, {plural(data.totals.byBlock.find(total => total.blockId === quoted.id)?.occurrences ?? 0, 'shift')}.
              </p>
            )}
            {why && <WhyPanel group={why} />}
          </section>

          {holidays.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="plan-holidays-heading">
              <h3 id="plan-holidays-heading" className="text-sm font-semibold">Public holidays</h3>
              <p className="text-sm">
                {plural(holidays.length, 'shift')} {holidays.length === 1 ? 'falls' : 'fall'} on a public holiday{uplift > 0 ? `, adding ${formatCurrency(uplift)} over ordinary days` : ''}.
              </p>
              <DataTable data={holidays.map(occurrence => ({ ...occurrence, key: `${occurrence.blockId}-${occurrence.date}` }))} keyField="key" columns={holidayColumns()} emptyMessage="No holidays." />
              <FormField label="When a shift falls on a public holiday">
                <ToggleGroup className="flex-wrap" ariaLabel="When a shift falls on a public holiday" options={DECISIONS} value={entry.block.onPublicHoliday} onChange={value => onChange({ ...entry, block: { ...entry.block, onPublicHoliday: value as PlanHolidayDecision } })} />
              </FormField>
              <p className="text-[13px] text-[var(--color-muted-foreground)]" aria-live="polite">{DECISION_WORDS[entry.block.onPublicHoliday]}</p>
            </section>
          )}

          {issues.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="plan-issues-heading">
              <h3 id="plan-issues-heading" className="text-sm font-semibold">To look at</h3>
              <IssueList issues={issues} blocks={allBlocks} onFix={(_, step) => onGoTo(step)} />
            </section>
          )}

          {data.openQuestions.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer select-none font-medium">Questions this block waits on ({data.openQuestions.length})</summary>
              <ul className="mt-2 flex flex-col gap-2 text-[13px] text-[var(--color-muted-foreground)]">
                {data.openQuestions.map(question => <li key={question.number}><span className="font-medium text-[var(--color-foreground)]">Question {question.number}.</span> {question.text}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}
