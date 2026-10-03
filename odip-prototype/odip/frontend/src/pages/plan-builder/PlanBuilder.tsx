import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { AgreementState, DraftBlock, PlanIssue, PlanPriceZone } from '@/api/types'
import { useFundingSources, usePlanBudget, usePlanPricingSettings } from '@/api/hooks'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { blockProblems, describeBlock, duplicateBlock, nextBlockId, normaliseBlock, stampLocation, type PlanStepKey } from '@/lib/planBlocks'
import { planBudgetFor, refusals } from '@/lib/planQuote'
import { templateByKey, type PlanTemplate } from '@/lib/planTemplates'
import { BudgetBar } from './BudgetBar'
import { PlanOverview } from './PlanOverview'
import { PlanStepper } from './PlanStepper'

/** One block being added or changed. It is a copy: the plan only changes when the session is saved. */
type Session = {
  mode: 'new' | 'edit'
  /** The block's place in the plan when it is being changed. */
  index: number | null
  entry: DraftBlock
  /** The JSON of the block as the session began, to tell a changed block from an untouched one. */
  began: string
  step: PlanStepKey
  templateKey: string | null
  /** A block exists (a template was chosen, or it is a copy of one): the rail then reaches every step. */
  hasBlock: boolean
  id: number
}

type PlanBuilderProps = {
  participantId: string
  state: AgreementState
  zone: PlanPriceZone
  /** The agreement period the plan is priced over. */
  from: string
  to: string
  entries: readonly DraftBlock[]
  onChange: (entries: DraftBlock[]) => void
  /** The plan cannot be changed (a person who only reads drafts, or a revision somebody has approved). */
  readOnly?: boolean
  readOnlyNote?: string
  /**
   * The save row, drawn under the list. Given as a function it is told what the pricing engine refused (a block it cannot price, a registration group the provider does not hold):
   * a plan with a refusal cannot be saved, and the row can say so before the server does.
   */
  footer?: ReactNode | ((state: { refused: readonly PlanIssue[] }) => ReactNode)
  /**
   * Told whether a block is being built that has been changed and is not in the plan yet (nothing of it is in `entries` until "Add to plan"): leaving the page now would lose it, so the
   * page counts it with its own unsaved changes.
   */
  onBuildingChange?: (changed: boolean) => void
}

/**
 * The plan builder: the overview of every block (the default view) or the stepper for one, and the running budget docked at the foot of both. It owns only what is in flight, the
 * block being added or changed; the plan itself is the page's, and changes by whole blocks. The figures are the pricing engine's, asked for when the person pauses, for the plan as it
 * would be saved (the block being changed stands in for its saved self, and a block that is not complete yet is left out and said to be).
 */
