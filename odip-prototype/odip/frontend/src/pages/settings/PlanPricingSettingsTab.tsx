import { useState } from 'react'
import type { PlanCrossingPolicy, PlanGroupOutingFamily, PlanPricingSettingsDto, UpdatePlanPricingSettingsDto } from '@/api/types'
import { usePlanPricingSettings, useUpdatePlanPricingSettings } from '@/api/hooks'
import { Callout } from '@/components/Callout'
import { CheckboxField } from '@/components/CheckboxField'
import { FormField } from '@/components/FormField'
import { PageState } from '@/components/PageState'
import { retryingAfterError } from '@/lib/queryPhase'
import { StatusBadge } from '@/components/StatusBadge'
import { ToggleGroup } from '@/components/ToggleGroup'
import { formGrid, span } from '@/lib/formGrid'
import { REGISTRATION_GROUP_NAME } from '@/lib/planBlocks'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { extractErrorMessage } from '@/lib/utils'
import { NumberField } from '@/components/NumberField'
import { SettingsSection, type SaveResult, type SectionFrame } from './SettingsSection'
import { notSavedText } from './settingsSections'

const ALL_GROUPS = ['0107', '0104', '0125', '0136', '0115', '0108'] as const
const APPROVER_ROLES = ['Admin', 'Coordinator'] as const
/** The server refuses a per-kilometre rate above this: 9.90 for 0.99 was once accepted and made every kilometre line ten times too high. */
const MAX_KM_RATE = 5

const CROSSING_OPTIONS: { key: PlanCrossingPolicy; label: string }[] = [
  { key: 'Split', label: 'A: split (default)' },
  { key: 'HigherOf', label: 'B: higher of' },
]
const CROSSING_WORDS: Record<PlanCrossingPolicy, string> = {
  Split: 'A support that crosses 6 am, 8 pm, midnight or into a weekend is priced in parts, each part at its own item. The lower, conservative reading.',
  HigherOf: 'When one worker delivers the whole support, the higher-priced part applies to all of it, claimed on the day it starts. Never across a sleepover, and not when the headcount changes.',
}

const OUTING_OPTIONS: { key: PlanGroupOutingFamily; label: string }[] = [
  { key: 'GroupActivities', label: '0136 Group and centre based (default)' },
  { key: 'CommunityAccess', label: '0125 Community access' },
]

type Form = {
  crossingPolicy: PlanCrossingPolicy
  claimProviderTravel: boolean
  travelKmRateStandard: number
  travelKmRateAccessible: number
  travelRatesProvisional: boolean
  groupOutings: PlanGroupOutingFamily
  approverRoles: string[]
  approvalActivatesParticipant: boolean
}

function formOf(settings: PlanPricingSettingsDto): Form {
  return {
    crossingPolicy: settings.crossingPolicy, claimProviderTravel: settings.claimProviderTravel, travelKmRateStandard: settings.travelKmRateStandard,
    travelKmRateAccessible: settings.travelKmRateAccessible, travelRatesProvisional: settings.travelRatesProvisional, groupOutings: settings.groupOutings, approverRoles: [...settings.approverRoles],
    approvalActivatesParticipant: settings.approvalActivatesParticipant,
  }
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index])

/** What changed from the saved settings: the pricing settings change only for a field that is sent, so a form never sends one the person left alone. */
function changesOf(saved: PlanPricingSettingsDto, form: Form): UpdatePlanPricingSettingsDto {
  const changes: UpdatePlanPricingSettingsDto = {}
  if (form.crossingPolicy !== saved.crossingPolicy) changes.crossingPolicy = form.crossingPolicy
  if (form.claimProviderTravel !== saved.claimProviderTravel) changes.claimProviderTravel = form.claimProviderTravel
  if (form.travelKmRateStandard !== saved.travelKmRateStandard) changes.travelKmRateStandard = form.travelKmRateStandard
  if (form.travelKmRateAccessible !== saved.travelKmRateAccessible) changes.travelKmRateAccessible = form.travelKmRateAccessible
  if (form.travelRatesProvisional !== saved.travelRatesProvisional) changes.travelRatesProvisional = form.travelRatesProvisional
  if (form.groupOutings !== saved.groupOutings) changes.groupOutings = form.groupOutings
  if (!sameList(form.approverRoles, saved.approverRoles)) changes.approverRoles = form.approverRoles
  if (form.approvalActivatesParticipant !== saved.approvalActivatesParticipant) changes.approvalActivatesParticipant = form.approvalActivatesParticipant
  return changes
}

function rateError(value: number): string | undefined {
  if (Number.isNaN(value)) return 'Enter a rate.'
  if (value < 0 || value > MAX_KM_RATE) return `The rate must be between $0 and $${MAX_KM_RATE} a kilometre.`
  return undefined
}

