import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { AgreementState, DraftBlock, PlanIssue, PlanPriceZone } from '@/api/types'
import { useFundingSources, usePlanBudget, usePlanPricingSettings, type PlanBudget } from '@/api/hooks'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { blockProblems, describeBlock, duplicateBlock, nextBlockId, normaliseBlock, stampLocation, type PlanStepKey } from '@/lib/planBlocks'
import { periodProblem, periodPrompt, planBudgetFor, refusalSentence, refusals } from '@/lib/planQuote'
import { templateByKey, type PlanTemplate } from '@/lib/planTemplates'
import { BudgetBar } from './BudgetBar'
import { PlanOverview } from './PlanOverview'
import { PlanStepper } from './PlanStepper'

/** The plan with a block put at `index` (the end when there is none). */
function withBlockAt(entries: readonly DraftBlock[], index: number | null, entry: DraftBlock): DraftBlock[] {
  const at = index === null ? entries.length : Math.min(Math.max(index, 0), entries.length)
  return [...entries.slice(0, at), entry, ...entries.slice(at)]
}

/** One block being added or changed. It is a copy: the plan only changes when the session is saved. */
type Session = {
  mode: 'new' | 'edit'
  /** The block's place in the plan when it is being changed; for a block being added, the place it will take (null: the end). */
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
   * The answer a saved revision was priced with (its totals, issues and notices: no lines, so no ordinary week), shown instead of a live quote while the plan is read only. A revision somebody has
   * approved is read from here, so its figures are the ones that were approved and the server is asked nothing.
   */
  stored?: PlanBudget
  /** Drawn beside the heading while the plan is read only: what the page offers instead of editing (Start a new revision). */
  readOnlyAction?: ReactNode
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
  /**
   * Told whether a block is open in the stepper at all, changed or not: the page says so when a person is about to give up the plan on screen for another version (the open block is a copy from the plan
   * that is being replaced, and is closed with it).
   */
  onOpenChange?: (open: boolean) => void
  /**
   * The plan has changes nobody has saved, and how to save them: the budget bar says so on a phone, where the save row is a long scroll below the blocks. Not given when there is nothing to
   * save or nobody to save it.
   */
  unsaved?: { onSave: () => void; saving: boolean; holding?: boolean }
  /**
   * What the last save said when it did not go through (the problems found, the server's refusal, a newer version somebody else made), and what it said when it did ("Saved as version 3."). They
   * are drawn with the budget bar, which is docked in the overview and through every step of a block: the bar's Save can be pressed from the stepper, where the save row is not, and the answer has to be where
   * the person is looking.
   */
  saveNotice?: ReactNode
  savedNote?: string | null
}

/**
 * The plan builder: the overview of every block (the default view) or the stepper for one, and the running budget docked at the foot of both. It owns only what is in flight, the
 * block being added or changed; the plan itself is the page's, and changes by whole blocks. The figures are the pricing engine's, asked for when the person pauses, for the plan as it
 * would be saved (the block being changed stands in for its saved self, and a block that is not complete yet is left out and said to be).
 */
