import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useBillingSourcesHint, useCreateFundingPlan, useFundingPlans, usePaceCategories, useUpdateFundingPlan } from '@/api/hooks'
import type { BudgetEvidenceSource, FundingPlanDto } from '@/api/types'
import { BUDGET_EVIDENCE_LABELS, BUDGET_EVIDENCE_SOURCES } from '@/api/types'
import { PLAN_TYPES, PLAN_TYPE_LABELS, type PlanType } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { inputClass } from '@/components/FormField'
import { SelectField } from '@/components/SelectField'
import { SlideOver } from '@/components/SlideOver'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { periodLengthLabel } from '@/lib/fundingPeriods'
import { categoriesLabel, managementLabel, paceNumber, writtenSpan } from '@/lib/fundingPlan'
import { apiErrorCode, apiErrorMessages, apiErrorStatus } from '@/lib/shiftPackageErrors'
import { formatCurrency } from '@/lib/utils'
import {
  addCorePool, addStatedPool, editorStateFromPlan, hasPool, nextPlanState, poolSums, removePool, resplit, startFromBilling, toSaveBody, updatePool, validate,
  withPeriodEdit, withPlanFields, withPoolTotals, type EditorPool, type EditorState, type PoolProblems, type Problems,
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
  /** What the button that closes without saving says. The intake and profile cards call it "Plan not shared yet"; elsewhere it is Cancel. */
  skipLabel?: string
  onSaved?: (plan: FundingPlanDto) => void
}

const PERIOD_LENGTH_OPTIONS = [null, 1, 3, 6, 12].map(months => ({ value: months === null ? '' : String(months), label: periodLengthLabel(months) }))
const EVIDENCE_OPTIONS = BUDGET_EVIDENCE_SOURCES.map(source => ({ value: source, label: BUDGET_EVIDENCE_LABELS[source] }))
const MANAGEMENT_OPTIONS = PLAN_TYPES.map(type => ({ value: type, label: PLAN_TYPE_LABELS[type] }))

type Failure = { kind: 'messages'; messages: string[] } | { kind: 'stale' }

/** What a refused save says: the server's own reasons, or that somebody saved first. */
function failureOf(error: unknown): Failure {
  if (apiErrorStatus(error) === 409 && apiErrorCode(error) === 'funding-revision-conflict') return { kind: 'stale' }
  const messages = apiErrorMessages(error)
  return { kind: 'messages', messages: messages.length > 0 ? messages : ['The plan budget was not saved. Check your connection and try again.'] }
}

