import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Trash2 } from 'lucide-react'
import { useBillingSourcesHint, useCreateFundingPlan, useFundingPlans, usePaceCategories, useUpdateFundingPlan } from '@/api/hooks'
import type { BudgetEvidenceSource, FundingPlanDto } from '@/api/types'
import { BUDGET_EVIDENCE_LABELS, BUDGET_EVIDENCE_SOURCES } from '@/api/types'
import { PLAN_TYPES, PLAN_TYPE_LABELS, type PlanType } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { CheckboxField } from '@/components/CheckboxField'
import { inputClass } from '@/components/FormField'
import { SelectField } from '@/components/SelectField'
import { SlideOver } from '@/components/SlideOver'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { periodLengthLabel } from '@/lib/fundingPeriods'
import { categoriesLabel, managementLabel, paceNumber, writtenSpan } from '@/lib/fundingPlan'
import { apiErrorCode, apiErrorMessages, apiErrorStatus } from '@/lib/shiftPackageErrors'
import { cn, formatCurrency } from '@/lib/utils'
import {
  addCorePool, addStatedPool, applySetAside, editorStateFromPlan, hasPool, isZeroSetAside, nextPlanState, noPeriodsReason, poolSums, removePool, resplit, SET_ASIDE_NOT_APPLIED, startFromBilling, toSaveBody, updatePool, validate,
  withPeriodEdit, withPlanFields, withPoolTotals, withSetAsideZeroConfirmed, type EditorPool, type EditorState, type PoolProblems, type Problems,
} from './fundingEditorState'

export type FundingPlanEditorProps = {
  open: boolean
  onClose: () => void
  participantId: string
  /** The plan being changed. Left out, the editor records a new one. */
  plan?: FundingPlanDto
  /** For a new plan: the plan it follows, so its dates start the day after that one ended. */
  previousPlan?: FundingPlanDto
  /** The management type the add buttons start with: the participant's own plan type. */
  defaultManagement: PlanType
  /** What the button that closes without saving says while nothing has been typed. The intake and profile cards call it "Plan not shared yet"; elsewhere it is Cancel, and once anything is typed it is Cancel everywhere. */
  skipLabel?: string
  onSaved?: (plan: FundingPlanDto) => void
}

const PERIOD_LENGTH_OPTIONS = [null, 1, 3, 6, 12].map(months => ({ value: months === null ? '' : String(months), label: periodLengthLabel(months) }))
const EVIDENCE_OPTIONS = BUDGET_EVIDENCE_SOURCES.map(source => ({ value: source, label: BUDGET_EVIDENCE_LABELS[source] }))
const MANAGEMENT_OPTIONS = PLAN_TYPES.map(type => ({ value: type, label: PLAN_TYPE_LABELS[type] }))

/** A period's amount box: the shared input, with px-2 REPLACING its px-3 (cn merges them; two padding classes together are decided by the stylesheet, and px-3 won, which clipped a figure on a phone). */
const periodInputClass = cn(inputClass, 'px-2 tabular-nums')

/** Beside the set-aside box while it holds a zero: what a $0 set-aside means, so the person confirms it knowingly or leaves the box blank. */
const ZERO_SET_ASIDE_LINE = 'A set-aside of $0 means nothing may be claimed against this pool. Leave it blank if none is recorded.'

const PROPOSAL_NOTE = 'Worked out from the plan dates and split by days. Change any amount to match the plan’s release schedule.'
const EDITED_NOTE = 'You have edited some amounts.'

type Failure = { kind: 'messages'; messages: string[] } | { kind: 'stale' }

/** What a refused save says: the server's own reasons, or that somebody saved first. */
function failureOf(error: unknown): Failure {
  if (apiErrorStatus(error) === 409 && apiErrorCode(error) === 'funding-revision-conflict') return { kind: 'stale' }
  const messages = apiErrorMessages(error)
  return { kind: 'messages', messages: messages.length > 0 ? messages : ['The plan budget was not saved. Check your connection and try again.'] }
}

