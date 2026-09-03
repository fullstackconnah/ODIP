/**
 * PF-10.3 — Intake wizard, "Behaviour Summary" step. Per PF-10.1's fission table, only
 * `behavioursOfConcernCurrent`/`behavioursOfConcernFiveYearHistory`/`expressiveSkills` are
 * `entryPhase: 'intake'` — the cognitive/receptive-skills/reading/communication-aids detail and
 * the Community-Access-gated narrative fields are Profile-only (PF-10.4).
 */
import type { Control, UseFormRegister } from 'react-hook-form'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { YesNoToggleField } from '../intakeHelpers'

export function BehaviourSummaryStep({ control, register }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
}) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="Behaviours of Concern" className="space-y-4">
        <YesNoToggleField control={control} name="behavioursOfConcernCurrent" label="Behaviours of Concern (Current)" />
        <YesNoToggleField control={control} name="behavioursOfConcernFiveYearHistory" label="Behaviours of Concern (5-Year History)" />
      </Card>

      <Card title="Communication" className="space-y-4">
        <FormField label="Expressive Skills">
          <textarea id="expressiveSkills" {...register('expressiveSkills')} rows={2} placeholder="e.g. High, verbal..." />
        </FormField>
      </Card>
    </div>
  )
}