export function PlanBuilder({ participantId, state, zone, from, to, entries, onChange, readOnly = false, readOnlyNote, footer, onBuildingChange }: PlanBuilderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const building = session !== null && session.hasBlock && JSON.stringify(session.entry) !== session.began
  useEffect(() => { onBuildingChange?.(building) }, [building, onBuildingChange])
  const [nextSession, setNextSession] = useState(1)
  const [discarding, setDiscarding] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const canQuote = !readOnly
  const settings = usePlanPricingSettings(canQuote).data
  const funding = useFundingSources({ participantId })

  const blocksNow = useMemo(() => {
    const entriesNow = session?.mode === 'edit' && session.index !== null
      ? entries.map((entry, index) => (index === session.index ? session.entry : entry))
      : session?.mode === 'new' && session.hasBlock ? [...entries, session.entry] : [...entries]
    const complete = entriesNow.filter(entry => blockProblems(entry.block, { groupsHeld: undefined }).length === 0)
    return { quoted: complete.map(entry => stampLocation(entry.block, state, zone)), incomplete: entriesNow.length - complete.length }
  }, [entries, session, state, zone])
  const settled = useDebouncedValue(blocksNow.quoted)
  const settling = JSON.stringify(settled) !== JSON.stringify(blocksNow.quoted)
  const budget = usePlanBudget(settled, from, to, canQuote && settled.length > 0)
  // Nothing to price only when no block is complete; a block just added is "pricing" through the pause before the quote is asked for, never "add a block".
  const status = !canQuote || blocksNow.quoted.length === 0 ? 'idle' : budget.data ? 'ready' : budget.isError ? 'error' : 'loading'
  const planBudget = planBudgetFor(funding.data, from, to)
  const planIssues = budget.data?.period.issues ?? []

  const open = (next: Omit<Session, 'id' | 'began'>) => {
    setSession({ ...next, id: nextSession, began: JSON.stringify(next.entry) })
    setNextSession(current => current + 1)
  }
  const blank = (): DraftBlock => (templateByKey('blank') as PlanTemplate).build(nextBlockId(entries.map(entry => entry.block)), state, zone)
  const startWith = (template: PlanTemplate) => open({ mode: 'new', index: null, entry: template.build(nextBlockId(entries.map(entry => entry.block)), state, zone), step: 'times', templateKey: template.key, hasBlock: true })
  const add = () => open({ mode: 'new', index: null, entry: blank(), step: 'template', templateKey: null, hasBlock: false })
  const edit = (index: number, step: PlanStepKey) => open({ mode: 'edit', index, entry: JSON.parse(JSON.stringify(entries[index])) as DraftBlock, step, templateKey: null, hasBlock: true })
  const duplicate = (index: number) => {
    const copy = duplicateBlock(entries[index], nextBlockId(entries.map(entry => entry.block)))
    const next = [...entries]
    next.splice(index + 1, 0, copy)
    onChange(next)
    open({ mode: 'edit', index: index + 1, entry: JSON.parse(JSON.stringify(copy)) as DraftBlock, step: 'times', templateKey: null, hasBlock: true })
  }
  const removedAt = useRef<number | null>(null)
  const remove = (index: number) => {
    removedAt.current = index
    onChange(entries.filter((_, i) => i !== index))
  }

  const chooseTemplate = (template: PlanTemplate) => {
    if (!session) return
    setSession({ ...session, entry: template.build(session.entry.block.id, state, zone), templateKey: template.key, hasBlock: true })
  }
  const save = () => {
    if (!session) return
    const finished: DraftBlock = { ...session.entry, block: normaliseBlock(session.entry.block) }
    onChange(session.mode === 'edit' && session.index !== null ? entries.map((entry, index) => (index === session.index ? finished : entry)) : [...entries, finished])
    setSession(null)
  }
  const cancel = () => {
    if (session && session.hasBlock && JSON.stringify(session.entry) !== session.began) setDiscarding(true)
    else setSession(null)
  }

  const title = session ? (session.mode === 'new' ? 'Add a block' : `Edit block ${(session.index ?? 0) + 1}`) : 'Support plan'

  // The control that opened the stepper (a template card, an edit chip, Add block) or that closed it (Add to plan, Cancel) is gone with the view it was in, and focus would fall to the
  // top of the page: a keyboard user would have to Tab in again from there and a screen reader would say nothing. So when the view changes and focus has been lost, it goes to the
  // first step's heading, or, back in the overview, to "Support plan". A control that still has focus keeps it.
  const viewKey = session?.id ?? 0
  const seenView = useRef(viewKey)
  useEffect(() => {
    if (seenView.current === viewKey) return
    seenView.current = viewKey
    const root = sectionRef.current
    const active = document.activeElement
    if (active && active !== document.body && root?.contains(active)) return
    const target = root?.querySelector<HTMLElement>('form h2') ?? headingRef.current
    target?.focus({ preventScroll: true })
  }, [viewKey])

  // A removed block takes the button that opened the confirmation with it, so the dialog has nowhere to return focus to and it would fall to the top of the page. It goes to the
  // block that took the removed one's place (or the one before it, or the heading when none is left).
  useEffect(() => {
    const index = removedAt.current
    if (index === null) return
    removedAt.current = null
    const place = Math.min(index, entries.length - 1)
    const chip = place >= 0 ? sectionRef.current?.querySelector<HTMLElement>(`button[aria-label="Edit times of block ${place + 1}"]`) : null
    ;(chip ?? headingRef.current)?.focus()
  }, [entries])

  return (
    // scroll-mb: a control the keyboard moves focus to is scrolled clear of the budget bar (and, on a phone, the bottom nav) docked beneath it, never behind them.
    <section ref={sectionRef} aria-labelledby="plan-heading" className="flex flex-col gap-[var(--section-gap)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] [&_input]:scroll-mt-20 [&_input]:scroll-mb-40 [&_select]:scroll-mt-20 [&_select]:scroll-mb-40 [&_button]:scroll-mt-20 [&_button]:scroll-mb-40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="plan-heading" ref={headingRef} tabIndex={-1} className="font-semibold focus:outline-none">{title}</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {session ? (session.hasBlock ? describeBlock(session.entry.block) : 'Choose where the block starts. Nothing changes in the plan until you add it.')
              : readOnly ? (readOnlyNote ?? 'The plan this draft was priced from.') : 'Each block is one weekly routine. Prices come from the NDIS catalogue on the date of each shift, and the agreement is only ever what the blocks say.'}
          </p>
        </div>
        {!session && !readOnly && entries.length > 0 && <Button onClick={add}><Plus className="h-4 w-4" aria-hidden="true" />Add block</Button>}
      </div>

      {session ? (
        <PlanStepper
          key={session.id}
          mode={session.mode}
          entry={session.entry}
          templateKey={session.templateKey}
          hasBlock={session.hasBlock}
          step={session.step}
          onStepChange={step => setSession(current => (current ? { ...current, step } : current))}
          onChange={entry => setSession(current => (current ? { ...current, entry } : current))}
          onChooseTemplate={chooseTemplate}
          onCancel={cancel}
          onSave={save}
          settings={settings}
          others={entries.filter((_, index) => index !== session.index).map(entry => entry.block)}
          position={session.mode === 'edit' && session.index !== null ? session.index : entries.length}
          from={from}
          to={to}
          state={state}
          zone={zone}
          week={budget.data?.week ?? null}
          planIssues={planIssues}
        />
      ) : (
        <PlanOverview
          entries={entries}
          readOnly={readOnly}
          budget={budget.data}
          budgetStatus={status}
          issues={planIssues}
          state={state}
          zone={zone}
          onStart={startWith}
          onEdit={edit}
          onDuplicate={duplicate}
          onRemove={remove}
          footer={typeof footer === 'function' ? footer({ refused: refusals(planIssues) }) : footer}
        />
      )}

      {!readOnly && (entries.length > 0 || session !== null) && (
        <BudgetBar
          status={status}
          budget={budget.data}
          refreshing={settling || (budget.isFetching && !!budget.data)}
          error={budget.error}
          onRetry={() => { void budget.refetch() }}
          planBudget={planBudget}
          planBudgetUnreadable={funding.isError}
          incompleteBlocks={blocksNow.incomplete}
        />
      )}

      <ConfirmDialog
        open={discarding}
        onCancel={() => setDiscarding(false)}
        onConfirm={() => { setDiscarding(false); setSession(null) }}
        title="Discard this block?"
        message="The changes to this block have not been added to the plan."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
      />
    </section>
  )
}
