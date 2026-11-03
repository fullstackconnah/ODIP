import type { Ref } from 'react'
import { ChevronDown } from 'lucide-react'
import type { AgreementState, PlanPriceZone } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { FactList } from '@/components/FactList'
import { FormField } from '@/components/FormField'
import { useStickyOpen } from '@/hooks/useStickyOpen'
import { formGrid, span } from '@/lib/formGrid'
import { writtenDay, writtenSpan } from '@/lib/fundingPlan'
import { STATES, ZONES, withoutControlCharacters, type Details } from '@/lib/agreementDetails'
import { parseDateOnly } from '@/lib/dateOnly'
import { PRICING_FIRST_YEAR, PRICING_LAST_YEAR, addDays, addMonths } from '@/lib/planQuote'
import { zoneOfMm } from '@/lib/planBlocks'

/** The years the pricing engine answers for, as the bounds of every date box (a box that is left to run takes a year with six digits). */
const DATE_MIN = `${PRICING_FIRST_YEAR}-01-01`
const DATE_MAX = `${PRICING_LAST_YEAR}-12-31`

/** The lengths on offer. A preset ends the day before the same date N months on, the one rule the plan quote uses (planQuote.addMonths). */
const PRESET_MONTHS = [1, 3, 6, 12] as const
/** Starts, Length and Ends share one row from xl; Length is the widest so its longest option fits (the date span of 6 would not leave it room). */
const startCol = 'md:col-span-1 xl:col-span-3', lengthCol = 'md:col-span-1 xl:col-span-5', endCol = 'md:col-span-1 xl:col-span-4'
/** The pricing engine's longest period (PlanPricingEngine.MaxPeriodDays): Ongoing runs to the plan end, so a longer plan needs a chosen end. */
const MAX_PERIOD_DAYS = 800
const presetEnd = (start: string, months: number) => addDays(addMonths(start, months), -1)

type AgreementStepProps = {
  details: Details
  onEdit: (patch: Partial<Details>) => void
  /** The funding plan recorded for the participant that is running or about to, or null. */
  recorded: { start: string; end: string } | null
  plan: { start: string; end: string }
  /** Problems with the dates, shown once the person has tried to go on. */
  errors: { start?: string; end?: string }
  readOnly: boolean
  fundingTab: string
  /** Opens the editor to record the plan over the agreement, for a person who may; without it the button goes to the Funding tab. */
  recordBudget?: { label: string; onSelect: () => void }
  /** The day the participant's last recorded plan ended, when it has and none is running or about to. */
  endedOn?: string
  /** The line that says where the NDIS plan dates come from: focus goes to it after a budget is recorded from this step, since the button that opened the editor goes. */
  planLineRef?: Ref<HTMLParagraphElement>
}

