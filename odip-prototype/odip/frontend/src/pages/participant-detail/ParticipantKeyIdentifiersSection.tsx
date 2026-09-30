import { useState } from 'react'
import { usePatchParticipant } from '@/api/hooks'
import { formatDateAu, extractErrorMessage } from '@/lib/utils'
import { FormField } from '@/components/FormField'
import { FactList } from '@/components/FactList'
import { formGrid, span } from '@/lib/formGrid'
import { SectionEditPanel } from './SectionEditPanel'
import type { ParticipantDetailDto } from '@/api/types/participants'

/** PD-7: Key Identifiers card — CORE-02's `keyIdentifiers` group, fully rendered (all fields optional, no merge needed). */
type KeyIdentifiersDraft = {
  pensionCardNumber: string; pensionCardExpiry: string
  medicareNumber: string; medicareExpiry: string
  companionCardNumber: string; companionCardExpiry: string
  privateHealthFund: string; privateHealthMembershipNumber: string
  taxiCardNumber: string; hairColour: string; eyeColour: string
  weightKg: string; heightCm: string
}

function readKeyIdentifiers(p: ParticipantDetailDto): KeyIdentifiersDraft {
  return {
    pensionCardNumber: p.pensionCardNumber ?? '', pensionCardExpiry: p.pensionCardExpiry ? p.pensionCardExpiry.split('T')[0] : '',
    medicareNumber: p.medicareNumber ?? '', medicareExpiry: p.medicareExpiry ? p.medicareExpiry.split('T')[0] : '',
    companionCardNumber: p.companionCardNumber ?? '', companionCardExpiry: p.companionCardExpiry ? p.companionCardExpiry.split('T')[0] : '',
    privateHealthFund: p.privateHealthFund ?? '', privateHealthMembershipNumber: p.privateHealthMembershipNumber ?? '',
    taxiCardNumber: p.taxiCardNumber ?? '', hairColour: p.hairColour ?? '', eyeColour: p.eyeColour ?? '',
    weightKg: p.weightKg != null ? String(p.weightKg) : '', heightCm: p.heightCm != null ? String(p.heightCm) : '',
  }
}

