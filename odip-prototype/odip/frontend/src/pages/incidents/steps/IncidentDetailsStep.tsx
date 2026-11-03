import { Fragment } from 'react'
import { useFieldArray } from 'react-hook-form'
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { BodyDiagram } from '@/components/BodyDiagram'
import { EMERGENCY_SERVICES } from '@/api/types/enums'
import type { BodyRegion, EmergencyService, InjuryType } from '@/api/types/enums'
import type { IncidentFormData } from '../incidentFormSchema'
import { formGrid, span } from '@/lib/formGrid'

export type IncidentDetailsStepProps = {
  register: UseFormRegister<IncidentFormData>
  control: Control<IncidentFormData>
  setValue: UseFormSetValue<IncidentFormData>
  errors: FieldErrors<IncidentFormData>
  incidentType: string | undefined
  wereEmergencyServicesCalled: boolean | undefined
  emergencyServices: readonly EmergencyService[] | undefined
}

/** Per service: the form fields behind its officer name and reference, in the order the shape lays them out. */
const SERVICE_FIELDS = {
  Police: { name: 'policeOfficerName', ref: 'policeReference' },
  Ambulance: { name: 'ambulanceOfficerName', ref: 'ambulanceReference' },
  Fire: { name: 'fireOfficerName', ref: 'fireReference' },
} as const

/**
 * IN-6 — wizard step 2, "Incident Details". All six backlog fields already exist as
 * IncidentReport columns (no entity/DTO change for this item alone). IN-5's BodyDiagram renders
 * here, gated on incidentType === 'Injury' — the injuries[] field array backing it is owned by
 * this step since it lives in the same schema slice (STEP_DETAILS_FIELDS includes 'injuries').
 *
 * The old free-text witnessNames/witnessStatements fields that used to sit here have moved to
 * IN-7's dedicated Witnesses step (WitnessesStep.tsx), replaced by the full witnesses[] entity.
 */
export function IncidentDetailsStep({ register, control, setValue, errors, incidentType, wereEmergencyServicesCalled, emergencyServices }: IncidentDetailsStepProps) {
  const { fields, append, remove } = useFieldArray({ control, name: 'injuries' })
  const chosen = emergencyServices ?? []

  function toggleService(service: EmergencyService, on: boolean) {
    setValue('emergencyServices', EMERGENCY_SERVICES.filter((s) => (s === service ? on : chosen.includes(s))), { shouldDirty: true })
    // Unticking drops what was typed for it, so a hidden name or reference is never sent.
    if (!on) {
      setValue(SERVICE_FIELDS[service].name, '', { shouldDirty: true })
      setValue(SERVICE_FIELDS[service].ref, '', { shouldDirty: true })
    }
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Incident details">
        <div className={formGrid}>
          <FormField label="Date & Time" required error={errors.incidentDateTime?.message} className={span.date}>
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

          <FormField label="Were Emergency Services Called?" layout="checkbox" className={span.long}>
            <input type="checkbox" {...register('wereEmergencyServicesCalled')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          {wereEmergencyServicesCalled && (
            <>
              <fieldset className={`${span.long} m-0 p-0 border-0`}>
                <legend className="text-sm font-medium text-[var(--color-foreground)] mb-1">Which services?</legend>
                <div className="flex flex-col md:flex-row md:gap-6">
                  {EMERGENCY_SERVICES.map((service) => (
                    <label key={service} className="flex items-center gap-3 py-1 min-h-[var(--control-h)]">
                      <input
                        type="checkbox"
                        checked={chosen.includes(service)}
                        onChange={(e) => toggleService(service, e.target.checked)}
                        className="w-4 h-4 rounded border-[var(--color-border)]"
                      />
                      <span className="text-sm text-[var(--color-foreground)]">{service}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {EMERGENCY_SERVICES.filter((s) => chosen.includes(s)).map((service) => {
                const f = SERVICE_FIELDS[service]
                return (
                  <Fragment key={service}>
                    <FormField label={`${service} officer's name`} error={errors[f.name]?.message} className={span.medium}>
                      <input {...register(f.name)} maxLength={100} placeholder="Who attended or who you spoke to" />
                    </FormField>
                    <FormField label={`${service} reference number`} error={errors[f.ref]?.message} className={span.short}>
                      <input {...register(f.ref)} maxLength={50} placeholder="Event or case number" />
                    </FormField>
                  </Fragment>
                )
              })}

              <FormField label="Other details" className={span.long}>
                <textarea {...register('emergencyServicesDetails')} rows={2} placeholder="Anything else about the response" />
              </FormField>
            </>
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
