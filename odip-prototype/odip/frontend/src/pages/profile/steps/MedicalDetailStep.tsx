/**
 * PF-10.4 — Profile wizard, "Medical Detail" step: diagnoses / HIDPA / structured health
 * conditions grid. medicalSummary is Shared/Intake-owned (read-only); hidpaNotes is Intake-owned
 * but NOT shared (sources: [] — ungated, no Profile-side existence per PF-10.1) so it does not
 * appear on this wizard at all, editable or read-only.
 */
import { Controller } from 'react-hook-form'
import type { Control, UseFormRegister, FieldErrors, UseFieldArrayReturn } from 'react-hook-form'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import { TextAreaField } from '@/components/TextAreaField'
import { CompactGridRow } from '@/components/wizard'
import type { ParticipantFormData } from '@/lib/participantSchema'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { DIAGNOSIS_OPTIONS, DIAGNOSIS_OTHER_SENTINEL } from '@/api/types/participants'
import { HIDPA_SUPPORT_CATEGORIES } from '@/api/types/enums'
import { HIDPA_CATEGORY_LABELS } from '@/api/types/participants'
import { HEALTH_CONDITION_TYPE_LABELS } from '@/api/types/health-conditions'
import type { HealthConditionType } from '@/api/types/enums'
import { ReadOnlyField } from '../profileHelpers'
import { formGrid, span } from '@/lib/formGrid'

const TRI_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
  { value: '', label: 'Not recorded' },
]

export function MedicalDetailStep({ control, register, errors, participant, healthConditionFieldArray, watchedValues }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  participant: ParticipantDetailDto
  healthConditionFieldArray: UseFieldArrayReturn<ParticipantFormData, 'healthConditions'>
  watchedValues: Partial<ParticipantFormData>
}) {
  return (
    <div className="grid md:grid-cols-2 gap-[var(--section-gap)] items-start">
      <div className="flex flex-col gap-[var(--section-gap)]">
        <Card>
          <ReadOnlyField field="medicalSummary" label="Medical Summary (from Intake)" value={participant.medicalSummary || '—'} />
        </Card>

        <Card title="Diagnoses & HIDPA">
          <div className={formGrid}>
            <FormField label="Primary Diagnosis" className={span.medium}>
              <select id="primaryDiagnosis" {...register('primaryDiagnosis')}>
                <option value="">Not specified</option>
                {DIAGNOSIS_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                <option value={DIAGNOSIS_OTHER_SENTINEL}>{DIAGNOSIS_OTHER_SENTINEL}</option>
              </select>
            </FormField>
            {watchedValues.primaryDiagnosis === DIAGNOSIS_OTHER_SENTINEL && (
              <FormField label="Specify Primary Diagnosis" error={errors.primaryDiagnosisOther?.message} className={span.medium}>
                <input id="primaryDiagnosisOther" {...register('primaryDiagnosisOther')} />
              </FormField>
            )}
            <FormField label="Other Diagnoses (one per line)" className={span.long}>
              <Controller
                control={control}
                name="otherDiagnoses"
                render={({ field }) => (
                  <textarea
                    id="otherDiagnoses"
                    rows={3}
                    value={(field.value ?? []).join('\n')}
                    onChange={(e) => field.onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                  />
                )}
              />
            </FormField>
            <FormField label="HIDPA Support Categories" className={span.long}>
              <Controller
                control={control}
                name="hidpaSupportCategories"
                render={({ field }) => (
                  <div id="hidpaSupportCategories" className="flex flex-wrap gap-2">
                    {HIDPA_SUPPORT_CATEGORIES.map((cat) => {
                      const checked = (field.value ?? []).includes(cat)
                      return (
                        <label key={cat} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked ? [...(field.value ?? []), cat] : (field.value ?? []).filter((c) => c !== cat)
                              field.onChange(next)
                            }}
                          />
                          {HIDPA_CATEGORY_LABELS[cat]}
                        </label>
                      )
                    })}
                  </div>
                )}
              />
            </FormField>
          </div>
        </Card>

        <Card title="Allergies">
          <div className={formGrid}>
            <TextAreaField label="Allergies Detail" id="allergiesDetail" rows={2} {...register('allergiesDetail')} className={span.long} />
            <FormField label="Anaphylaxis Risk" className={span.medium}>
              <Controller
                control={control}
                name="isAnaphylaxisRisk"
                render={({ field }) => (
                  <select id="isAnaphylaxisRisk" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)}>
                    {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              />
            </FormField>
            <TextAreaField label="Allergy Management Notes" id="allergyManagementNotes" rows={2} {...register('allergyManagementNotes')} className={span.long} />
          </div>
        </Card>
      </div>

      <Card title="Health Conditions" className="space-y-0">
        {healthConditionFieldArray.fields.map((field, index) => {
          const type = field.conditionType as HealthConditionType
          const row = watchedValues.healthConditions?.[index]
          return (
            <CompactGridRow
              key={field.id}
              label={HEALTH_CONDITION_TYPE_LABELS[type]}
              control={
                <Controller
                  control={control}
                  name={`healthConditions.${index}.has` as const}
                  render={({ field: f }) => (
                    <select id={`healthConditions.${index}.has`} aria-label={HEALTH_CONDITION_TYPE_LABELS[type]} value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value)}>
                      {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                />
              }
              expanded={row?.has === 'true' ? (
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Severity" className="mb-0">
                    <input {...register(`healthConditions.${index}.severity` as const)} />
                  </FormField>
                  <FormField label="Plan Provided" className="mb-0">
                    <Controller
                      control={control}
                      name={`healthConditions.${index}.planProvided` as const}
                      render={({ field: f }) => (
                        <select value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value)}>
                          {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      )}
                    />
                  </FormField>
                  <FormField label="Training Required" className="mb-0">
                    <Controller
                      control={control}
                      name={`healthConditions.${index}.trainingRequired` as const}
                      render={({ field: f }) => (
                        <select value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value)}>
                          {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      )}
                    />
                  </FormField>
                  <FormField label="Notes" className="mb-0">
                    <input {...register(`healthConditions.${index}.notes` as const)} />
                  </FormField>
                </div>
              ) : undefined}
            />
          )
        })}
      </Card>
    </div>
  )
}
