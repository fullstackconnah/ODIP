import { useState } from 'react'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { FactList } from '@/components/FactList'
import { ToggleGroup } from '@/components/ToggleGroup'
import { formGrid, span } from '@/lib/formGrid'
import { SectionEditPanel } from './SectionEditPanel'
import { MEMORY_LEVELS, RISK_RATING_LEVELS } from '@/api/types/enums'
import { MEMORY_LEVEL_LABELS, RISK_RATING_LEVEL_LABELS } from '@/api/types/participants'
import type { MemoryLevel, RiskRatingLevel } from '@/api/types/enums'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { extractErrorMessage } from '@/lib/utils'

const YES_NO_UNANSWERED_OPTIONS = [
  { key: 'true', label: 'Yes' },
  { key: 'false', label: 'No' },
  { key: '', label: 'Not recorded' },
]
function triToKey(v: boolean | null | undefined): string {
  return v === true ? 'true' : v === false ? 'false' : ''
}
function keyToTri(k: string): boolean | null {
  return k === 'true' ? true : k === 'false' ? false : null
}
function yesNoUnset(value: boolean | null | undefined): string {
  return value === true ? 'Yes' : value === false ? 'No' : '—'
}

const NOT_RECORDED = ''

const pl = (v?: string | null) => (v ? <span className="whitespace-pre-line">{v}</span> : undefined)

/** PD-7: Behaviour & Communication card — CORE-02's `behaviourCommunication` group, fully rendered (all 14 fields optional, no merge needed). */
type BehaviourCommunicationDraft = {
  memory: string; memoryAids: string; impairedUnderstanding: string; impairedJudgementReasoning: string
  behavioursOfConcernCurrent: string; behavioursOfConcernFiveYearHistory: string; behaviourRiskRating: string
  ridsLogged: string; bspPlanProvided: string; bocChartProvided: string
  expressiveSkills: string; receptiveSkills: string; readingAbility: string; communicationAids: string
}

function readBehaviourCommunication(p: ParticipantDetailDto): BehaviourCommunicationDraft {
  return {
    memory: p.memory ?? NOT_RECORDED, memoryAids: triToKey(p.memoryAids), impairedUnderstanding: triToKey(p.impairedUnderstanding),
    impairedJudgementReasoning: triToKey(p.impairedJudgementReasoning),
    behavioursOfConcernCurrent: triToKey(p.behavioursOfConcernCurrent), behavioursOfConcernFiveYearHistory: triToKey(p.behavioursOfConcernFiveYearHistory),
    behaviourRiskRating: p.behaviourRiskRating ?? NOT_RECORDED,
    ridsLogged: triToKey(p.ridsLogged), bspPlanProvided: triToKey(p.bspPlanProvided), bocChartProvided: triToKey(p.bocChartProvided),
    expressiveSkills: p.expressiveSkills ?? '', receptiveSkills: p.receptiveSkills ?? '', readingAbility: p.readingAbility ?? '', communicationAids: p.communicationAids ?? '',
  }
}

