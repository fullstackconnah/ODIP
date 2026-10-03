import { Callout } from '@/components/Callout'
import { CheckboxField } from '@/components/CheckboxField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { formGrid, span } from '@/lib/formGrid'
import { SUPPORT_LABEL, transportFamily } from '@/lib/planBlocks'
import type { PlanAccommodation, PlanActivityTransport, PlanBlock, PlanProviderTravel, PlanVehicle } from '@/api/types'
import { FormField } from '@/components/FormField'
import { NumberField } from './NumberField'
import { fieldError, type StepProps } from './stepTypes'

const VEHICLE_OPTIONS: { key: PlanVehicle; label: string }[] = [
  { key: 'Standard', label: 'Standard vehicle' },
  { key: 'Accessible', label: 'Accessible vehicle or bus' },
]

const DEFAULT_TRAVEL: PlanProviderTravel = { claim: true, minutesEachWay: 15, returnToBase: false, kmEachWay: 0 }
const DEFAULT_TRANSPORT: PlanActivityTransport = { km: 10, vehicle: 'Standard', tolls: 0, parking: 0 }
const DEFAULT_ACCOMMODATION: PlanAccommodation = { nights: 1, workerOnSite: false }

/** The sharing a person typed is only kept when it is not "everyone present": left alone, a trip or a vehicle is shared by whoever is there, and follows the count when it changes. */
function sharingOf(value: number, present: number): number | undefined {
  return Number.isNaN(value) || value === present ? undefined : value
}

/**
 * Travel and transport: the worker's travel to the participant (claimed on the support item, with the minutes capped by the delivery zone and the kilometres at the provider's
 * rate), the vehicle costs of taking participants on the activity (kilometres, tolls and parking at cost, shared by whoever is in the vehicle), and, for short-term
 * accommodation, the nights. Each is off until it is switched on, and a family that has no such item says so instead of offering it.
 */
