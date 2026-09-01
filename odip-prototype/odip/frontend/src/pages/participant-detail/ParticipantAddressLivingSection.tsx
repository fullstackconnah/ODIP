import { useState } from 'react'
import type { AxiosError } from 'axios'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { SectionEditPanel } from './SectionEditPanel'
import { AU_STATES, LIVING_ARRANGEMENTS } from '@/api/types/enums'
import { LIVING_ARRANGEMENT_LABELS } from '@/api/types/participants'
import type { LivingArrangement } from '@/api/types/enums'
import type { ParticipantDetailDto } from '@/api/types/participants'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

/**
 * PD-7: Address & Living Arrangements card — covers TWO CORE-02 groups in one section, saved
 * together in a single PATCH: `address` (addressStreet/Suburb/State/Postcode) and
 * `livingArrangement` (livingArrangement + its 8 per-type conditional fields + notes). Both
 * groups are fully rendered by this section's edit form across every livingArrangement branch,
 * so no snapshot merge is needed for either group. `country` is NOT part of either group here —
 * it lives in `personalDetails` and is edited from the Identity section (see that file's doc) —
 * this card's read-only composite address line still displays it for continuity, unaffected.
 */
type AddressLivingDraft = {
  addressStreet: string; addressSuburb: string; addressState: string; addressPostcode: string
  livingArrangement: string
  mainSupportPersonName: string; mainSupportPersonRelationship: string
  othersLivingInAccommodation: string; residentialInfo: string
  livesWithOthers: boolean; whoLivesWith: string
  silProviderName: string; silProviderContactPhone: string; accommodationType: string; onSiteSupportHours: string
  livingArrangementNotes: string
}

function readAddressLiving(p: ParticipantDetailDto): AddressLivingDraft {
  return {
    addressStreet: p.addressStreet ?? '', addressSuburb: p.addressSuburb ?? '', addressState: p.addressState ?? '', addressPostcode: p.addressPostcode ?? '',
    livingArrangement: p.livingArrangement ?? '',
    mainSupportPersonName: p.mainSupportPersonName ?? '', mainSupportPersonRelationship: p.mainSupportPersonRelationship ?? '',
    othersLivingInAccommodation: p.othersLivingInAccommodation ?? '', residentialInfo: p.residentialInfo ?? '',
    livesWithOthers: !!p.livesWithOthers, whoLivesWith: p.whoLivesWith ?? '',
    silProviderName: p.silProviderName ?? '', silProviderContactPhone: p.silProviderContactPhone ?? '',
    accommodationType: p.accommodationType ?? '', onSiteSupportHours: p.onSiteSupportHours ?? '',
    livingArrangementNotes: p.livingArrangementNotes ?? '',
  }
}

