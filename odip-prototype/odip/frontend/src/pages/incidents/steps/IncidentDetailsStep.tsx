import { useFieldArray } from 'react-hook-form'
import type { Control, FieldErrors, UseFormRegister } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { BodyDiagram } from '@/components/BodyDiagram'
import type { BodyRegion, InjuryType } from '@/api/types/enums'
import type { IncidentFormData } from '../incidentFormSchema'
import { formGrid, span } from '@/lib/formGrid'

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
 * The old free-text witnessNames/witnessStatements fields that used to sit here have moved to
 * IN-7's dedicated Witnesses step (WitnessesStep.tsx), replaced by the full witnesses[] entity.
 */
export function IncidentDetailsStep({ register, control, errors, incidentType, wereEmergencyServicesCalled }: IncidentDetailsStepProps) {
  const { fields, append, remove } = useFieldArray({ control, name: 'injuries' })

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Incident Details">
        <div className={formGrid}>
          <FormField label="Date & Time" required error={errors.incidentDateTime?.message} className={span.short}>
            <input type="datetime-local" {...register('incidentDateTime')} />
          </FormField>

          <FormField label="Location" className={span.medium}>
            <input {...register('location')} placeholder="Where the incident occurred" />
          </FormField>

          <FormField label="Description" required error={errors.description?.message} className={span.long}>
            <textarea {...register('description')} rows={4} placeholder="Detailed description of the incident..." />
          </FormField>

          <FormField label="Immediate Actions Taken" className={span.long}>
            <textarea {...register('immediateActionsTaken')} rows={3} placeholder="What was done immediately in response..." />
          </FormField>

          <FormField label="Were Emergency Services Called?" layout="checkbox" className={span.short}>
            <input type="checkbox" {...register('wereEmergencyServicesCalled')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          {wereEmergencyServicesCalled && (
            <FormField label="Emergency Services Details" className={span.long}>
              <textarea {...register('emergencyServicesDetails')} rows={2} placeholder="Which services, response details..." />
            </FormField>
          )}
        </div>
      </Card>

      {incidentType === 'Injury' && (
        <Card title="Injuries">
          {errors.injuries?.message && (
            <p role="alert" className="text-xs text-[var(--color-destructive)] mb-2">{errors.injuries.message}</p>
          )}
          <BodyDiagram
            injuries={fields.map((f) => ({ region: f.region as BodyRegion, injuryType: f.injuryType as InjuryType, description: f.description }))}
            onAdd={(region, injuryType, description) => append({ region, injuryType, description })}
            onRemove={(index) => remove(index)}
          />
        </Card>
      )}
    </div>
  )
}