export function TravelStep({ entry, onChange, problems, settings }: StepProps) {
  const { block } = entry
  const patch = (changes: Partial<PlanBlock>) => onChange({ ...entry, block: { ...block, ...changes } })
  const travel = block.travel
  const transport = block.transport
  const accommodation = block.accommodation
  const travelAllowed = settings ? settings.claimProviderTravel : true
  const patchTravel = (changes: Partial<PlanProviderTravel>) => patch({ travel: { ...(travel ?? DEFAULT_TRAVEL), ...changes } })
  const patchTransport = (changes: Partial<PlanActivityTransport>) => patch({ transport: { ...(transport ?? DEFAULT_TRANSPORT), ...changes } })

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {settings?.travelRatesProvisional && (
        <Callout tone="info" className="max-w-prose">Per-kilometre rates and travel time caps are 2025-26 values until NDIA publishes 2026-27, so the lines that use them are marked Provisional.</Callout>
      )}

      <section className="flex flex-col gap-[var(--field-gap-y)]" aria-labelledby="plan-travel-heading">
        <h4 id="plan-travel-heading" className="text-sm font-semibold">Provider travel</h4>
        <p className="text-[13px] text-[var(--color-muted-foreground)]">The worker&apos;s own travel to the participant, claimed on the support item. The minutes are capped by the delivery zone.</p>
        {!travelAllowed ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Your organisation has turned provider travel off in Settings, so none is priced.</p>
        ) : (
          <>
            <CheckboxField label="Claim provider travel" checked={travel?.claim === true} onChange={event => patch({ travel: event.target.checked ? { ...(travel ?? DEFAULT_TRAVEL), claim: true } : undefined })} />
            {travel?.claim && (
              <div className={formGrid}>
                <NumberField label="Minutes each way" className={span.short} value={travel.minutesEachWay} min={0} max={480} error={fieldError(problems, 'travelMinutes')} onChange={value => patchTravel({ minutesEachWay: value })} />
                <NumberField label="Kilometres each way" className={span.short} value={travel.kmEachWay} min={0} max={2000} step={0.1} inputMode="decimal" error={fieldError(problems, 'travelKm')} onChange={value => patchTravel({ kmEachWay: value })} />
                <NumberField label="Participants sharing the trip" className={span.short} value={travel.participantsSharing ?? block.participantsPresent} min={1} max={block.participantsPresent} hint="Everyone present, unless the trip is shared by fewer." error={fieldError(problems, 'travelSharing')} onChange={value => patchTravel({ participantsSharing: sharingOf(value, block.participantsPresent) })} />
                <CheckboxField label="Also claim the trip back to base" className={span.short} checked={travel.returnToBase} onChange={event => patchTravel({ returnToBase: event.target.checked })} />
              </div>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-labelledby="plan-transport-heading">
        <h4 id="plan-transport-heading" className="text-sm font-semibold">Activity-based transport</h4>
        {!transportFamily(block.supportType) ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Transport goes with community access and group activities. {SUPPORT_LABEL[block.supportType]} has no transport item.</p>
        ) : (
          <>
            <p className="text-[13px] text-[var(--color-muted-foreground)]">The vehicle costs of taking participants on the activity. The worker&apos;s time in the vehicle stays on the support item.</p>
            <CheckboxField label="Add activity-based transport" checked={transport !== undefined} onChange={event => patch({ transport: event.target.checked ? { ...DEFAULT_TRANSPORT } : undefined })} />
            {transport && (
              <div className={formGrid}>
                <NumberField label="Kilometres" className={span.short} value={transport.km} min={0} max={2000} step={0.1} inputMode="decimal" error={fieldError(problems, 'transportKm')} onChange={value => patchTransport({ km: value })} />
                <NumberField label="Tolls ($, at cost)" className={span.short} value={transport.tolls} min={0} max={10000} step={0.01} inputMode="decimal" error={fieldError(problems, 'tolls')} onChange={value => patchTransport({ tolls: value })} />
                <NumberField label="Parking ($, at cost)" className={span.short} value={transport.parking} min={0} max={10000} step={0.01} inputMode="decimal" error={fieldError(problems, 'parking')} onChange={value => patchTransport({ parking: value })} />
                <NumberField label="Participants sharing the vehicle" className={span.short} value={transport.participantsSharing ?? block.participantsPresent} min={1} max={block.participantsPresent} hint="Everyone present, unless the vehicle is shared by fewer." error={fieldError(problems, 'transportSharing')} onChange={value => patchTransport({ participantsSharing: sharingOf(value, block.participantsPresent) })} />
                <FormField label="Vehicle" className={span.medium}>
                  <ToggleGroup className="flex-wrap" ariaLabel="Vehicle" options={VEHICLE_OPTIONS} value={transport.vehicle} onChange={value => patchTransport({ vehicle: value as PlanVehicle })} />
                </FormField>
              </div>
            )}
          </>
        )}
      </section>

      {block.supportType === 'StaSupport' && (
        <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-labelledby="plan-accommodation-heading">
          <h4 id="plan-accommodation-heading" className="text-sm font-semibold">Accommodation nights</h4>
          <p className="text-[13px] text-[var(--color-muted-foreground)]">The nights of short-term accommodation each shift of this block includes. Legacy per-day items are not offered: they end on 30 June 2027.</p>
          <div className={formGrid}>
            <NumberField label="Nights each shift" className={span.short} value={accommodation?.nights ?? 0} min={0} max={14} error={fieldError(problems, 'nights')} onChange={value => patch({ accommodation: { ...(accommodation ?? DEFAULT_ACCOMMODATION), nights: value } })} />
            <CheckboxField label="A support worker must stay on site" className={span.medium} checked={accommodation?.workerOnSite === true} onChange={event => patch({ accommodation: { ...(accommodation ?? DEFAULT_ACCOMMODATION), workerOnSite: event.target.checked } })} />
          </div>
        </section>
      )}
    </div>
  )
}
