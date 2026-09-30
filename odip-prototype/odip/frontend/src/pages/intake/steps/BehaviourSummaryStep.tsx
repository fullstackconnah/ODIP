/**
 * PF-10.3 — Intake wizard, "Behaviour Summary" step. Per PF-10.1's fission table, only
 * `behavioursOfConcernCurrent`/`behavioursOfConcernFiveYearHistory`/`expressiveSkills` are
 * `entryPhase: 'intake'` — the cognitive/receptive-skills/reading/communication-aids detail and
 * the Community-Access-gated narrative fields are Profile-only (PF-10.4).
 */
import type { Control, UseFormRegister } from 'react-hook-form'
import { Card } from '@/components/Card'
import { TextAreaField } from '@/components/TextAreaField'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { YesNoToggleField } from '../intakeHelpers'

export function BehaviourSummaryStep({ control, register }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
}) {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Behaviours of Concern" className="space-y-[var(--field-gap-y)]">
        <YesNoToggleField control={control} name="behavioursOfConcernCurrent" label="Behaviours of Concern (Current)" />
        <YesNoToggleField control={control} name="behavioursOfConcernFiveYearHistory" label="Behaviours of Concern (5-Year History)" />
      </Card>

      <Card title="Communication">
        <TextAreaField label="Expressive Skills" id="expressiveSkills" {...register('expressiveSkills')} rows={2} placeholder="e.g. High, verbal..." />
      </Card>
    </div>
  )
}
