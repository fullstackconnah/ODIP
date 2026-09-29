/**
 * PF-10.4 — Profile wizard, "Behaviour & Cognition Detail" step. The Behaviours-of-Concern Y/N
 * flags, Expressive Skills, and Behaviour Risk Summary are Shared/Intake-owned (read-only); memory/
 * cognition/receptive-communication detail is Profile-owned.
 */
import { Controller } from 'react-hook-form'
import type { Control, UseFormRegister } from 'react-hook-form'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import { TextAreaField } from '@/components/TextAreaField'
import type { ParticipantFormData } from '@/lib/participantSchema'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { MEMORY_LEVELS, RISK_RATING_LEVELS } from '@/api/types/enums'
import { MEMORY_LEVEL_LABELS, RISK_RATING_LEVEL_LABELS } from '@/api/types/participants'
import { ReadOnlyField } from '../profileHelpers'
import { yesNoUnknown } from '../profileFormat'

const TRI_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
  { value: '', label: 'Not recorded' },
]

const EMPTY: ReadonlySet<string> = new Set()

export function BehaviourCognitionStep({ control, register, participant, hiddenFields }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  participant: ParticipantDetailDto
  /** Field ids to omit entirely — e.g. the caregiver wizard's CAREGIVER_INTERNAL_FIELDS. Defaults
   * to empty, so every existing Profile-wizard caller is unaffected. */
  hiddenFields?: ReadonlySet<string>
}) {
  const hidden = hiddenFields ?? EMPTY
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="Behaviour Summary (from Intake)" className="space-y-3">
        <ReadOnlyField field="behavioursOfConcernCurrent" label="Behaviours of Concern (Current)" value={yesNoUnknown(participant.behavioursOfConcernCurrent === null ? '' : String(participant.behavioursOfConcernCurrent))} />
        <ReadOnlyField field="behavioursOfConcernFiveYearHistory" label="Behaviours of Concern (5-Year History)" value={yesNoUnknown(participant.behavioursOfConcernFiveYearHistory === null ? '' : String(participant.behavioursOfConcernFiveYearHistory))} />
        <ReadOnlyField field="expressiveSkills" label="Expressive Skills" value={participant.expressiveSkills || '—'} />
        <ReadOnlyField field="behaviourRiskSummary" label="Behaviour Risk Summary" value={participant.behaviourRiskSummary || '—'} />
      </Card>

      <div className="space-y-6">
        <Card title="Cognition" className="space-y-4">
          <FormField label="Memory">
            <select id="memory" {...register('memory')}>
              <option value="">Not specified</option>
              {MEMORY_LEVELS.map((m) => <option key={m} value={m}>{MEMORY_LEVEL_LABELS[m]}</option>)}
            </select>
          </FormField>
          <FormField label="Memory Aids">
            <Controller control={control} name="memoryAids" render={({ field }) => (
              <select id="memoryAids" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)}>
                {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )} />
          </FormField>
          <FormField label="Impaired Understanding">
            <Controller control={control} name="impairedUnderstanding" render={({ field }) => (
              <select id="impairedUnderstanding" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)}>
                {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )} />
          </FormField>
          <FormField label="Impaired Judgement / Reasoning">
            <Controller control={control} name="impairedJudgementReasoning" render={({ field }) => (
              <select id="impairedJudgementReasoning" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)}>
                {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )} />
          </FormField>
        </Card>

        <Card title="Behaviour Risk" className="space-y-4">
          {!hidden.has('behaviourRiskRating') && (
            <FormField label="Behaviour Risk Rating">
              <select id="behaviourRiskRating" {...register('behaviourRiskRating')}>
                <option value="">Not specified</option>
                {RISK_RATING_LEVELS.map((r) => <option key={r} value={r}>{RISK_RATING_LEVEL_LABELS[r]}</option>)}
              </select>
            </FormField>
          )}
          <FormField label="RIDS Logged">
            <Controller control={control} name="ridsLogged" render={({ field }) => (
              <select id="ridsLogged" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)}>
                {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )} />
          </FormField>
          <FormField label="BSP Plan Provided">
            <Controller control={control} name="bspPlanProvided" render={({ field }) => (
              <select id="bspPlanProvided" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)}>
                {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )} />
          </FormField>
          <FormField label="BOC Chart Provided">
            <Controller control={control} name="bocChartProvided" render={({ field }) => (
              <select id="bocChartProvided" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)}>
                {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )} />
          </FormField>
        </Card>

        <Card title="Communication" className="space-y-4">
          <TextAreaField label="Receptive Skills" id="receptiveSkills" rows={2} {...register('receptiveSkills')} />
          <TextAreaField label="Reading Ability" id="readingAbility" rows={2} {...register('readingAbility')} />
          <TextAreaField label="Communication Aids" id="communicationAids" rows={2} {...register('communicationAids')} />
        </Card>
      </div>
    </div>
  )
}