/**
 * Where focus goes after the form changes under the person's hands: into a new pool's amount, onto the pool before a removed one, onto the Pools heading when none is left, or onto the
 * form's first field when the button that had focus went with the sentence it was under ("Load the latest").
 */
type FocusTarget = { kind: 'amount'; key: string } | { kind: 'pool'; key: string } | { kind: 'heading' } | { kind: 'first' }

/** Where an element that was scrolled to stops: 0.75rem (scroll-mt-3) clear of the panel's header rule. "nearest" alone leaves it flush under the rule, its top edge touching it. */
const SCROLL_CLEARANCE = '0.75rem'

function reveal(element: HTMLElement | null | undefined) {
  if (!element) return
  element.style.scrollMarginTop = SCROLL_CLEARANCE
  element.scrollIntoView({ block: 'nearest' })
}

/**
 * The form's own content, for "has anything changed": what the person can see and type, not the bookkeeping (a pool's key and flags, the revision). Two forms with the same content are the
 * same form, so a value put back as it was is not a change, and a plan loaded from the server (new keys) is not one either.
 */
function contentOf(state: EditorState): string {
  return JSON.stringify({
    planStart: state.planStart, planEnd: state.planEnd, reassessmentDate: state.reassessmentDate, periodLengthMonths: state.periodLengthMonths, evidence: state.evidence,
    confirmedOn: state.confirmedOn, confirmedByName: state.confirmedByName, notes: state.notes,
    pools: state.pools.map(pool => ({
      kind: pool.kind, paceCategory: pool.paceCategory, managementType: pool.managementType, name: pool.name, notes: pool.notes, totalText: pool.totalText, setAsideText: pool.setAsideText,
      setAsideZeroConfirmed: pool.setAsideZeroConfirmed, periods: pool.periods,
    })),
  })
}

/**
 * The plan budget editor: one SlideOver for the Funding tab, the intake card and the profile wizard. It records a plan's dates, how its funding is released and where the figures came from, then
 * its pools (Core flexible, or a stated support from the served category list) and each pool's periods. The periods are PROPOSED from the plan's dates and the length, the pool's amount split by
 * days to the cent, and every amount stays editable to match the plan's real release schedule; the server only checks the invariants and never proposes. What the periods add up to is shown,
 * and when edited amounts no longer add up to what was typed the editor says so (the save sends the periods: the server keeps no pool total).
 * Problems are said in plain words beside the field once a save has been tried, and focus goes to the first of them. A refused save keeps everything on screen: the server's reasons are listed
 * (scrolled into view and focused, because the Save button is at the bottom of a long form), and a stale revision (409) offers "Load the latest" without discarding what the person typed until
 * they choose to.
 */
export function FundingPlanEditor(props: FundingPlanEditorProps) {
  // Closed, the editor holds nothing: opening it again starts from the plan (or the next plan) as it is then, never from a previous session's edits.
  return props.open ? <EditorBody {...props} /> : null
}

