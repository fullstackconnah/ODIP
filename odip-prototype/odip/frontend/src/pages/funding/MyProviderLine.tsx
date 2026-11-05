import { useRef, useState, type FormEvent } from 'react'
import { useSetMyProvider } from '@/api/hooks'
import type { FundingPlanDto } from '@/api/types'
import type { MyProviderRecord, PlanType } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Modal } from '@/components/Modal'
import { StatusBadge } from '@/components/StatusBadge'
import { TextField } from '@/components/TextField'
import { TAP_AREA } from '@/components/tapArea'
import { ToggleGroup } from '@/components/ToggleGroup'
import { useProviderToday } from '@/hooks/useProviderToday'
import { writtenDay } from '@/lib/fundingPlan'
import type { Tone } from '@/lib/tone'
import { extractErrorMessage } from '@/lib/utils'

const MIN_DATE = '1990-01-01'

const SHOWN: Record<MyProviderRecord, { label: string; tone: Tone; since: string | null; dateLabel: string | null }> = {
  Unknown: { label: 'Not recorded', tone: 'warning', since: null, dateLabel: null },
  Requested: { label: 'Requested', tone: 'info', since: 'on', dateLabel: 'Requested on' },
  Recorded: { label: 'Recorded', tone: 'success', since: 'from', dateLabel: 'Recorded from' },
}
const OPTIONS = (['Unknown', 'Requested', 'Recorded'] as const).map(key => ({ key, label: SHOWN[key].label }))

/**
 * One line on the Funding tab's current plan: whether the provider is recorded as the participant's my provider for the plan (the NDIA pays a claim fastest when it is), and Update.
 * Only for NDIA-managed and plan-managed participants: a self-managed participant's funds are not claimed from the NDIA. The FundingTab above is already only for the roles that see money.
 */
export function MyProviderLine({ participantId, plan, planType }: { participantId: string; plan: FundingPlanDto; planType: PlanType }) {
  const [open, setOpen] = useState(false)
  const updateRef = useRef<HTMLButtonElement>(null)
  if (planType === 'SelfManaged') return null
  const shown = SHOWN[plan.myProvider ?? 'Unknown']
  const close = () => { setOpen(false); updateRef.current?.focus() }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="text-[var(--color-muted-foreground)]">My provider</span>
      <StatusBadge tone={shown.tone} label={shown.label} />
      {shown.since && plan.myProviderOn && <span className="whitespace-nowrap text-[var(--color-muted-foreground)]">{shown.since} {writtenDay(plan.myProviderOn)}</span>}
      <Button ref={updateRef} variant="ghost" size="sm" className={TAP_AREA} onClick={() => setOpen(true)}>Update</Button>
      {open && <MyProviderDialog participantId={participantId} plan={plan} onClose={close} />}
    </div>
  )
}

function MyProviderDialog({ participantId, plan, onClose }: { participantId: string; plan: FundingPlanDto; onClose: () => void }) {
  const save = useSetMyProvider(participantId)
  const dateRef = useRef<HTMLInputElement>(null)
  const [choice, setChoice] = useState<MyProviderRecord>(plan.myProvider ?? 'Unknown')
  const [date, setDate] = useState(plan.myProviderOn ?? '')
  const [dateError, setDateError] = useState<string>()
  const today = useProviderToday()
  const dateLabel = SHOWN[choice].dateLabel
  const unchanged = choice === (plan.myProvider ?? 'Unknown') && (choice === 'Unknown' || date === (plan.myProviderOn ?? ''))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (unchanged || save.isPending) return
    const problem = choice === 'Unknown' ? undefined
      : !date ? 'Enter the date.'
      : date < MIN_DATE ? 'Enter a date after 1990.'
      : choice === 'Requested' && date > today ? 'The date cannot be in the future.'
      : undefined
    setDateError(problem)
    if (problem) { dateRef.current?.focus(); return }
    save.mutate({ planId: plan.id, body: { myProvider: choice, myProviderOn: choice === 'Unknown' ? null : date } }, { onSuccess: onClose })
  }

  return (
    <Modal open onClose={onClose} title="My provider" size="sm" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="submit" form="my-provider" disabled={unchanged || save.isPending}>Save</Button>
    </>}>
      <form id="my-provider" onSubmit={submit} className="flex flex-col gap-[var(--field-gap-y)]">
        <p className="text-sm text-[var(--color-muted-foreground)]">Check the my NDIS provider portal. The NDIA pays a claim fastest when you&rsquo;re recorded as this participant&rsquo;s my provider for this plan.</p>
        <ToggleGroup ariaLabel="My provider" options={OPTIONS} value={choice} onChange={key => { setChoice(key as MyProviderRecord); setDateError(undefined) }} />
        {dateLabel && (
          <TextField ref={dateRef} label={dateLabel} type="date" min={MIN_DATE} max={choice === 'Requested' ? today : undefined} value={date} onChange={e => { setDate(e.target.value); setDateError(undefined) }} error={dateError} />
        )}
        {save.error && <Callout tone="error">{extractErrorMessage(save.error, 'Could not save. Please try again.')}</Callout>}
      </form>
    </Modal>
  )
}