/** Step 1: when the agreement runs and where it is delivered. The NDIS plan dates come from the participant's funding plan and are only asked for when there is none or they differ. */
export function AgreementStep({ details, onEdit, recorded, plan, errors, readOnly, fundingTab, recordBudget, endedOn, planLineRef }: AgreementStepProps) {
  const planFold = useStickyOpen(!!details.planOverride)
  if (readOnly) {
    return (
      <FactList items={[
        { label: 'Agreement', value: details.ongoing ? `${writtenDay(details.agreementStartDate)}, ongoing, repeating every week` : `${writtenSpan(details.agreementStartDate, details.agreementEndDate)}, repeating every week` },
        { label: 'NDIS plan', value: writtenSpan(plan.start, plan.end) },
        { label: 'State', value: details.state },
        { label: 'Price zone', value: ZONES.find(zone => zone.value === details.zone)?.label ?? details.zone },
        { label: 'Representative', value: details.representative },
      ]} />
    )
  }
  const { agreementStartDate: start, agreementEndDate: end } = details
  const canPreset = !!start && addMonths(start, 1) !== ''
  const canOngoing = !!recorded || !!details.planOverride
  const planTooLong = !!start && (parseDateOnly(plan.end) ?? 0) - (parseDateOnly(start) ?? 0) + 1 > MAX_PERIOD_DAYS
  const length = details.ongoing ? 'ongoing' : PRESET_MONTHS.find(months => !!start && end === presetEnd(start, months))?.toString() ?? 'custom'
  const chooseLength = (value: string) => {
    if (value === 'ongoing') onEdit({ ongoing: true, agreementEndDate: plan.end })
    else if (value === 'custom') onEdit({ ongoing: false, agreementEndDate: '' })
    else onEdit({ ongoing: false, agreementEndDate: presetEnd(start, Number(value)) })
  }
  const outside = !!details.agreementStartDate && !!details.agreementEndDate && (details.agreementStartDate < plan.start || details.agreementEndDate > plan.end)
  return (
    <div className="flex max-w-4xl flex-col gap-[var(--section-gap)]">
      <div className={formGrid}>
        <FormField label="Agreement starts" className={startCol} error={errors.start}>
          <input type="date" min={DATE_MIN} max={DATE_MAX} value={details.agreementStartDate} onChange={event => onEdit({ agreementStartDate: event.target.value })} />
        </FormField>
        <FormField label="Length" className={lengthCol} hint={[!canPreset && 'Choose the start first.', !canOngoing && 'Add the NDIS plan dates to choose Ongoing.', canOngoing && planTooLong && 'This NDIS plan runs longer than 800 days from the agreement start. Choose an end date instead of Ongoing.'].filter(Boolean).join(' ') || undefined}>
          <select value={length} onChange={event => chooseLength(event.target.value)}>
            <option value="custom">Choose an end date</option>
            {PRESET_MONTHS.map(months => <option key={months} value={months} disabled={!canPreset}>{months === 1 ? '1 month' : `${months} months`}</option>)}
            <option value="ongoing" disabled={!canOngoing || planTooLong}>Ongoing (until the plan ends)</option>
          </select>
        </FormField>
        <FormField label="Agreement ends" className={endCol} error={errors.end} hint={details.ongoing ? `Reviewed when the NDIS plan ends on ${writtenDay(plan.end)}. Shifts and totals run to then.` : undefined}>
          {details.ongoing ? (
            <p className="py-2 text-sm">Ongoing, to the plan end</p>
          ) : (
            <input type="date" min={DATE_MIN} max={DATE_MAX} value={details.agreementEndDate} onChange={event => onEdit({ agreementEndDate: event.target.value })} />
          )}
        </FormField>
        <FormField label="State" className={span.short} hint="Where the supports are delivered.">
          <select value={details.state} onChange={event => onEdit({ state: event.target.value as AgreementState })}>{STATES.map(value => <option key={value} value={value}>{value}</option>)}</select>
        </FormField>
        <FormField label="Representative (optional)" className={span.medium} hint="Printed on the agreement.">
          <input value={details.representative} maxLength={500} onChange={event => onEdit({ representative: withoutControlCharacters(event.target.value) })} />
        </FormField>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        {recorded && !details.planOverride ? (
          <p ref={planLineRef} tabIndex={-1} className="focus:outline-none">NDIS plan: {writtenSpan(recorded.start, recorded.end)}, from the Funding tab. A new agreement is given these dates to begin with.</p>
        ) : details.planOverride ? (
          <p ref={planLineRef} tabIndex={-1} className="focus:outline-none">NDIS plan: {writtenSpan(details.planOverride.start, details.planOverride.end)}, as you set it below.</p>
        ) : (
          <p ref={planLineRef} tabIndex={-1} className="max-w-prose focus:outline-none">
            {endedOn
              ? <>The recorded NDIS plan ended on {writtenDay(endedOn)}. Until a new one is recorded, the NDIS plan is taken to run for the agreement&apos;s dates, and there is no budget to compare the agreement with.</>
              : <>No funding plan is recorded for this participant, so the NDIS plan is taken to run for the agreement&apos;s dates, and there is no budget to compare the agreement with.</>}{' '}
            {recordBudget
              ? <Button variant="secondary" size="sm" onClick={recordBudget.onSelect}>{recordBudget.label}</Button>
              : <Button variant="secondary" size="sm" to={fundingTab}>Record the plan</Button>}
          </p>
        )}
        <details className="group rounded-[var(--radius-md)] border border-[var(--color-border)]" open={planFold.open} onToggle={planFold.onToggle}>
          <summary className="flex min-h-[var(--control-h)] cursor-pointer select-none items-center justify-between px-3 font-medium">Different NDIS plan dates?<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
          <div className="flex flex-col gap-[var(--section-gap)] border-t border-[var(--color-border)] p-3">
            <div className={formGrid}>
              <FormField label="NDIS plan starts" className={span.date}>
                <input type="date" min={DATE_MIN} max={DATE_MAX} value={plan.start} onChange={event => onEdit({ planOverride: { start: event.target.value, end: plan.end } })} />
              </FormField>
              <FormField label="NDIS plan ends" className={span.date}>
                <input type="date" min={DATE_MIN} max={DATE_MAX} value={plan.end} onChange={event => onEdit({ planOverride: { start: plan.start, end: event.target.value } })} />
              </FormField>
            </div>
            {details.planOverride && <div><Button variant="secondary" size="sm" onClick={() => onEdit({ planOverride: null })}>Use the recorded dates</Button></div>}
          </div>
        </details>
        <details className="group rounded-[var(--radius-md)] border border-[var(--color-border)]">
          <summary className="flex min-h-[var(--control-h)] cursor-pointer select-none items-center justify-between px-3 font-medium">More<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
          <div className="border-t border-[var(--color-border)] p-3">
            <div className={formGrid}>
              <FormField label="Price zone" className={span.medium} hint={`Where the supports are delivered. Remote and very remote add the NDIS loading.${details.mm !== undefined && zoneOfMm(details.mm) === details.zone ? " Set from the participant's remoteness (MM level)." : ''}`}>
                <select value={details.zone} onChange={event => onEdit({ zone: event.target.value as PlanPriceZone })}>{ZONES.map(zone => <option key={zone.value} value={zone.value}>{zone.label}</option>)}</select>
              </FormField>
            </div>
          </div>
        </details>
      </div>

      {outside && (
        <Callout tone="warning" className="max-w-prose" title="The agreement runs outside the NDIS plan">
          The plan runs {writtenDay(plan.start)} to {writtenDay(plan.end)}. The participant cannot be moved on from onboarding until the plan contains the agreement.
        </Callout>
      )}
    </div>
  )
}