export function ParticipantAddressLivingSection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const saved = readAddressLiving(p)
  const [draft, setDraft] = useState<AddressLivingDraft>(saved)
  const isDirty = (Object.keys(saved) as (keyof AddressLivingDraft)[]).some((k) => draft[k] !== saved[k])

  async function handleSave() {
    const type = draft.livingArrangement
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          address: {
            addressStreet: draft.addressStreet.trim() || null,
            addressSuburb: draft.addressSuburb.trim() || null,
            addressState: draft.addressState || null,
            addressPostcode: draft.addressPostcode.trim() || null,
          },
          livingArrangement: {
            livingArrangement: (type || null) as LivingArrangement | null,
            mainSupportPersonName: type === 'Family' ? (draft.mainSupportPersonName.trim() || null) : null,
            mainSupportPersonRelationship: type === 'Family' ? (draft.mainSupportPersonRelationship.trim() || null) : null,
            othersLivingInAccommodation: type === 'Family' ? (draft.othersLivingInAccommodation.trim() || null) : null,
            residentialInfo: type === 'Family' ? (draft.residentialInfo.trim() || null) : null,
            livesWithOthers: type === 'Independent' ? draft.livesWithOthers : null,
            whoLivesWith: type === 'Independent' && draft.livesWithOthers ? (draft.whoLivesWith.trim() || null) : null,
            silProviderName: type === 'SupportedAccommodation' ? (draft.silProviderName.trim() || null) : null,
            silProviderContactPhone: type === 'SupportedAccommodation' ? (draft.silProviderContactPhone.trim() || null) : null,
            accommodationType: type === 'SupportedAccommodation' ? (draft.accommodationType.trim() || null) : null,
            onSiteSupportHours: type === 'SupportedAccommodation' ? (draft.onSiteSupportHours.trim() || null) : null,
            livingArrangementNotes: draft.livingArrangementNotes.trim() || null,
          },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Address & Living Arrangements.'))
    }
  }

  return (
    <SectionEditPanel title="Address & Living Arrangements" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <FormField label="Street">
              <input value={draft.addressStreet} onChange={(e) => setDraft((d) => ({ ...d, addressStreet: e.target.value }))} />
            </FormField>
            <FormField label="Suburb">
              <input value={draft.addressSuburb} onChange={(e) => setDraft((d) => ({ ...d, addressSuburb: e.target.value }))} />
            </FormField>
            <FormField label="State">
              <select value={draft.addressState} onChange={(e) => setDraft((d) => ({ ...d, addressState: e.target.value }))}>
                <option value="">Not specified</option>
                {AU_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </FormField>
            <FormField label="Postcode">
              <input value={draft.addressPostcode} onChange={(e) => setDraft((d) => ({ ...d, addressPostcode: e.target.value }))} inputMode="numeric" maxLength={4} />
            </FormField>
          </div>
          <FormField label="Living Arrangement">
            <select value={draft.livingArrangement} onChange={(e) => setDraft((d) => ({ ...d, livingArrangement: e.target.value }))}>
              <option value="">Not specified</option>
              {LIVING_ARRANGEMENTS.map((a) => <option key={a} value={a}>{LIVING_ARRANGEMENT_LABELS[a]}</option>)}
            </select>
          </FormField>
          {draft.livingArrangement === 'Family' && (
            <div className="space-y-4">
              <FormField label="Main Support Person">
                <input value={draft.mainSupportPersonName} onChange={(e) => setDraft((d) => ({ ...d, mainSupportPersonName: e.target.value }))} placeholder="e.g. Jane Citizen" />
              </FormField>
              <FormField label="Relationship to Participant">
                <input value={draft.mainSupportPersonRelationship} onChange={(e) => setDraft((d) => ({ ...d, mainSupportPersonRelationship: e.target.value }))} placeholder="e.g. Mother" />
              </FormField>
              <FormField label="Others Living in the Accommodation">
                <textarea value={draft.othersLivingInAccommodation} onChange={(e) => setDraft((d) => ({ ...d, othersLivingInAccommodation: e.target.value }))} rows={2} />
              </FormField>
              <FormField label="Residential Information">
                <textarea value={draft.residentialInfo} onChange={(e) => setDraft((d) => ({ ...d, residentialInfo: e.target.value }))} rows={2} />
              </FormField>
            </div>
          )}
          {draft.livingArrangement === 'Independent' && (
            <div className="space-y-4">
              <FormField label="Lives With Others" layout="checkbox">
                <input type="checkbox" checked={draft.livesWithOthers} onChange={(e) => setDraft((d) => ({ ...d, livesWithOthers: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
              {draft.livesWithOthers && (
                <FormField label="Who They Live With">
                  <input value={draft.whoLivesWith} onChange={(e) => setDraft((d) => ({ ...d, whoLivesWith: e.target.value }))} placeholder="e.g. Housemates" />
                </FormField>
              )}
            </div>
          )}
          {draft.livingArrangement === 'SupportedAccommodation' && (
            <div className="space-y-4">
              <FormField label="SIL Provider Name">
                <input value={draft.silProviderName} onChange={(e) => setDraft((d) => ({ ...d, silProviderName: e.target.value }))} />
              </FormField>
              <FormField label="SIL Provider Contact (Phone)">
                <input value={draft.silProviderContactPhone} onChange={(e) => setDraft((d) => ({ ...d, silProviderContactPhone: e.target.value }))} />
              </FormField>
              <FormField label="Accommodation Type">
                <input value={draft.accommodationType} onChange={(e) => setDraft((d) => ({ ...d, accommodationType: e.target.value }))} />
              </FormField>
              <FormField label="On-Site Support Hours">
                <input value={draft.onSiteSupportHours} onChange={(e) => setDraft((d) => ({ ...d, onSiteSupportHours: e.target.value }))} />
              </FormField>
            </div>
          )}
          {draft.livingArrangement && (
            <FormField label="Living Arrangement Notes">
              <textarea value={draft.livingArrangementNotes} onChange={(e) => setDraft((d) => ({ ...d, livingArrangementNotes: e.target.value }))} rows={2} />
            </FormField>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <span className="text-[var(--color-muted-foreground)]">Address</span>
          <span>{[p.addressStreet, p.addressSuburb, p.addressState, p.addressPostcode, p.country].filter(Boolean).join(', ') || '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Living Arrangement</span>
          <span>{p.livingArrangement ? LIVING_ARRANGEMENT_LABELS[p.livingArrangement as LivingArrangement] : '—'}</span>
          {p.livingArrangement === 'Family' && (
            <>
              <span className="text-[var(--color-muted-foreground)]">Main Support Person</span>
              <span>{p.mainSupportPersonName || '—'}{p.mainSupportPersonRelationship ? ` (${p.mainSupportPersonRelationship})` : ''}</span>
              <span className="text-[var(--color-muted-foreground)]">Others Living in the Accommodation</span>
              <span>{p.othersLivingInAccommodation || '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Residential Information</span>
              <span>{p.residentialInfo || '—'}</span>
            </>
          )}
          {p.livingArrangement === 'Independent' && (
            <>
              <span className="text-[var(--color-muted-foreground)]">Lives With Others</span>
              <span>{p.livesWithOthers ? 'Yes' : 'No'}</span>
              {p.livesWithOthers && (
                <>
                  <span className="text-[var(--color-muted-foreground)]">Who They Live With</span>
                  <span>{p.whoLivesWith || '—'}</span>
                </>
              )}
            </>
          )}
          {p.livingArrangement === 'SupportedAccommodation' && (
            <>
              <span className="text-[var(--color-muted-foreground)]">SIL Provider</span>
              <span>{p.silProviderName || '—'}{p.silProviderContactPhone ? ` (${p.silProviderContactPhone})` : ''}</span>
              <span className="text-[var(--color-muted-foreground)]">Accommodation Type</span>
              <span>{p.accommodationType || '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">On-Site Support Hours</span>
              <span>{p.onSiteSupportHours || '—'}</span>
            </>
          )}
          {p.livingArrangement && p.livingArrangementNotes && (
            <>
              <span className="text-[var(--color-muted-foreground)]">Living Arrangement Notes</span>
              <span>{p.livingArrangementNotes}</span>
            </>
          )}
        </div>
      )}
    </SectionEditPanel>
  )
}

export default ParticipantAddressLivingSection