/**
 * Settings, Plan pricing (Admin and SuperAdmin): the provider's own answers to the questions the pricing engine must not guess. The registration groups it holds (and a box that
 * says somebody has looked, saved with everything else), how a support that crosses a price boundary is priced, whether provider travel is claimed and at what per-kilometre rates (capped at $5, and marked
 * provisional until NDIA publishes 2026-27), where group outings are billed, and who may approve an agreement. Short-term accommodation is shown as it is: the new items only.
 */

export default function PlanPricingSettingsTab(frame: SectionFrame) {
  const query = usePlanPricingSettings()
  const update = useUpdatePlanPricingSettings()
  const settings = query.data
  const [form, setForm] = useState<Form | null>(null)
  const [groups, setGroups] = useState<string[] | null>(null)
  // "These are the registration groups we hold", ticked this visit: the attestation the old "Confirm these groups" button made.
  const [attest, setAttest] = useState(false)
  const [result, setResult] = useState<SaveResult>(null)

  const current = form ?? (settings ? formOf(settings) : null)
  const heldNow = groups ?? settings?.registrationGroupsHeld ?? []
  const confirmed = settings?.registrationGroupsConfirmed ?? false
  // Somebody confirmed them meanwhile: the box is gone, so its tick goes too, and Save has nothing hidden to send.
  if (confirmed && attest) setAttest(false)
  const groupsChanged = settings ? !sameList(heldNow, settings.registrationGroupsHeld) : false
  // The groups go with the one Save when they changed or were attested. The PUT reads a sent group list as confirmed unless told
  // otherwise, so the flag always goes with them: true once attested here or confirmed before, false while nobody has said so.
  const body: UpdatePlanPricingSettingsDto = {
    ...(settings && current ? changesOf(settings, current) : {}),
    ...(groupsChanged || attest ? { registrationGroupsHeld: heldNow, registrationGroupsConfirmed: confirmed || attest } : {}),
  }
  const dirty = Object.keys(body).length > 0
  const rateProblems = current ? [rateError(current.travelKmRateStandard), rateError(current.travelKmRateAccessible)].filter(Boolean).length : 0
  const problems = rateProblems + (heldNow.length === 0 ? 1 : 0) + (current && current.approverRoles.length === 0 ? 1 : 0)

  const edit = (patch: Partial<Form>) => { if (current) setForm({ ...current, ...patch }) }
  const toggleGroup = (code: string) => setGroups(heldNow.includes(code) ? heldNow.filter(held => held !== code) : ALL_GROUPS.filter(group => heldNow.includes(group) || group === code))
  const toggleRole = (role: string) => {
    if (current) edit({ approverRoles: current.approverRoles.includes(role) ? current.approverRoles.filter(r => r !== role) : APPROVER_ROLES.filter(r => current.approverRoles.includes(r) || r === role) })
  }
  const save = () => {
    setResult(null)
    update.mutate(body, {
      onSuccess: () => { setForm(null); setGroups(null); setAttest(false); setResult('saved') },
      onError: (error: unknown) => setResult({ error: notSavedText(error) }),
    })
  }
  // A SuperAdmin who has not chosen an organisation to view as is told so by the server (a 400): that is an instruction, not a failure, and Try again cannot fix it.
  const told = !settings && apiErrorStatus(query.error) === 400 ? extractErrorMessage(query.error, '') : ''

  return (
    <SettingsSection {...frame} save={settings && current ? { dirty, pending: update.isPending, result, problems, onSave: save } : undefined}>
      {query.isLoading && !retryingAfterError(query) ? <PageState kind="loading" noun="plan pricing section" />
        : !settings || !current ? (told ? <Callout tone="info" className="max-w-prose">{told}</Callout> : <PageState kind="error" noun="plan pricing section" onRetry={() => query.refetch()} />)
        : (
          <>
            {settings.isDefault && <Callout tone="info" className="max-w-prose">Nothing has been saved yet: these are the defaults the plan builder assumes. Confirm the registration groups below, then check the rest.</Callout>}

            <section className="flex flex-col gap-[var(--field-gap-y)]" aria-labelledby="pricing-groups-heading">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="pricing-groups-heading" className="font-semibold">Registration groups you hold</h3>
                <StatusBadge tone={confirmed ? 'success' : 'warning'} label={confirmed ? 'Confirmed' : 'Not confirmed'} />
              </div>
              <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">They decide which kinds of support the plan builder offers. Until somebody confirms them, every plan carries a notice, because &ldquo;all six&rdquo; is only an assumption.</p>
              <div className="flex flex-col" role="group" aria-label="Registration groups">
                {ALL_GROUPS.map(code => (
                  <CheckboxField key={code} label={<span><span className="font-mono tabular-nums">{code}</span> {REGISTRATION_GROUP_NAME[code]}</span>} checked={heldNow.includes(code)} onChange={() => toggleGroup(code)} />
                ))}
              </div>
              {heldNow.length === 0 && <p role="alert" className="text-sm text-[var(--color-destructive)]">With no registration group, nothing can be priced.</p>}
              {!confirmed && <CheckboxField label="These are the registration groups we hold" checked={attest} onChange={event => setAttest(event.target.checked)} />}
            </section>

            <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-labelledby="pricing-crossing-heading">
              <h3 id="pricing-crossing-heading" className="font-semibold">When a support crosses a price boundary</h3>
              <FormField label="Crossing policy">
                <ToggleGroup className="flex-wrap" ariaLabel="Crossing policy" options={CROSSING_OPTIONS} value={current.crossingPolicy} onChange={value => edit({ crossingPolicy: value as PlanCrossingPolicy })} />
              </FormField>
              <p className="text-sm text-[var(--color-muted-foreground)]" aria-live="polite">{CROSSING_WORDS[current.crossingPolicy]}</p>
            </section>

            <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-labelledby="pricing-travel-heading">
              <h3 id="pricing-travel-heading" className="font-semibold">Provider travel</h3>
              <CheckboxField label="Claim provider travel" hint="Off, no block is priced with a travel line, whatever it asks for." checked={current.claimProviderTravel} onChange={event => edit({ claimProviderTravel: event.target.checked })} />
              <div className={formGrid}>
                <NumberField label="Standard vehicle, $ a kilometre" className={span.medium} value={current.travelKmRateStandard} min={0} max={MAX_KM_RATE} step={0.01} inputMode="decimal" error={rateError(current.travelKmRateStandard)} onChange={value => edit({ travelKmRateStandard: value })} />
                <NumberField label="Accessible vehicle or bus, $ a kilometre" className={span.medium} value={current.travelKmRateAccessible} min={0} max={MAX_KM_RATE} step={0.01} inputMode="decimal" error={rateError(current.travelKmRateAccessible)} onChange={value => edit({ travelKmRateAccessible: value })} />
              </div>
              <CheckboxField label="These rates are provisional" hint="NDIA has not published 2026-27 per-kilometre rates or travel time caps, so the 2025-26 values are used. While this is on, every line that uses them says Provisional." checked={current.travelRatesProvisional} onChange={event => edit({ travelRatesProvisional: event.target.checked })} />
            </section>

            <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-labelledby="pricing-outings-heading">
              <h3 id="pricing-outings-heading" className="font-semibold">Group outings</h3>
              <FormField label="Bill group outings under">
                <ToggleGroup className="flex-wrap" ariaLabel="Bill group outings under" options={OUTING_OPTIONS} value={current.groupOutings} onChange={value => edit({ groupOutings: value as PlanGroupOutingFamily })} />
              </FormField>
              <p className="text-sm text-[var(--color-muted-foreground)]">Both families carry the same hourly prices and the group fraction. The registration group you need follows this choice.</p>
            </section>

            <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-labelledby="pricing-sta-heading">
              <h3 id="pricing-sta-heading" className="font-semibold">Short-term accommodation</h3>
              <p className="text-sm">Planned with the new hourly support items plus accommodation nights. {settings.staUsesHourlyAndAccommodation ? 'This is how every short-term accommodation block is priced.' : 'The legacy per-day items are set here, which the plan builder refuses.'}</p>
              <p className="text-[13px] text-[var(--color-muted-foreground)]">The legacy per-day items end on 30 June 2027, so they are not offered. This is not a choice.</p>
            </section>

            <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-labelledby="pricing-approvers-heading">
              <h3 id="pricing-approvers-heading" className="font-semibold">Who may approve an agreement</h3>
              <div className="flex flex-wrap gap-x-6" role="group" aria-label="Approver roles">
                {APPROVER_ROLES.map(role => <CheckboxField key={role} label={role} checked={current.approverRoles.includes(role)} onChange={() => toggleRole(role)} />)}
              </div>
              {current.approverRoles.length === 0 && <p role="alert" className="text-sm text-[var(--color-destructive)]">At least one role must be able to approve.</p>}
              <p className="text-[13px] text-[var(--color-muted-foreground)]">These roles may mark a plan approved for rostering, on the newest revision of an agreement draft. Approving makes its weekly roster patterns and unfilled shifts; it is separate from signing. A SuperAdmin acting for an organisation may always approve.</p>
              <CheckboxField label="Move the participant to Active when their agreement is approved" hint="Only people still onboarding who are ready to be made active. Nobody is moved back if an agreement ends." checked={current.approvalActivatesParticipant} onChange={event => edit({ approvalActivatesParticipant: event.target.checked })} />
            </section>
          </>
        )}
    </SettingsSection>
  )
}
