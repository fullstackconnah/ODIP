import { useFieldArray } from 'react-hook-form'
import type { Control, FieldErrors, UseFormRegister } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { BodyDiagram } from '@/components/BodyDiagram'
import type { BodyRegion, InjuryType } from '@/api/types/enums'
import type { IncidentFormData } from '../incidentFormSchema'

export type IncidentDetailsStepProps = {
  register: UseFormRegister<IncidentFormData>
  control: Control<IncidentFormData>
  errors: FieldErrors<IncidentFormData>
  incidentType: string | undefined
  wereEmergencyServicesCalled: boolean | undefined
}

/**
 * IN-6 — wizard step 2, "Incident Details". All six backlog fields already exist as
 * IncidentReport columns (no entity/DTO change for this item alone). IN-5's BodyDiagram renders
 * here, gated on incidentType === 'Injury' — the injuries[] field array backing it is owned by
 * this step since it lives in the same schema slice (STEP_DETAILS_FIELDS includes 'injuries').
 *
 * witnessNames/witnessStatements (free text) stay here, unchanged, as the clean seam IN-7 (a
 * later branch, out of this one's scope) will replace with the full witnesses[] entity — the
 * backlog's own wizard structure moves them to a dedicated Witnesses step, which this branch was
 * explicitly asked not to build.
 */
export function IncidentDetailsStep({ register, control, errors, incidentType, wereEmergencyServicesCalled }: IncidentDetailsStepProps) {
  const { fields, append, remove } = useFieldArray({ control, name: 'injuries' })

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="Incident Details" className="md:col-span-2 space-y-4">
        <FormField label="Date & Time" required error={errors.incidentDateTime?.message}>
          <input type="datetime-local" {...register('incidentDateTime')} />
        </FormField>

        <FormField label="Location">
          <input {...register('location')} placeholder="Where the incident occurred" />
        </FormField>

        <FormField label="Description" required error={errors.description?.message}>
          <textarea {...register('description')} rows={5} placeholder="Detailed description of the incident..." />
        </FormField>

        <FormField label="Immediate Actions Taken">
          <textarea {...register('immediateActionsTaken')} rows={3} placeholder="What was done immediately in response..." />
        </FormField>

        <FormField label="Were Emergency Services Called?" layout="checkbox">
          <input type="checkbox" {...register('wereEmergencyServicesCalled')} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>

        {wereEmergencyServicesCalled && (
          <FormField label="Emergency Services Details">
            <textarea {...register('emergencyServicesDetails')} rows={2} placeholder="Which services, response details..." />
          </FormField>
        )}
      </Card>

      {incidentType === 'Injury' && (
        <Card title="Injuries" className="md:col-span-2 space-y-4">
          {errors.injuries?.message && (
            <p role="alert" className="text-xs text-[var(--color-destructive)]">{errors.injuries.message}</p>
          )}
          <BodyDiagram
            injuries={fields.map((f) => ({ region: f.region as BodyRegion, injuryType: f.injuryType as InjuryType, description: f.description }))}
            onAdd={(region, injuryType, description) => append({ region, injuryType, description })}
            onRemove={(index) => remove(index)}
          />
        </Card>
      )}

      {/* IN-7 seam: free-text witnesses, unchanged pending the dedicated Witnesses step. */}
      <Card title="Witnesses" className="md:col-span-2 space-y-4">
        <FormField label="Witness Names">
          <input {...register('witnessNames')} placeholder="Names of witnesses (comma-separated)" />
        </FormField>

        <FormField label="Witness Statements">
          <textarea {...register('witnessStatements')} rows={3} placeholder="Summary of witness accounts..." />
        </FormField>
      </Card>
    </div>
  )
}
