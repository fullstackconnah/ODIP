import { useState } from 'react'
import type { AxiosError } from 'axios'
import { usePatchParticipant, useStaff } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { SearchableSelect } from '@/components/SearchableSelect'
import { SectionEditPanel } from './SectionEditPanel'
import { GENDERS } from '@/api/types/enums'
import { GENDER_LABELS } from '@/api/types/participants'
import type { Gender } from '@/api/types/enums'
import type { ParticipantDetailDto } from '@/api/types/participants'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

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
          <div className="grid md:grid-cols-2 gap-4">
            <FormField label="First Name" required>
              <input value={draft.firstName} onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))} />
            </FormField>
            <FormField label="Last Name" required>
              <input value={draft.lastName} onChange={(e) => setDraft((d) => ({ ...d, lastName: e.target.value }))} />
            </FormField>
            <FormField label="Preferred Name">
              <input value={draft.preferredName} onChange={(e) => setDraft((d) => ({ ...d, preferredName: e.target.value }))} />
            </FormField>
            <FormField label="Middle Name">
              <input value={draft.middleName} onChange={(e) => setDraft((d) => ({ ...d, middleName: e.target.value }))} />
            </FormField>
            <FormField label="Date of Birth">
              <input type="date" value={draft.dateOfBirth} onChange={(e) => setDraft((d) => ({ ...d, dateOfBirth: e.target.value }))} />
            </FormField>
            <FormField label="Gender">
              <select value={draft.gender} onChange={(e) => setDraft((d) => ({ ...d, gender: e.target.value }))}>
                <option value="">Not specified</option>
                {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
              </select>
            </FormField>
            {draft.gender === 'Other' && (
              <FormField label="Gender Self-Description" required>
                <input value={draft.genderSelfDescription} onChange={(e) => setDraft((d) => ({ ...d, genderSelfDescription: e.target.value }))} placeholder="How the participant describes their gender" />
              </FormField>
            )}
            <FormField label="Place of Birth">
              <input value={draft.placeOfBirth} onChange={(e) => setDraft((d) => ({ ...d, placeOfBirth: e.target.value }))} placeholder="e.g. Brisbane, QLD" />
            </FormField>
            <FormField label="Country">
              <input value={draft.country} onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))} placeholder="e.g. Australia" />
            </FormField>
            <FormField label="Phone">
              <input type="tel" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} placeholder="e.g. 0400 000 000" />
            </FormField>
            <FormField label="Email">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <span className="text-[var(--color-muted-foreground)]">First Name</span><span>{p.firstName || '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Last Name</span><span>{p.lastName || '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Preferred Name</span><span>{p.preferredName || '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Middle Name</span><span>{p.middleName || '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Date of Birth</span><span>{p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString('en-AU') : '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Gender</span>
          <span>
            {p.gender
              ? GENDER_LABELS[p.gender as Gender] + (p.gender === 'Other' && p.genderSelfDescription ? ` (${p.genderSelfDescription})` : '')
              : '—'}
          </span>
          <span className="text-[var(--color-muted-foreground)]">Place of Birth</span><span>{p.placeOfBirth || '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Country</span><span>{p.country || '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Phone</span><span>{p.phone || '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Email</span><span>{p.email || '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Preferred Staff</span><span>{p.preferredStaffName ?? '—'}</span>
        </div>
      )}
    </SectionEditPanel>
  )
}

export default ParticipantIdentitySection
