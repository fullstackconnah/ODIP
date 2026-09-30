import { useState } from 'react'
import { usePatchParticipant, useStaff } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { FactList } from '@/components/FactList'
import { SearchableSelect } from '@/components/SearchableSelect'
import { formGrid, span } from '@/lib/formGrid'
import { SectionEditPanel } from './SectionEditPanel'
import { GENDERS } from '@/api/types/enums'
import { GENDER_LABELS } from '@/api/types/participants'
import type { Gender } from '@/api/types/enums'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { extractErrorMessage } from '@/lib/utils'

/**
 * PD-7: Identity card — CORE-02's `personalDetails` group (firstName, lastName, preferredName,
 * middleName, dateOfBirth, gender, genderSelfDescription, placeOfBirth, country, phone, email)
 * PLUS the isolated `preferredStaff` group (preferredStaffId). Both are sent together on save.
 *
 * `country` is NOT in SPEC-03's PD-7 field-list for this card (it lists Address as the field
 * that would seem to own it) — but CORE-02's actual `PatchPersonalDetailsDto` puts `country` in
 * `personalDetails`, not in the Address & Living Arrangements card's `address` group. Rather than
 * leave country permanently non-editable (no section would own it) or silently pass it through
 * unedited via a snapshot merge (which SectionEditPanel's per-section model discourages when a
 * field CAN be given a real home), Country is added here as a genuine editable field alongside
 * Place of Birth — this keeps `personalDetails`'s 11 fields fully covered by this section with no
 * merge needed. The Address card's existing read-only composite address line (unaffected) still
 * includes country for display continuity.
 */
type IdentityDraft = {
  firstName: string; lastName: string; preferredName: string; middleName: string
  dateOfBirth: string; gender: string; genderSelfDescription: string
  placeOfBirth: string; country: string; phone: string; email: string
  preferredStaffId: string
}

function readIdentity(p: ParticipantDetailDto): IdentityDraft {
  return {
    firstName: p.firstName ?? '', lastName: p.lastName ?? '', preferredName: p.preferredName ?? '',
    middleName: p.middleName ?? '', dateOfBirth: p.dateOfBirth ? p.dateOfBirth.split('T')[0] : '',
    gender: p.gender ?? '', genderSelfDescription: p.genderSelfDescription ?? '',
    placeOfBirth: p.placeOfBirth ?? '', country: p.country ?? '', phone: p.phone ?? '', email: p.email ?? '',
    preferredStaffId: p.preferredStaffId ?? '',
  }
}

export function ParticipantIdentitySection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const { data: staffList = [] } = useStaff()
  const activeStaff = staffList.filter((s) => s.isActive)
  const saved = readIdentity(p)
  const [draft, setDraft] = useState<IdentityDraft>(saved)
  const isDirty = (Object.keys(saved) as (keyof IdentityDraft)[]).some((k) => draft[k] !== saved[k])

  async function handleSave() {
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          personalDetails: {
            firstName: draft.firstName.trim(),
            lastName: draft.lastName.trim(),
            preferredName: draft.preferredName.trim() || null,
            middleName: draft.middleName.trim() || null,
            dateOfBirth: draft.dateOfBirth || null,
            gender: (draft.gender || null) as Gender | null,
            genderSelfDescription: draft.gender === 'Other' ? (draft.genderSelfDescription.trim() || null) : null,
            placeOfBirth: draft.placeOfBirth.trim() || null,
            country: draft.country.trim() || null,
            phone: draft.phone.trim() || null,
            email: draft.email.trim() || null,
          },
          preferredStaff: { preferredStaffId: draft.preferredStaffId || null },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Identity.'))
    }
  }

  return (
    <SectionEditPanel title="Identity" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className="space-y-4">
          <div className={formGrid}>
            <FormField label="First Name" required className={span.medium}>
              <input value={draft.firstName} onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))} />
            </FormField>
            <FormField label="Last Name" required className={span.medium}>
              <input value={draft.lastName} onChange={(e) => setDraft((d) => ({ ...d, lastName: e.target.value }))} />
            </FormField>
            <FormField label="Preferred Name" className={span.medium}>
              <input value={draft.preferredName} onChange={(e) => setDraft((d) => ({ ...d, preferredName: e.target.value }))} />
            </FormField>
            <FormField label="Middle Name" className={span.medium}>
              <input value={draft.middleName} onChange={(e) => setDraft((d) => ({ ...d, middleName: e.target.value }))} />
            </FormField>
            <FormField label="Date of Birth" className={span.short}>
              <input type="date" value={draft.dateOfBirth} onChange={(e) => setDraft((d) => ({ ...d, dateOfBirth: e.target.value }))} />
            </FormField>
            <FormField label="Gender" className={span.short}>
              <select value={draft.gender} onChange={(e) => setDraft((d) => ({ ...d, gender: e.target.value }))}>
                <option value="">Not specified</option>
                {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
              </select>
            </FormField>
            {draft.gender === 'Other' && (
              <FormField label="Gender Self-Description" required className={span.medium}>
                <input value={draft.genderSelfDescription} onChange={(e) => setDraft((d) => ({ ...d, genderSelfDescription: e.target.value }))} placeholder="How the participant describes their gender" />
              </FormField>
            )}
            <FormField label="Place of Birth" className={span.medium}>
              <input value={draft.placeOfBirth} onChange={(e) => setDraft((d) => ({ ...d, placeOfBirth: e.target.value }))} placeholder="e.g. Brisbane, QLD" />
            </FormField>
            <FormField label="Country" className={span.medium}>
              <input value={draft.country} onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))} placeholder="e.g. Australia" />
            </FormField>
            <FormField label="Phone" className={span.medium}>
              <input type="tel" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} placeholder="e.g. 0400 000 000" />
            </FormField>
            <FormField label="Email" className={span.medium}>
              <input type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="e.g. name@example.com" />
            </FormField>
          </div>
          <FormField label="Preferred Staff Member">
            <SearchableSelect
              value={draft.preferredStaffId}
              onChange={(v) => setDraft((d) => ({ ...d, preferredStaffId: v }))}
              items={[{ value: '', label: 'None' }, ...activeStaff.map((s) => ({ value: s.id, label: s.fullName }))]}
            />
          </FormField>
        </div>
      ) : (
        <FactList
          items={[
            { label: 'First Name', value: p.firstName },
            { label: 'Last Name', value: p.lastName },
            { label: 'Preferred Name', value: p.preferredName },
            { label: 'Middle Name', value: p.middleName },
            { label: 'Date of Birth', value: p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString('en-AU') : undefined },
            {
              label: 'Gender',
              value: p.gender
                ? GENDER_LABELS[p.gender as Gender] + (p.gender === 'Other' && p.genderSelfDescription ? ` (${p.genderSelfDescription})` : '')
                : undefined,
            },
            { label: 'Place of Birth', value: p.placeOfBirth },
            { label: 'Country', value: p.country },
            { label: 'Phone', value: p.phone },
            { label: 'Email', value: p.email },
            { label: 'Preferred Staff', value: p.preferredStaffName },
          ]}
        />
      )}
    </SectionEditPanel>
  )
}

export default ParticipantIdentitySection