function EditorBody({ onClose, participantId, plan, previousPlan, defaultManagement, skipLabel, onSaved }: FundingPlanEditorProps) {
  const create = useCreateFundingPlan(participantId)
  const update = useUpdateFundingPlan(participantId)
  const categoriesQuery = usePaceCategories()
  const latest = useFundingPlans(participantId)
  // The Billing hint is for starting a NEW plan only, and it is asked for once, while the editor is open.
  const hintQuery = useBillingSourcesHint(participantId, !plan)

  // A first plan starts from the plan dates the profile already holds (typed once at intake, not twice); a later one follows the plan before it.
  const profileDates = latest.data?.profilePlanDates
  const initial = useMemo(() => (plan ? editorStateFromPlan(plan) : nextPlanState(previousPlan, profileDates)), [plan, previousPlan, profileDates])
  const [state, setState] = useState<EditorState>(initial)
  // What "unsaved changes" is measured against: the form as it opened, or as it was last loaded from the server ("Load the latest").
  const [baseline, setBaseline] = useState<EditorState>(initial)
  const [attempted, setAttempted] = useState(false)
  // The pools whose problems are shown: all of them once a save has been tried, and one that was added since only once the person starts on it or the next save is tried (a pool added after
  // a failed check would otherwise open with an error under the very field that has just taken focus).
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())
  const [failure, setFailure] = useState<Failure | null>(null)
  const [rewrote, setRewrote] = useState(false)
  const [management, setManagement] = useState<PlanType>(defaultManagement)
  const [category, setCategory] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const failureRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<FocusTarget | null>(null)

  const problems = useMemo(() => validate(state), [state])
  const dirty = useMemo(() => contentOf(state) !== contentOf(baseline), [state, baseline])
  const saving = create.isPending || update.isPending
  const hint = hintQuery.data
  const categories = categoriesQuery.data ?? []
  const statedChoices = categories.filter(c => c.offeredAsStatedPool)
  const chosen = statedChoices.find(c => String(c.number) === category)
  const defaultNameOf = (pool: EditorPool): string => (pool.kind === 'CoreFlexible' ? 'Core (flexible)' : categories.find(c => c.number === pool.paceCategory)?.name ?? `Category ${paceNumber(pool.paceCategory)}`)
  const coreHeld = hasPool(state, 0, management)
  const statedHeld = chosen ? hasPool(state, chosen.number, management) : false
  const periodsReason = useMemo(() => noPeriodsReason(state), [state])
  // "Some fields need attention. Each has a message beside it." is said only while that is true: a pool nobody has started on has a problem but no message yet.
  const problemsShown = attempted && Boolean(
    problems.planStart || problems.planEnd || problems.confirmedByName || problems.notes || problems.general.length > 0 || state.pools.some(pool => revealed.has(pool.key) && problems.pools[pool.key]),
  )

  // A refused save puts its reason where the person is looking: the failure is scrolled into view and takes focus (the Save button is at the bottom of a long form, and it is disabled while saving).
  useEffect(() => {
    if (!failure) return
    failureRef.current?.focus({ preventScroll: true })
    reveal(failureRef.current)
  }, [failure])

  // Focus that was asked for by a handler (a pool added or removed, the latest plan loaded) lands once the form has re-rendered.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    const root = bodyRef.current
    const element = target.kind === 'heading'
      ? root?.querySelector<HTMLElement>('#funding-pools-heading')
      : target.kind === 'first'
        ? root?.querySelector<HTMLElement>('input, select, textarea')
        : target.kind === 'pool'
          ? root?.querySelector<HTMLElement>(`[data-pool-key="${target.key}"]`)
          : root?.querySelector<HTMLElement>(`[data-pool-key="${target.key}"] input[inputmode="decimal"]`)
    element?.focus({ preventScroll: true })
    reveal(element)
  })

  const change = (patch: Partial<EditorState>) => {
    const { state: next, rewroteEdits } = withPlanFields(state, patch)
    setState(next)
    if (rewroteEdits) setRewrote(true)
  }

  const addPool = (next: EditorState) => {
    const added = next.pools.find(pool => !state.pools.some(held => held.key === pool.key))
    if (added) pendingFocus.current = { kind: 'amount', key: added.key }
    setState(next)
  }

  const remove = (key: string) => {
    const index = state.pools.findIndex(pool => pool.key === key)
    const before = index > 0 ? state.pools[index - 1] : state.pools[index + 1]
    pendingFocus.current = before ? { kind: 'pool', key: before.key } : { kind: 'heading' }
    setState(removePool(state, key))
  }

  /** Every message beside a field is in the DOM once a save has been tried: focus goes to the first field marked invalid, or the plan-level message when no field is. */
  const focusFirstProblem = () => {
    const first = bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-problem]')
    first?.focus({ preventScroll: true })
    reveal(first)
  }

  // Before any save is tried nothing is shown, as ever. After one, a pool the person starts on shows its problems from then on (the pools that were there for the try already do).
  const startedOn = (key: string) => { if (attempted) setRevealed(held => (held.has(key) ? held : new Set(held).add(key))) }

  const save = () => {
    // The messages must be on screen before focus goes to the first of them: every pool's, including one added since the last try.
    if (!attempted || state.pools.some(pool => !revealed.has(pool.key))) flushSync(() => { setAttempted(true); setRevealed(new Set(state.pools.map(pool => pool.key))) })
    if (problems.any) {
      focusFirstProblem()
      return
    }
    setFailure(null)
    const body = toSaveBody(state)
    const handlers = {
      onSuccess: (saved: FundingPlanDto) => { onSaved?.(saved); onClose() },
      onError: (error: unknown) => setFailure(failureOf(error)),
    }
    if (plan) update.mutate({ planId: plan.id, body }, handlers)
    else create.mutate(body, handlers)
  }

  const loadLatest = async () => {
    const result = await latest.refetch()
    const newer = result.data?.plans.find(p => p.id === plan?.id)
    if (!newer) {
      setFailure({ kind: 'messages', messages: ['That plan could not be found any more. Close this panel and look at the participant’s Funding tab.'] })
      return
    }
    // The newer plan is the form's new starting point, so closing straight afterwards does not ask to discard what the person never typed. The button that had focus goes with its sentence:
    // focus goes to the form's first field, not to the page behind the panel.
    const loaded = editorStateFromPlan(newer)
    pendingFocus.current = { kind: 'first' }
    setState(loaded)
    setBaseline(loaded)
    setFailure(null)
    setRewrote(false)
    setAttempted(false)
    setRevealed(new Set())
  }

  return (
    <SlideOver
      open
      onClose={onClose}
      title={plan ? 'Edit plan budget' : 'Record plan budget'}
      description="The figures come from the plan the participant shares, or their plan manager."
      size="lg"
      dirty={dirty}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {/* The sentence has a row of its own while it has text, so Save and Cancel stay at the right whatever it says. Empty, it takes no room (sr-only is out of the flow) and is still the live
              region its text is announced from. */}
          <p className={problemsShown ? 'basis-full text-[13px] text-[var(--color-muted-foreground)]' : 'sr-only'} aria-live="polite">{problemsShown ? 'Some fields need attention. Each has a message beside it.' : ''}</p>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>{dirty ? 'Cancel' : skipLabel ?? 'Cancel'}</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : plan ? 'Save changes' : 'Save plan budget'}</Button>
          </div>
        </div>
      }
    >
      <div ref={bodyRef} className="flex flex-col gap-[var(--section-gap)]">
        {failure && (
          <div ref={failureRef} tabIndex={-1} className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
            {failure.kind === 'stale' ? (
              <Callout tone="warning">
                <p>Someone else changed this plan after you opened it. What you typed is still here. Load the latest to see their changes; that replaces what you have typed.</p>
                <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => { void loadLatest() }}>Load the latest</Button></div>
              </Callout>
            ) : (
              <Callout tone="danger" title="The plan budget was not saved.">
                <ul className="list-disc pl-5">{failure.messages.map(message => <li key={message}>{message}</li>)}</ul>
              </Callout>
            )}
          </div>
        )}

        <PlanFields state={state} problems={attempted ? problems : null} onChange={change} />
        {rewrote && <Callout tone="info">The periods were worked out again from the new dates, so amounts you had edited were replaced.</Callout>}

        <section className="flex flex-col gap-3" aria-labelledby="funding-pools-heading">
          <h3 id="funding-pools-heading" tabIndex={-1} className="text-sm font-semibold focus:outline-none">Pools</h3>
          {attempted && problems.general.map(message => <p key={message} data-problem="" tabIndex={-1} className="text-sm text-[var(--color-destructive)] focus:outline-none">{message}</p>)}

          {!plan && hint && hint.rows.length > 0 && state.pools.length === 0 && (
            <Callout tone="info">
              <p>The Billing page records {formatCurrency(hint.total)} across {hint.rows.length === 1 ? 'one funding source' : `${hint.rows.length} funding sources`} for this participant. You can start from that and check it against the plan.</p>
              <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => setState(startFromBilling(state, hint, defaultManagement))}>Start from Billing funding sources</Button></div>
            </Callout>
          )}

          {state.pools.map(pool => (
            <PoolCard
              key={pool.key}
              pool={pool}
              state={state}
              problems={revealed.has(pool.key) ? problems.pools[pool.key] : undefined}
              defaultName={defaultNameOf(pool)}
              noPeriodsReason={periodsReason}
              onState={next => { setState(next); startedOn(pool.key) }}
              onRemove={() => remove(pool.key)}
            />
          ))}

          <fieldset className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
            <legend className="px-1 text-[13px] font-semibold text-[var(--color-muted-foreground)]">Add a pool</legend>
            <SelectField label="Management type" value={management} onChange={event => setManagement(event.target.value as PlanType)} options={MANAGEMENT_OPTIONS} />
            <div className="flex flex-col gap-1">
              <Button variant="secondary" className="w-fit" disabled={coreHeld} onClick={() => addPool(addCorePool(state, management))}>Add Core (flexible)</Button>
              {coreHeld && <p className="text-[13px] text-[var(--color-muted-foreground)]">Core (flexible) is already in this plan under this management type.</p>}
            </div>
            <div className="flex flex-col gap-1">
              <SelectField
                label="Stated support category"
                value={category}
                onChange={event => setCategory(event.target.value)}
                options={[{ value: '', label: 'Choose a category' }, ...statedChoices.map(c => ({ value: String(c.number), label: `${paceNumber(c.number)} ${c.name}` }))]}
              />
              <Button variant="secondary" className="w-fit" disabled={!chosen || statedHeld} onClick={() => { if (chosen) { addPool(addStatedPool(state, chosen, management)); setCategory('') } }}>Add a stated support</Button>
              {chosen && statedHeld && <p className="text-[13px] text-[var(--color-muted-foreground)]">{chosen.name} is already in this plan under this management type.</p>}
            </div>
          </fieldset>
        </section>
      </div>
    </SlideOver>
  )
}