export function ParticipantKeyIdentifiersSection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const saved = readKeyIdentifiers(p)
  const [draft, setDraft] = useState<KeyIdentifiersDraft>(saved)
  const isDirty = (Object.keys(saved) as (keyof KeyIdentifiersDraft)[]).some((k) => draft[k] !== saved[k])
  const hasAnyData = !!(p.pensionCardNumber || p.medicareNumber || p.companionCardNumber || p.privateHealthFund
    || p.taxiCardNumber || p.hairColour || p.eyeColour || p.weightKg || p.heightCm)

  if (!canEdit && !hasAnyData) return null

  async function handleSave() {
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          keyIdentifiers: {
            pensionCardNumber: draft.pensionCardNumber.trim() || null,
            pensionCardExpiry: draft.pensionCardExpiry || null,
            medicareNumber: draft.medicareNumber.trim() || null,
            medicareExpiry: draft.medicareExpiry || null,
            companionCardNumber: draft.companionCardNumber.trim() || null,
            companionCardExpiry: draft.companionCardExpiry || null,
            privateHealthFund: draft.privateHealthFund.trim() || null,
            privateHealthMembershipNumber: draft.privateHealthMembershipNumber.trim() || null,
            taxiCardNumber: draft.taxiCardNumber.trim() || null,
            hairColour: draft.hairColour.trim() || null,
            eyeColour: draft.eyeColour.trim() || null,
            weightKg: draft.weightKg.trim() ? Number(draft.weightKg) : null,
            heightCm: draft.heightCm.trim() ? Number(draft.heightCm) : null,
          },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Key Identifiers.'))
    }
  }

  return (
    <SectionEditPanel title="Key Identifiers" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className={formGrid}>
          <FormField label="Pension Card Number" className={span.medium}>
            <input value={draft.pensionCardNumber} onChange={(e) => setDraft((d) => ({ ...d, pensionCardNumber: e.target.value }))} />
          </FormField>
          <FormField label="Pension Card Expiry" className={span.date}>
            <input type="date" value={draft.pensionCardExpiry} onChange={(e) => setDraft((d) => ({ ...d, pensionCardExpiry: e.target.value }))} />
          </FormField>
          <FormField label="Medicare Number" className={span.medium}>
            <input value={draft.medicareNumber} onChange={(e) => setDraft((d) => ({ ...d, medicareNumber: e.target.value }))} />
          </FormField>
          <FormField label="Medicare Expiry" className={span.date}>
            <input type="date" value={draft.medicareExpiry} onChange={(e) => setDraft((d) => ({ ...d, medicareExpiry: e.target.value }))} />
          </FormField>
          <FormField label="Companion Card Number" className={span.medium}>
            <input value={draft.companionCardNumber} onChange={(e) => setDraft((d) => ({ ...d, companionCardNumber: e.target.value }))} />
          </FormField>
          <FormField label="Companion Card Expiry" className={span.date}>
            <input type="date" value={draft.companionCardExpiry} onChange={(e) => setDraft((d) => ({ ...d, companionCardExpiry: e.target.value }))} />
          </FormField>
          <FormField label="Private Health Fund" className={span.medium}>
            <input value={draft.privateHealthFund} onChange={(e) => setDraft((d) => ({ ...d, privateHealthFund: e.target.value }))} />
          </FormField>
          <FormField label="Private Health Membership Number" className={span.medium}>
            <input value={draft.privateHealthMembershipNumber} onChange={(e) => setDraft((d) => ({ ...d, privateHealthMembershipNumber: e.target.value }))} />
          </FormField>
          <FormField label="Taxi Card Number" className={span.medium}>
            <input value={draft.taxiCardNumber} onChange={(e) => setDraft((d) => ({ ...d, taxiCardNumber: e.target.value }))} />
          </FormField>
          <FormField label="Hair Colour" className={span.short}>
            <input value={draft.hairColour} onChange={(e) => setDraft((d) => ({ ...d, hairColour: e.target.value }))} />
          </FormField>
          <FormField label="Eye Colour" className={span.short}>
            <input value={draft.eyeColour} onChange={(e) => setDraft((d) => ({ ...d, eyeColour: e.target.value }))} />
          </FormField>
          <FormField label="Weight (kg)" className={span.short}>
            <input type="number" min="0" max="999.99" step="0.1" value={draft.weightKg} onChange={(e) => setDraft((d) => ({ ...d, weightKg: e.target.value }))} />
          </FormField>
          <FormField label="Height (cm)" className={span.short}>
            <input type="number" min="0" max="999.99" step="0.1" value={draft.heightCm} onChange={(e) => setDraft((d) => ({ ...d, heightCm: e.target.value }))} />
          </FormField>
        </div>
      ) : (
        <FactList
          items={[
            { label: 'Pension Card', value: p.pensionCardNumber ? `${p.pensionCardNumber}${p.pensionCardExpiry ? ` (expires ${formatDateAu(p.pensionCardExpiry)})` : ''}` : undefined },
            { label: 'Medicare', value: p.medicareNumber ? `${p.medicareNumber}${p.medicareExpiry ? ` (expires ${formatDateAu(p.medicareExpiry)})` : ''}` : undefined },
            { label: 'Companion Card', value: p.companionCardNumber ? `${p.companionCardNumber}${p.companionCardExpiry ? ` (expires ${formatDateAu(p.companionCardExpiry)})` : ''}` : undefined },
            { label: 'Private Health Fund', value: p.privateHealthFund ? `${p.privateHealthFund}${p.privateHealthMembershipNumber ? ` (${p.privateHealthMembershipNumber})` : ''}` : undefined },
            { label: 'Taxi Card', value: p.taxiCardNumber },
            { label: 'Hair / Eye Colour', value: [p.hairColour, p.eyeColour].filter(Boolean).join(' / ') },
            { label: 'Weight / Height', value: [p.weightKg != null ? `${p.weightKg} kg` : null, p.heightCm != null ? `${p.heightCm} cm` : null].filter(Boolean).join(' / ') },
          ].filter((item) => item.value)}
        />
      )}
    </SectionEditPanel>
  )
}

export default ParticipantKeyIdentifiersSection
