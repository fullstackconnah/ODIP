import { useState } from 'react'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { FactList } from '@/components/FactList'
import { formGrid, span } from '@/lib/formGrid'
import { SectionEditPanel } from './SectionEditPanel'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { extractErrorMessage } from '@/lib/utils'

/**
 * PD-7: Risks & Hazards Summary card — CORE-02's `risksHazardsSummary` group, fully rendered
 * (both fields, no merge needed). `RiskEntriesSection` (the free-form list rendered below this
 * card on the Details tab) is out of scope — it already has its own dedicated CRUD.
 */
type RisksHazardsSummaryDraft = { behaviourRiskSummary: string; notes: string }

function readRisksHazardsSummary(p: ParticipantDetailDto): RisksHazardsSummaryDraft {
  return { behaviourRiskSummary: p.behaviourRiskSummary ?? '', notes: p.notes ?? '' }
}

export function ParticipantRisksHazardsSummarySection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const saved = readRisksHazardsSummary(p)
  const [draft, setDraft] = useState<RisksHazardsSummaryDraft>(saved)
  const isDirty = draft.behaviourRiskSummary !== saved.behaviourRiskSummary || draft.notes !== saved.notes

  const hasAnyData = !!(p.behaviourRiskSummary || p.notes)
  if (!canEdit && !hasAnyData) return null

  async function handleSave() {
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          risksHazardsSummary: {
            behaviourRiskSummary: draft.behaviourRiskSummary.trim() || null,
            notes: draft.notes.trim() || null,
          },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Risks & Hazards Summary.'))
    }
  }

  return (
    <SectionEditPanel title="Risks & Hazards Summary" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className={formGrid}>
          <FormField label="Behaviour Risk Summary" className={span.long}>
            <textarea value={draft.behaviourRiskSummary} onChange={(e) => setDraft((d) => ({ ...d, behaviourRiskSummary: e.target.value }))} rows={3} />
          </FormField>
          <FormField label="General Notes" className={span.long}>
            <textarea value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={3} />
          </FormField>
        </div>
      ) : (
        <FactList
          items={[
            { label: 'Behaviour Risk Summary', value: p.behaviourRiskSummary },
            { label: 'General Notes', value: p.notes },
          ].filter((item) => item.value)}
        />
      )}
    </SectionEditPanel>
  )
}

export default ParticipantRisksHazardsSummarySection