function PlanFields({ state, problems, onChange }: { state: EditorState; problems: Problems | null; onChange: (patch: Partial<EditorState>) => void }) {
  return (
    <section className="grid grid-cols-1 gap-x-3 gap-y-[var(--field-gap-y)] sm:grid-cols-2" aria-label="Plan">
      <TextField label="Plan start" type="date" required value={state.planStart} onChange={event => onChange({ planStart: event.target.value })} error={problems?.planStart} />
      <TextField label="Plan end" type="date" required value={state.planEnd} onChange={event => onChange({ planEnd: event.target.value })} error={problems?.planEnd} />
      <TextField label="Reassessment date" type="date" value={state.reassessmentDate} onChange={event => onChange({ reassessmentDate: event.target.value })} />
      <SelectField
        label="Funding periods"
        value={state.periodLengthMonths === null ? '' : String(state.periodLengthMonths)}
        onChange={event => onChange({ periodLengthMonths: event.target.value === '' ? null : Number(event.target.value) })}
        options={PERIOD_LENGTH_OPTIONS}
      />
      <SelectField label="Where the figures came from" value={state.evidence} onChange={event => onChange({ evidence: event.target.value as BudgetEvidenceSource })} options={EVIDENCE_OPTIONS} />
      <TextField label="Confirmed on" type="date" value={state.confirmedOn} onChange={event => onChange({ confirmedOn: event.target.value })} />
      <TextField label="Confirmed by" className="sm:col-span-2" value={state.confirmedByName} onChange={event => onChange({ confirmedByName: event.target.value })} error={problems?.confirmedByName} />
      <TextAreaField label="Notes" className="sm:col-span-2" rows={2} value={state.notes} onChange={event => onChange({ notes: event.target.value })} error={problems?.notes} />
    </section>
  )
}

