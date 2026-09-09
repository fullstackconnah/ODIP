import { useState } from 'react'
import { usePatchParticipant } from '@/api/hooks'
import { formatDateAu, maskNdisNumber, extractErrorMessage } from '@/lib/utils'
import { FormField } from '@/components/FormField'
import { SectionEditPanel } from './SectionEditPanel'
import { FUNDING_SOURCES } from '@/api/types/enums'
import { FUNDING_SOURCE_LABELS } from '@/api/types/participants'
import type { FundingSource } from '@/api/types/enums'
import type { ParticipantDetailDto } from '@/api/types/participants'

/**
 * PD-7: NDIS & Funding card — CORE-02's `ndisPlan` group. This section renders every field of
 * that group EXCEPT `planType` (not part of SPEC-03's PD-7 field list for this card, and not
 * displayed anywhere on the Details tab — it only shows in the page header's meta line, and is
 * otherwise wizard-only). `planType` is required/non-nullable on the group's DTO, so per the
 * "partial group coverage" rule, its CURRENT value is merged from `p.planType` into every save
 * from this section — never rendered, never edited here, never dropped/nulled.
 */
type NdisFundingDraft = {
  fundingSource: string; ndisNumber: string; planStartDate: string; planEndDate: string
  fundingOrganisation: string; isDsoa: boolean; isRepeatClient: boolean
}

function readNdisFunding(p: ParticipantDetailDto): NdisFundingDraft {
  return {
    fundingSource: p.fundingSource ?? 'Ndis', ndisNumber: p.ndisNumber ?? '',
    planStartDate: p.planStartDate ? p.planStartDate.split('T')[0] : '', planEndDate: p.planEndDate ? p.planEndDate.split('T')[0] : '',
    fundingOrganisation: p.fundingOrganisation ?? '', isDsoa: !!p.isDsoa, isRepeatClient: !!p.isRepeatClient,
  }
}

export function ParticipantNdisFundingSection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const saved = readNdisFunding(p)
  const [draft, setDraft] = useState<NdisFundingDraft>(saved)
  const isDirty = (Object.keys(saved) as (keyof NdisFundingDraft)[]).some((k) => draft[k] !== saved[k])

  async function handleSave() {
    const isNdis = draft.fundingSource !== 'Other'
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          ndisPlan: {
            // planType: unrendered by this section — merged unchanged from server state (see doc above).
            planType: p.planType,
            fundingSource: draft.fundingSource as FundingSource,
            ndisNumber: isNdis ? (draft.ndisNumber.trim() || null) : null,
            planStartDate: isNdis ? (draft.planStartDate || null) : null,
            planEndDate: isNdis ? (draft.planEndDate || null) : null,
            fundingOrganisation: !isNdis ? (draft.fundingOrganisation.trim() || null) : null,
            isDsoa: draft.isDsoa,
            isRepeatClient: draft.isRepeatClient,
          },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save NDIS & Funding.'))
    }
  }

  return (
    <SectionEditPanel title="NDIS & Funding" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className="space-y-4">
          <FormField label="Funding Source">
            <select value={draft.fundingSource} onChange={(e) => setDraft((d) => ({ ...d, fundingSource: e.target.value }))}>
              {FUNDING_SOURCES.map((s) => <option key={s} value={s}>{FUNDING_SOURCE_LABELS[s]}</option>)}
            </select>
          </FormField>
          {draft.fundingSource !== 'Other' && (
            <>
              <FormField label="NDIS Number">
                <input value={draft.ndisNumber} onChange={(e) => setDraft((d) => ({ ...d, ndisNumber: e.target.value }))} placeholder="e.g. 431234567" />
              </FormField>
              <FormField label="Plan Start Date">
                <input type="date" value={draft.planStartDate} onChange={(e) => setDraft((d) => ({ ...d, planStartDate: e.target.value }))} />
              </FormField>
              <FormField label="Plan End Date">
                <input type="date" value={draft.planEndDate} onChange={(e) => setDraft((d) => ({ ...d, planEndDate: e.target.value }))} />
              </FormField>
            </>
          )}
          {draft.fundingSource === 'Other' && (
            <FormField label="Funding Organisation">
              <input value={draft.fundingOrganisation} onChange={(e) => setDraft((d) => ({ ...d, fundingOrganisation: e.target.value }))} placeholder="e.g. Local Council" />
            </FormField>
          )}
          <FormField label="Disability Support for Older Australians (DSOA)" layout="checkbox">
            <input type="checkbox" checked={draft.isDsoa} onChange={(e) => setDraft((d) => ({ ...d, isDsoa: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          <FormField label="Repeat Client" layout="checkbox">
            <input type="checkbox" checked={draft.isRepeatClient} onChange={(e) => setDraft((d) => ({ ...d, isRepeatClient: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <span className="text-[var(--color-muted-foreground)]">Funding Source</span>
          <span>{FUNDING_SOURCE_LABELS[(p.fundingSource as FundingSource) ?? 'Ndis']}</span>
          {p.fundingSource !== 'Other' && (
            <>
              <span className="text-[var(--color-muted-foreground)]">NDIS Number</span><span className="font-mono">{p.ndisNumber ? maskNdisNumber(p.maskedNdisNumber || p.ndisNumber) : '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Plan Start Date</span><span>{formatDateAu(p.planStartDate)}</span>
              <span className="text-[var(--color-muted-foreground)]">Plan End Date</span><span>{formatDateAu(p.planEndDate)}</span>
            </>
          )}
          {p.fundingSource === 'Other' && (
            <>
              <span className="text-[var(--color-muted-foreground)]">Funding Organisation</span><span>{p.fundingOrganisation || '—'}</span>
            </>
          )}
          <span className="text-[var(--color-muted-foreground)]">DSOA</span><span>{p.isDsoa ? 'Yes' : 'No'}</span>
          <span className="text-[var(--color-muted-foreground)]">Repeat Client</span><span>{p.isRepeatClient ? 'Yes' : 'No'}</span>
        </div>
      )}
    </SectionEditPanel>
  )
}

export default ParticipantNdisFundingSection