export function ParticipantBehaviourCommunicationSection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const saved = readBehaviourCommunication(p)
  const [draft, setDraft] = useState<BehaviourCommunicationDraft>(saved)
  const isDirty = (Object.keys(saved) as (keyof BehaviourCommunicationDraft)[]).some((k) => draft[k] !== saved[k])

  const hasAnyData = p.memory != null || p.memoryAids != null || p.impairedUnderstanding != null || p.impairedJudgementReasoning != null
    || p.behavioursOfConcernCurrent != null || p.behavioursOfConcernFiveYearHistory != null || p.behaviourRiskRating != null
    || p.ridsLogged != null || p.bspPlanProvided != null || p.bocChartProvided != null
    || !!p.expressiveSkills || !!p.receptiveSkills || !!p.readingAbility || !!p.communicationAids

  if (!canEdit && !hasAnyData) return null

  async function handleSave() {
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          behaviourCommunication: {
            memory: (draft.memory || null) as MemoryLevel | null,
            memoryAids: keyToTri(draft.memoryAids),
            impairedUnderstanding: keyToTri(draft.impairedUnderstanding),
            impairedJudgementReasoning: keyToTri(draft.impairedJudgementReasoning),
            behavioursOfConcernCurrent: keyToTri(draft.behavioursOfConcernCurrent),
            behavioursOfConcernFiveYearHistory: keyToTri(draft.behavioursOfConcernFiveYearHistory),
            behaviourRiskRating: (draft.behaviourRiskRating || null) as RiskRatingLevel | null,
            ridsLogged: keyToTri(draft.ridsLogged), bspPlanProvided: keyToTri(draft.bspPlanProvided), bocChartProvided: keyToTri(draft.bocChartProvided),
            expressiveSkills: draft.expressiveSkills.trim() || null, receptiveSkills: draft.receptiveSkills.trim() || null,
            readingAbility: draft.readingAbility.trim() || null, communicationAids: draft.communicationAids.trim() || null,
          },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Behaviour & Communication.'))
    }
  }

  return (
    <SectionEditPanel title="Behaviour & Communication" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className="space-y-4">
          <div className={formGrid}>
            <FormField label="Memory" className={span.short}>
              <select value={draft.memory} onChange={(e) => setDraft((d) => ({ ...d, memory: e.target.value }))}>
                <option value={NOT_RECORDED}>Not recorded</option>
                {MEMORY_LEVELS.map((m) => <option key={m} value={m}>{MEMORY_LEVEL_LABELS[m]}</option>)}
              </select>
            </FormField>
            <FormField label="Behaviour Risk Rating" className={span.short}>
              <select value={draft.behaviourRiskRating} onChange={(e) => setDraft((d) => ({ ...d, behaviourRiskRating: e.target.value }))}>
                <option value={NOT_RECORDED}>Not recorded</option>
                {RISK_RATING_LEVELS.map((r) => <option key={r} value={r}>{RISK_RATING_LEVEL_LABELS[r]}</option>)}
              </select>
            </FormField>
          </div>
          <div className={formGrid}>
            <FormField label="Memory Aids" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.memoryAids} onChange={(v) => setDraft((d) => ({ ...d, memoryAids: v }))} ariaLabel="Memory Aids" />
            </FormField>
            <FormField label="Impaired Understanding" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.impairedUnderstanding} onChange={(v) => setDraft((d) => ({ ...d, impairedUnderstanding: v }))} ariaLabel="Impaired Understanding" />
            </FormField>
            <FormField label="Impaired Judgement / Reasoning" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.impairedJudgementReasoning} onChange={(v) => setDraft((d) => ({ ...d, impairedJudgementReasoning: v }))} ariaLabel="Impaired Judgement / Reasoning" />
            </FormField>
            <FormField label="Behaviours of Concern (Current)" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.behavioursOfConcernCurrent} onChange={(v) => setDraft((d) => ({ ...d, behavioursOfConcernCurrent: v }))} ariaLabel="Behaviours of Concern (Current)" />
            </FormField>
            <FormField label="Behaviours of Concern (5-Year History)" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.behavioursOfConcernFiveYearHistory} onChange={(v) => setDraft((d) => ({ ...d, behavioursOfConcernFiveYearHistory: v }))} ariaLabel="Behaviours of Concern (5-Year History)" />
            </FormField>
            <FormField label="RIDS Logged" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.ridsLogged} onChange={(v) => setDraft((d) => ({ ...d, ridsLogged: v }))} ariaLabel="RIDS Logged" />
            </FormField>
            <FormField label="BSP Plan Provided" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.bspPlanProvided} onChange={(v) => setDraft((d) => ({ ...d, bspPlanProvided: v }))} ariaLabel="BSP Plan Provided" />
            </FormField>
            <FormField label="BOC Chart Provided" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.bocChartProvided} onChange={(v) => setDraft((d) => ({ ...d, bocChartProvided: v }))} ariaLabel="BOC Chart Provided" />
            </FormField>
          </div>
          <div className={formGrid}>
            <FormField label="Expressive Skills" className={span.medium}>
              <textarea value={draft.expressiveSkills} onChange={(e) => setDraft((d) => ({ ...d, expressiveSkills: e.target.value }))} rows={2} />
            </FormField>
            <FormField label="Receptive Skills" className={span.medium}>
              <textarea value={draft.receptiveSkills} onChange={(e) => setDraft((d) => ({ ...d, receptiveSkills: e.target.value }))} rows={2} />
            </FormField>
            <FormField label="Reading Ability" className={span.medium}>
              <textarea value={draft.readingAbility} onChange={(e) => setDraft((d) => ({ ...d, readingAbility: e.target.value }))} rows={2} />
            </FormField>
            <FormField label="Communication Aids" className={span.medium}>
              <textarea value={draft.communicationAids} onChange={(e) => setDraft((d) => ({ ...d, communicationAids: e.target.value }))} rows={2} />
            </FormField>
          </div>
        </div>
      ) : (
        <FactList
          items={[
            { label: 'Memory', value: p.memory ? MEMORY_LEVEL_LABELS[p.memory] : undefined },
            { label: 'Memory Aids', value: yesNoUnset(p.memoryAids) },
            { label: 'Impaired Understanding', value: yesNoUnset(p.impairedUnderstanding) },
            { label: 'Impaired Judgement / Reasoning', value: yesNoUnset(p.impairedJudgementReasoning) },
            { label: 'Behaviours of Concern (Current)', value: yesNoUnset(p.behavioursOfConcernCurrent) },
            { label: 'Behaviours of Concern (5-Year History)', value: yesNoUnset(p.behavioursOfConcernFiveYearHistory) },
            { label: 'Behaviour Risk Rating', value: p.behaviourRiskRating ? RISK_RATING_LEVEL_LABELS[p.behaviourRiskRating] : undefined },
            { label: 'RIDS Logged', value: yesNoUnset(p.ridsLogged) },
            { label: 'BSP Plan Provided', value: yesNoUnset(p.bspPlanProvided) },
            { label: 'BOC Chart Provided', value: yesNoUnset(p.bocChartProvided) },
            ...(p.expressiveSkills ? [{ label: 'Expressive Skills', value: pl(p.expressiveSkills) }] : []),
            ...(p.receptiveSkills ? [{ label: 'Receptive Skills', value: pl(p.receptiveSkills) }] : []),
            ...(p.readingAbility ? [{ label: 'Reading Ability', value: pl(p.readingAbility) }] : []),
            ...(p.communicationAids ? [{ label: 'Communication Aids', value: pl(p.communicationAids) }] : []),
          ]}
        />
      )}
    </SectionEditPanel>
  )
}

export default ParticipantBehaviourCommunicationSection