/** The one sentence above a pool's periods: that they were worked out (when they were), and that amounts were edited (when they were). Nothing for a saved pool nobody has touched. */
function periodsNote(pool: EditorPool): string | null {
  const parts = [pool.fromPlan ? null : PROPOSAL_NOTE, pool.touched ? EDITED_NOTE : null].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' ') : null
}

function PoolCard(
  { pool, state, problems, defaultName, noPeriodsReason: reason, onState, onRemove }:
  { pool: EditorPool; state: EditorState; problems: PoolProblems | undefined; defaultName: string; noPeriodsReason: string; onState: (next: EditorState) => void; onRemove: () => void },
) {
  const shownName = pool.name.trim() || defaultName
  const label = `${shownName}, ${managementLabel(pool.managementType)}`
  const sums = poolSums(pool)
  const periodic = state.periodLengthMonths !== null
  const note = periodic && pool.periods.length > 0 ? periodsNote(pool) : null
  // "Split again" rewrites the periods from the typed totals, so it is offered when there is something to undo: an amount was changed in this session, or the periods and the boxes disagree.
  // (A set-aside that no period carries is only ever so after an amount was cleared by hand, so the pool is touched and the button, which is how that line says it is applied, is there.)
  const canSplitAgain = pool.touched || sums.planMismatch || sums.setAsideMismatch
  const notApplied = problems?.general.includes(SET_ASIDE_NOT_APPLIED) === true

  return (
    <section aria-label={label} data-pool-key={pool.key} tabIndex={-1} className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold">{shownName}</h4>
          <p className="text-[13px] text-[var(--color-muted-foreground)]"><span className="tabular-nums">{categoriesLabel(pool)}</span> · {managementLabel(pool.managementType)}</p>
        </div>
        <Button variant="ghost-danger" size="sm" aria-label={`Remove ${label}`} onClick={onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
        </Button>
      </div>

      <TextField label="Name on the plan" placeholder={shownName} value={pool.name} onChange={event => onState(updatePool(state, pool.key, { name: event.target.value }))} error={problems?.name} />
      {/* Two columns from sm, like the plan's own fields: the labels are short enough not to wrap (the hint under the set-aside box says whose it is), so the boxes sit level. */}
      <div className="grid grid-cols-1 gap-x-3 gap-y-[var(--field-gap-y)] sm:grid-cols-2">
        <TextField
          label="Plan amount for the whole plan" inputMode="decimal" placeholder="0.00" value={pool.totalText}
          onChange={event => onState(withPoolTotals(state, pool.key, { totalText: event.target.value }))} error={problems?.total}
        />
        <div className="flex flex-col gap-[var(--field-gap-y)]">
          <TextField
            label="Set-aside (optional)" inputMode="decimal" placeholder="0.00" value={pool.setAsideText}
            onChange={event => onState(withPoolTotals(state, pool.key, { setAsideText: event.target.value }))} error={problems?.setAside}
            hint="The part of this pool kept for your organisation when the participant also uses other providers. Leave blank if none is set aside."
          />
          {/* A typed zero is "none" or "$0 allowed", and a set-aside is the pool's limit: it is read as blank until the person says which. */}
          {isZeroSetAside(pool) && (
            <CheckboxField
              label="Yes, set aside $0 for this pool" checked={pool.setAsideZeroConfirmed}
              onChange={event => onState(withSetAsideZeroConfirmed(state, pool.key, event.target.checked))}
              hint={ZERO_SET_ASIDE_LINE}
            />
          )}
        </div>
      </div>

      {periodic ? (
        <>
          {note && <p className="text-[13px] text-[var(--color-muted-foreground)]">{note}</p>}
          <PeriodsTable pool={pool} problems={problems} emptyReason={reason} onEdit={(index, patch) => onState(withPeriodEdit(state, pool.key, index, patch))} />
          <div className="flex flex-col gap-1 text-sm" aria-live="polite">
            {sums.periodsPlan !== null && !sums.planMismatch && <p>The periods add up to {formatCurrency(sums.periodsPlan)}</p>}
            {sums.planMismatch && sums.periodsPlan !== null && sums.typedPlan !== null && (
              <p className="text-[var(--color-on-warning-container)]">The periods add up to {formatCurrency(sums.periodsPlan)}, not the {formatCurrency(sums.typedPlan)} you typed. The periods are what is saved.</p>
            )}
            {sums.setAsideMismatch && sums.periodsSetAside !== null && sums.typedSetAside !== null && (
              <p className="text-[var(--color-on-warning-container)]">The set-asides add up to {formatCurrency(sums.periodsSetAside)}, not the {formatCurrency(sums.typedSetAside)} you typed. The periods are what is saved.</p>
            )}
            {/* One line that is a warning while the person is working, and the error to put right once a save was tried (the same element, so it is announced once). */}
            {sums.setAsideMissing && (
              <p
                data-problem={notApplied ? '' : undefined} tabIndex={notApplied ? -1 : undefined}
                className={notApplied ? 'text-[var(--color-destructive)] focus:outline-none' : 'text-[var(--color-on-warning-container)]'}
              >{SET_ASIDE_NOT_APPLIED}</p>
            )}
            {/* The set-aside only: the box is forced onto the periods and every plan amount stays. It is the remedy for both lines above, so it has the weight of a real control. */}
            {(sums.setAsideMismatch || sums.setAsideMissing) && (
              <Button variant="secondary" size="sm" className="w-fit" disabled={sums.periodsPlan === null} onClick={() => onState(applySetAside(state, pool.key))}>Apply the set-aside to the periods</Button>
            )}
            {canSplitAgain && (
              <Button variant="ghost" size="sm" className="w-fit" onClick={() => onState({ ...state, pools: state.pools.map(p => (p.key === pool.key ? resplit(state, p) : p)) })}>Split again from the plan amount</Button>
            )}
          </div>
        </>
      ) : (
        <p className="text-[13px] text-[var(--color-muted-foreground)]">The whole plan is one period: {writtenSpan(state.planStart, state.planEnd)}.</p>
      )}
    </section>
  )
}

function PeriodsTable({ pool, problems, emptyReason, onEdit }: { pool: EditorPool; problems: PoolProblems | undefined; emptyReason: string; onEdit: (index: number, patch: { planAmount?: string; setAside?: string }) => void }) {
  if (pool.periods.length === 0) return <p className="text-[13px] text-[var(--color-muted-foreground)]">{emptyReason}</p>
  // The amount boxes are 7rem wide (88px of text at the 16px a phone needs): a figure like 100000.00 fits, where 6.5rem clipped the last digit of 15123.29 at 390 wide.
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[13px] text-[var(--color-muted-foreground)]">
          <th scope="col" className="py-1 pr-2 font-medium">Period</th>
          <th scope="col" className="px-1 py-1 font-medium">Plan amount</th>
          <th scope="col" className="whitespace-nowrap px-1 py-1 font-medium">Set-aside</th>
        </tr>
      </thead>
      <tbody>
        {pool.periods.map((period, index) => {
          const span = writtenSpan(period.periodStart, period.periodEnd)
          const row = problems?.periods[index]
          return (
            <tr key={period.periodStart} className="align-top">
              <td className="py-1 pr-2 tabular-nums sm:whitespace-nowrap">{span}</td>
              <td className="w-28 px-1 py-1">
                <input
                  className={periodInputClass} inputMode="decimal" aria-label={`Plan amount, ${span}`} aria-invalid={row?.planAmount ? true : undefined}
                  value={period.planAmount} onChange={event => onEdit(index, { planAmount: event.target.value })}
                />
                {row?.planAmount && <p className="mt-0.5 text-[13px] text-[var(--color-destructive)]">{row.planAmount}</p>}
              </td>
              <td className="w-28 px-1 py-1">
                <input
                  className={periodInputClass} inputMode="decimal" aria-label={`Set-aside, ${span}`} aria-invalid={row?.setAside ? true : undefined}
                  value={period.setAside} onChange={event => onEdit(index, { setAside: event.target.value })}
                />
                {row?.setAside && <p className="mt-0.5 text-[13px] text-[var(--color-destructive)]">{row.setAside}</p>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