export function PlanBuilder({ participantId, state, zone, from, to, entries, onChange, readOnly = false, readOnlyNote, stored, readOnlyAction, footer, onBuildingChange, onOpenChange, unsaved, saveNotice, savedNote }: PlanBuilderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const building = session !== null && session.hasBlock && JSON.stringify(session.entry) !== session.began
  useEffect(() => { onBuildingChange?.(building) }, [building, onBuildingChange])
  const sessionOpen = session !== null
  useEffect(() => { onOpenChange?.(sessionOpen) }, [sessionOpen, onOpenChange])
  const [nextSession, setNextSession] = useState(1)
  const [discarding, setDiscarding] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // How tall the docked bar is now, with the notice above it: a control the keyboard moves focus to is scrolled clear of it by that much, whatever the bar is showing (review M1).
  const [dockHeight, setDockHeight] = useState(0)
  const canQuote = !readOnly
  const settings = usePlanPricingSettings(canQuote).data
  const funding = useFundingSources({ participantId })

  const blocksNow = useMemo(() => {
    const entriesNow = session?.mode === 'edit' && session.index !== null
      ? entries.map((entry, index) => (index === session.index ? session.entry : entry))
      : session?.mode === 'new' && session.hasBlock ? withBlockAt(entries, session.index, session.entry) : [...entries]
    const complete = entriesNow.filter(entry => blockProblems(entry.block, { groupsHeld: undefined }).length === 0)
    return { quoted: complete.map(entry => stampLocation(entry.block, state, zone)), incomplete: entriesNow.length - complete.length, named: entriesNow.map(entry => entry.block) }
  }, [entries, session, state, zone])
  const settled = useDebouncedValue(blocksNow.quoted)
  const settling = JSON.stringify(settled) !== JSON.stringify(blocksNow.quoted)
  const budget = usePlanBudget(settled, from, to, canQuote && settled.length > 0)
  // Dates that cannot be priced over (not typed, no day, an end before the start) are asked of nobody: the query is off for them, and with it off nothing is "pricing" and nothing on the screen may be the
  // answer for the dates there were before (the query keeps the previous answer while a new one is on its way, and keeps it when none will come). The bar says what is missing instead (review N1).
  const dates = periodProblem(from, to)
  const live = dates === null && blocksNow.quoted.length > 0 ? budget.data : undefined
  // A read-only plan that is given the answer it was saved with shows that and asks for nothing; otherwise the answer is the live quote.
  const answer = readOnly && stored ? stored : live
  // Nothing to price only when no block is complete or the dates are not there; a block just added is "pricing" through the pause before the quote is asked for, never "add a block".
  const status = readOnly && stored ? 'ready' : !canQuote || blocksNow.quoted.length === 0 || dates !== null ? 'idle' : answer ? 'ready' : budget.isError ? 'error' : 'loading'
  const planBudget = planBudgetFor(funding.data, from, to)
  const planIssues = answer?.period.issues ?? []
  const refused = refusals(planIssues)

  const open = (next: Omit<Session, 'id' | 'began'>) => {
    setSession({ ...next, id: nextSession, began: JSON.stringify(next.entry) })
    setNextSession(current => current + 1)
  }
  const blank = (): DraftBlock => (templateByKey('blank') as PlanTemplate).build(nextBlockId(entries.map(entry => entry.block)), state, zone)
  const startWith = (template: PlanTemplate) => open({ mode: 'new', index: null, entry: template.build(nextBlockId(entries.map(entry => entry.block)), state, zone), step: 'times', templateKey: template.key, hasBlock: true })
  const add = () => open({ mode: 'new', index: null, entry: blank(), step: 'template', templateKey: null, hasBlock: false })
  const edit = (index: number, step: PlanStepKey) => open({ mode: 'edit', index, entry: JSON.parse(JSON.stringify(entries[index])) as DraftBlock, step, templateKey: null, hasBlock: true })
  // A copy is a block being added, to take the place after the one it copies. It joins the plan on "Add to plan", like any block: duplicating and then cancelling used to leave an identical,
  // overlapping block in the plan.
  const duplicate = (index: number) => {
    const copy = duplicateBlock(entries[index], nextBlockId(entries.map(entry => entry.block)))
    open({ mode: 'new', index: index + 1, entry: JSON.parse(JSON.stringify(copy)) as DraftBlock, step: 'times', templateKey: null, hasBlock: true })
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
    onChange(session.mode === 'edit' && session.index !== null ? entries.map((entry, index) => (index === session.index ? finished : entry)) : withBlockAt(entries, session.index, finished))
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
    const target = root?.querySelector<HTMLElement>('form h3') ?? headingRef.current
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
    // scroll-mb: a control the keyboard moves focus to is scrolled clear of the budget bar docked beneath it and, below lg, the bottom nav under that, never behind them (WCAG 2.4.11). The bar is as
    // tall as it is (a line, chips, a notice of up to 40vh, Details open), so the margin is its measured height (`--plan-dock-h`, set from the bar's own ResizeObserver) plus the nav and some air.
    <section
      ref={sectionRef}
      aria-labelledby="plan-heading"
      style={{ '--plan-dock-h': `${dockHeight}px` } as CSSProperties}
      className="flex flex-col gap-[var(--section-gap)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] [--plan-clear:calc(var(--plan-dock-h)_+_1.5rem)] max-lg:[--plan-clear:calc(var(--plan-dock-h)_+_var(--mobile-nav-h)_+_1.5rem)] [&_input]:scroll-mt-20 [&_input]:scroll-mb-(--plan-clear) [&_select]:scroll-mt-20 [&_select]:scroll-mb-(--plan-clear) [&_button]:scroll-mt-20 [&_button]:scroll-mb-(--plan-clear)"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="plan-heading" ref={headingRef} tabIndex={-1} className="font-semibold focus:outline-none">{title}</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {session ? (session.hasBlock ? describeBlock(session.entry.block) : 'Choose where the block starts. Nothing changes in the plan until you add it.')
              : readOnly ? (readOnlyNote ?? 'The plan this draft was priced from.') : 'Each block is one weekly routine, priced from the NDIS catalogue on the date of each shift.'}
          </p>
        </div>
        {!session && !readOnly && entries.length > 0 && <Button onClick={add}><Plus className="h-4 w-4" aria-hidden="true" />Add block</Button>}
        {!session && readOnly && readOnlyAction}
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
          others={(session.mode === 'edit' ? entries.filter((_, index) => index !== session.index) : entries).map(entry => entry.block)}
          position={session.index ?? entries.length}
          from={from}
          to={to}
          state={state}
          zone={zone}
          week={answer?.week ?? null}
          planIssues={planIssues}
        />
      ) : (
        <PlanOverview
          entries={entries}
          readOnly={readOnly}
          budget={answer}
          budgetStatus={status}
          issues={planIssues}
          state={state}
          zone={zone}
          onStart={startWith}
          onEdit={edit}
          onDuplicate={duplicate}
          onRemove={remove}
          footer={typeof footer === 'function' ? footer({ refused }) : footer}
        />
      )}

      {!readOnly && (entries.length > 0 || session !== null) && (
        <BudgetBar
          status={status}
          budget={answer}
          idleNote={canQuote && blocksNow.quoted.length > 0 && dates !== null ? periodPrompt(dates, 'the plan') : undefined}
          refreshing={settling || (budget.isFetching && !!answer)}
          error={budget.error}
          onRetry={() => { void budget.refetch() }}
          planBudget={planBudget}
          planBudgetUnreadable={funding.isError}
          incompleteBlocks={blocksNow.incomplete}
          blocked={refused.length > 0}
          blockedReason={refused.length > 0 ? refusalSentence(refused, blocksNow.named) : undefined}
          unsaved={unsaved}
          notice={saveNotice}
          saved={savedNote}
          onDockHeight={setDockHeight}
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