/**
 * The plan budget editor: one SlideOver for the Funding tab, the intake card and the profile wizard. It records a plan's dates, how its funding is released and where the figures came from, then
 * its pools (Core flexible, or a stated support from the served category list) and each pool's periods. The periods are PROPOSED from the plan's dates and the length, the pool's amount split by
 * days to the cent, and every amount stays editable to match the plan's real release schedule; the server only checks the invariants and never proposes. What the periods add up to is shown,
 * and when edited amounts no longer add up to what was typed the editor says so (the save sends the periods: the server keeps no pool total).
 * Problems are said in plain words beside the field once a save has been tried. A refused save keeps everything on screen: the server's reasons are listed, and a stale revision (409) offers
 * "Load the latest" without discarding what the person typed until they choose to.
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

  const initial = useMemo(() => (plan ? editorStateFromPlan(plan) : nextPlanState(previousPlan)), [plan, previousPlan])
  const [state, setState] = useState<EditorState>(initial)
  const [attempted, setAttempted] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [rewrote, setRewrote] = useState(false)
  const [management, setManagement] = useState<PlanType>(defaultManagement)
  const [category, setCategory] = useState('')

  const problems = useMemo(() => validate(state), [state])
  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial])
  const saving = create.isPending || update.isPending
  const hint = hintQuery.data
  const categories = categoriesQuery.data ?? []
  const statedChoices = categories.filter(c => c.offeredAsStatedPool)
  const chosen = statedChoices.find(c => String(c.number) === category)
  const defaultNameOf = (pool: EditorPool): string => (pool.kind === 'CoreFlexible' ? 'Core (flexible)' : categories.find(c => c.number === pool.paceCategory)?.name ?? `Category ${paceNumber(pool.paceCategory)}`)
  const coreHeld = hasPool(state, 0, management)
  const statedHeld = chosen ? hasPool(state, chosen.number, management) : false

  const change = (patch: Partial<EditorState>) => {
    const { state: next, rewroteEdits } = withPlanFields(state, patch)
    setState(next)
    if (rewroteEdits) setRewrote(true)
  }

  const save = () => {
    setAttempted(true)
    if (problems.any) return
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
    setState(editorStateFromPlan(newer))
    setFailure(null)
    setRewrote(false)
    setAttempted(false)
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-[var(--color-muted-foreground)]" aria-live="polite">{attempted && problems.any ? 'Some fields need attention. They are marked below.' : ''}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>{skipLabel ?? 'Cancel'}</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : plan ? 'Save changes' : 'Save plan budget'}</Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-[var(--section-gap)]">
        {failure?.kind === 'stale' && (
          <Callout tone="warning" actions={<Button variant="secondary" size="sm" onClick={() => { void loadLatest() }}>Load the latest</Button>}>
            This plan was changed by someone else since you opened it. Your changes are still on screen: load the latest to see theirs, which replaces what you have typed.
          </Callout>
        )}
        {failure?.kind === 'messages' && (
          <Callout tone="danger" title="The plan budget was not saved.">
            <ul className="list-disc pl-5">{failure.messages.map(message => <li key={message}>{message}</li>)}</ul>
          </Callout>
        )}

        <PlanFields state={state} problems={attempted ? problems : null} onChange={change} />
        {rewrote && <Callout tone="info">The periods were worked out again from the new dates, so amounts you had edited were replaced.</Callout>}

        <section className="flex flex-col gap-3" aria-labelledby="funding-pools-heading">
          <h3 id="funding-pools-heading" className="text-sm font-semibold">Pools</h3>
          {attempted && problems.general.map(message => <p key={message} className="text-sm text-[var(--color-destructive)]">{message}</p>)}

          {!plan && hint && hint.rows.length > 0 && state.pools.length === 0 && (
            <Callout
              tone="info"
              actions={<Button variant="secondary" size="sm" onClick={() => setState(startFromBilling(state, hint, defaultManagement))}>Start from Billing funding sources</Button>}
            >
              The Billing page records {formatCurrency(hint.total)} across {hint.rows.length === 1 ? 'one funding source' : `${hint.rows.length} funding sources`} for this participant. You can start from that and check it against the plan.
            </Callout>
          )}

          {state.pools.map(pool => (
            <PoolCard
              key={pool.key}
              pool={pool}
              state={state}
              problems={attempted ? problems.pools[pool.key] : undefined}
              defaultName={defaultNameOf(pool)}
              onState={setState}
            />
          ))}

          <fieldset className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
            <legend className="px-1 text-[13px] font-semibold text-[var(--color-muted-foreground)]">Add a pool</legend>
            <SelectField label="Managed by" value={management} onChange={event => setManagement(event.target.value as PlanType)} options={MANAGEMENT_OPTIONS} />
            <div className="flex flex-col gap-1">
              <Button variant="secondary" className="w-fit" disabled={coreHeld} onClick={() => setState(addCorePool(state, management))}>Add Core (flexible)</Button>
              {coreHeld && <p className="text-[13px] text-[var(--color-muted-foreground)]">Core (flexible) is already in this plan under this management type.</p>}
            </div>
            <div className="flex flex-col gap-1">
              <SelectField
                label="Stated support category"
                value={category}
                onChange={event => setCategory(event.target.value)}
                options={[{ value: '', label: 'Choose a category' }, ...statedChoices.map(c => ({ value: String(c.number), label: `${paceNumber(c.number)} ${c.name}` }))]}
              />
              <Button variant="secondary" className="w-fit" disabled={!chosen || statedHeld} onClick={() => { if (chosen) { setState(addStatedPool(state, chosen, management)); setCategory('') } }}>Add a stated support</Button>
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

function PoolCard({ pool, state, problems, defaultName, onState }: { pool: EditorPool; state: EditorState; problems: PoolProblems | undefined; defaultName: string; onState: (next: EditorState) => void }) {
  const shownName = pool.name.trim() || defaultName
  const label = `${shownName}, ${managementLabel(pool.managementType)}`
  const sums = poolSums(pool)
  const periodic = state.periodLengthMonths !== null

  return (
    <section aria-label={label} className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold">{shownName}</h4>
          <p className="text-[13px] text-[var(--color-muted-foreground)]"><span className="tabular-nums">{categoriesLabel(pool)}</span> · {managementLabel(pool.managementType)}</p>
        </div>
        <Button variant="ghost-danger" size="sm" aria-label={`Remove ${label}`} onClick={() => onState(removePool(state, pool.key))}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
        </Button>
      </div>

      <TextField label="Name on the plan" placeholder={shownName} value={pool.name} onChange={event => onState(updatePool(state, pool.key, { name: event.target.value }))} error={problems?.name} />
      <div className="grid grid-cols-1 gap-x-3 gap-y-[var(--field-gap-y)] sm:grid-cols-2">
        <TextField
          label="Plan amount for the whole plan" inputMode="decimal" placeholder="0.00" value={pool.totalText}
          onChange={event => onState(withPoolTotals(state, pool.key, { totalText: event.target.value }))} error={problems?.total}
        />
        <TextField
          label="Oassist's set-aside (optional)" inputMode="decimal" placeholder="0.00" value={pool.setAsideText}
          onChange={event => onState(withPoolTotals(state, pool.key, { setAsideText: event.target.value }))} error={problems?.setAside}
          hint="Only when the participant also uses other providers."
        />
      </div>

      {periodic ? (
        <>
          <PeriodsTable pool={pool} problems={problems} onEdit={(index, patch) => onState(withPeriodEdit(state, pool.key, index, patch))} />
          <div className="flex flex-col gap-1 text-sm" aria-live="polite">
            {sums.periodsPlan !== null && !sums.planMismatch && <p>The periods add up to {formatCurrency(sums.periodsPlan)}</p>}
            {sums.planMismatch && sums.periodsPlan !== null && sums.typedPlan !== null && (
              <p className="text-[var(--color-on-warning-container)]">The periods add up to {formatCurrency(sums.periodsPlan)}, not the {formatCurrency(sums.typedPlan)} you typed. The periods are what is saved.</p>
            )}
            {sums.setAsideMismatch && sums.periodsSetAside !== null && sums.typedSetAside !== null && (
              <p className="text-[var(--color-on-warning-container)]">The set-asides add up to {formatCurrency(sums.periodsSetAside)}, not the {formatCurrency(sums.typedSetAside)} you typed. The periods are what is saved.</p>
            )}
            {pool.edited && (
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

function PeriodsTable({ pool, problems, onEdit }: { pool: EditorPool; problems: PoolProblems | undefined; onEdit: (index: number, patch: { planAmount?: string; setAside?: string }) => void }) {
  if (pool.periods.length === 0) return <p className="text-[13px] text-[var(--color-muted-foreground)]">Give the plan&rsquo;s dates to see its periods.</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[13px] text-[var(--color-muted-foreground)]">
          <th scope="col" className="py-1 pr-2 font-medium">Period</th>
          <th scope="col" className="px-1 py-1 font-medium">Plan amount</th>
          <th scope="col" className="px-1 py-1 font-medium">Oassist&rsquo;s set-aside</th>
        </tr>
      </thead>
      <tbody>
        {pool.periods.map((period, index) => {
          const span = writtenSpan(period.periodStart, period.periodEnd)
          const row = problems?.periods[index]
          return (
            <tr key={period.periodStart} className="align-top">
              <td className="py-1 pr-2 tabular-nums">{span}</td>
              <td className="px-1 py-1">
                <input
                  className={`${inputClass} tabular-nums`} inputMode="decimal" aria-label={`Plan amount, ${span}`} aria-invalid={row?.planAmount ? true : undefined}
                  value={period.planAmount} onChange={event => onEdit(index, { planAmount: event.target.value })}
                />
                {row?.planAmount && <p className="mt-0.5 text-[13px] text-[var(--color-destructive)]">{row.planAmount}</p>}
              </td>
              <td className="px-1 py-1">
                <input
                  className={`${inputClass} tabular-nums`} inputMode="decimal" aria-label={`Set-aside, ${span}`} aria-invalid={row?.setAside ? true : undefined}
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
