import type { ReactNode } from 'react'
import { Phone, PhoneCall, Pill, Siren, TriangleAlert } from 'lucide-react'
import { useProviderSettings } from '@/api/hooks'
import { ADMIN_STATUS_LABELS } from '@/api/types/medications'
import type { MedicationAdministrationStatus, PackagingType } from '@/api/types/enums'
import { EMERGENCY_PHONE, PACKAGING_CHECK_LABEL, POISONS_INFO_PHONE, healthAdviceLine, telHref } from '@/lib/missedMedicationGuidance'

export interface MissedMedicationGuidanceEvent {
  /** Refused/Withheld/Missed/WrongMedication — Administered never reaches this component in
   * practice (RecordAdministrationModal only renders it for a trigger outcome), but the guard
   * below is kept so the component is safe to call directly and to unit test on its own. */
  outcome: MedicationAdministrationStatus
  participantName: string
  medicationName: string
  pharmacyName?: string | null
  pharmacyPhone?: string | null
  packaging?: PackagingType
}

export interface MissedMedicationGuidanceProps {
  /** Event-specific guidance (shown inline with the INC-03 "report as incident?" prompt). Omit
   * for the generic reference version (the MAR tab's "what to do" info affordance) — same steps,
   * without a specific participant/medication/pharmacy attached. */
  event?: MissedMedicationGuidanceEvent
}

function GuidanceStep({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 mt-0.5" aria-hidden="true">{icon}</span>
      <div className="space-y-1 min-w-0">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  )
}

/** Tap-to-call link, sized for a touch target — text/wording is composed entirely by the caller
 * so the rendered sentence reads naturally (see the research doc's exact copy blocks). */
function PhoneLink({ phone, children }: { phone: string; children: ReactNode }) {
  return (
    <a
      href={telHref(phone)}
      className="inline-flex items-center gap-2 min-h-[44px] -mx-2 px-2 rounded-lg font-medium underline decoration-1 underline-offset-2 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
    >
      <PhoneCall className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </a>
  )
}

/**
 * MED-01: missed-medication guidance card. Copy is fixed to the MED-01 research spike's approved
 * blocks (2026-08-31) — manager first, then the health advice line, Poisons Information Centre,
 * packaging/pharmacy check, and 000 as the last resort. Deliberately contains no dosing advice of
 * any kind (no "give it now"/"skip it"/"double up" guidance, no interpretation of why a late dose
 * is/isn't safe) — every escalation routes through a qualified line, never an app-implied
 * clinical judgement or a suggestion to search the web.
 */
export function MissedMedicationGuidance({ event }: MissedMedicationGuidanceProps) {
  const { data: providerSettings } = useProviderSettings()

  // Defensive — Administered is never a trigger outcome, but guard here too so this component is
  // safe to render standalone (and testable) without relying on a caller to gate it first.
  if (event && event.outcome === 'Administered') return null

  const managerName = providerSettings?.managerName?.trim() || null
  const managerPhone = providerSettings?.managerPhone?.trim() || null
  const hasManagerContact = !!managerName && !!managerPhone
  const advice = healthAdviceLine(providerSettings?.state)
  const packagingLabel = PACKAGING_CHECK_LABEL[event?.packaging ?? 'OriginalPackaging']
  const pharmacyName = event?.pharmacyName?.trim() || null
  const pharmacyPhone = event?.pharmacyPhone?.trim() || null

  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-warning-container)] bg-[var(--color-warning-container)]/40 p-4 text-[var(--color-on-warning-container)]">
      <div className="flex items-start gap-2">
        <TriangleAlert className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="font-semibold text-sm">
          {event
            ? `What to do now — ${ADMIN_STATUS_LABELS[event.outcome]}: ${event.medicationName} for ${event.participantName}`
            : 'What to do if a medication is missed, refused, withheld, or given wrong'}
        </p>
      </div>

      <ol className="space-y-3 text-sm pl-1">
        <GuidanceStep icon={<Phone className="w-4 h-4" />} title="1. Contact your manager">
          {hasManagerContact ? (
            <PhoneLink phone={managerPhone!}>{managerName} — {managerPhone}</PhoneLink>
          ) : (
            <p>
              No manager contact is configured for this organisation — see your team leader.
              {' '}Admins: set this under Settings → Provider Settings → Manager Contact.
            </p>
          )}
        </GuidanceStep>

        <GuidanceStep icon={<Phone className="w-4 h-4" />} title="2. Need clinical advice about what to do next?">
          <PhoneLink phone={advice.primary.phone}>{advice.primary.label} — {advice.primary.phone}</PhoneLink>
          <p className="text-xs">Free, 24/7, speak to a registered nurse.</p>
          {advice.fallback && (
            <p className="text-xs">
              National fallback: <a href={telHref(advice.fallback.phone)} className="underline decoration-1 underline-offset-2">{advice.fallback.phone}</a>
            </p>
          )}
        </GuidanceStep>

        <GuidanceStep icon={<Pill className="w-4 h-4" />} title="3. Accidental extra dose, wrong dose, or suspected poisoning?">
          <PhoneLink phone={POISONS_INFO_PHONE}>Poisons Information Centre — {POISONS_INFO_PHONE}</PhoneLink>
          <p className="text-xs">Free, 24/7, available anywhere in Australia.</p>
        </GuidanceStep>

        <GuidanceStep icon={<Pill className="w-4 h-4" />} title={`4. ${packagingLabel}`}>
          <p>The pharmacy's name and phone number are usually printed on the label.</p>
          {pharmacyPhone && (
            <PhoneLink phone={pharmacyPhone}>Call the pharmacy on {pharmacyPhone}{pharmacyName ? ` (${pharmacyName})` : ''}</PhoneLink>
          )}
        </GuidanceStep>

        <GuidanceStep icon={<Siren className="w-4 h-4" />} title="5. Life-threatening emergency?">
          <PhoneLink phone={EMERGENCY_PHONE}>Call {EMERGENCY_PHONE} immediately</PhoneLink>
        </GuidanceStep>
      </ol>
    </div>
  )
}
