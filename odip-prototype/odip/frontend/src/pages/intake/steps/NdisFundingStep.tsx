/**
 * PF-10.3 — Intake wizard, "NDIS & Funding" step. Covers the NDIS & Funding intake fields per
 * `fieldsForEntry('intake')`: `ndisNumber`/`planStartDate`/`planEndDate`/`planType`/
 * `fundingSource`/`fundingOrganisation` (shared, captured once here) plus the ODIP-operational
 * `region`/`isRepeatClient`/`serviceStreams`. `isDsoa` (Profile-entry, Key Identifiers) is absent.
 */
import type { Control, FieldErrors, UseFormRegister } from 'react-hook-form'
import { Controller } from 'react-hook-form'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { CheckboxField } from '@/components/CheckboxField'
import { Card } from '@/components/Card'
import { FUNDING_SOURCES, SERVICE_STREAMS } from '@/api/types/enums'
import { FUNDING_SOURCE_LABELS, SERVICE_STREAM_LABELS } from '@/api/types/participants'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { PlanTypeComplianceBanner } from '../intakeHelpers'
import { formGrid, span } from '@/lib/formGrid'

/**
 * NOTE — scope simplification vs. the retired single-step wizard: that wizard guards a fundingSource
 * flip away from "Other" (while typed Funding-Organisation text would be discarded) behind a
 * ConfirmDialog. This smaller intake step skips that guard and lets the switch apply directly —
 * flagged as a deliberate simplification in this branch's report, not an oversight.
 */
export function NdisFundingStep({
  control, register, errors, fundingSourceValue, planTypeComplianceWarningValue,
}: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  fundingSourceValue: string | undefined
  planTypeComplianceWarningValue: string | null
}) {
  const showNdisFields = fundingSourceValue !== 'Other'
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Service Streams">
        <fieldset className="m-0 p-0 border-0">
          <legend className="sr-only">Service Streams</legend>
          <Controller
            control={control}
            name="serviceStreams"
            render={({ field }) => (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                {SERVICE_STREAMS.map((stream) => {
                  const selected = field.value ?? []
                  const checked = selected.includes(stream)
                  return (
                    <label key={stream} className="flex items-center gap-3 py-1 min-h-[var(--control-h)]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          field.onChange(
                            e.target.checked
                              ? [...selected, stream]
                              : selected.filter((v) => v !== stream)
                          )
                        }}
                        className="w-4 h-4 rounded border-[var(--color-border)]"
                      />
                      <span className="text-sm text-[var(--color-foreground)]">{SERVICE_STREAM_LABELS[stream]}</span>
                    </label>
                  )
                })}
              </div>
            )}
          />
        </fieldset>
      </Card>

      <Card title="NDIS & Funding">
        <div className={formGrid}>
          <FormField label="Funding Source" required error={errors.fundingSource?.message} className={span.medium}>
            <Controller
              control={control}
              name="fundingSource"
              render={({ field }) => (
                <Dropdown
                  id="fundingSource"
                  variant="form"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  items={FUNDING_SOURCES.map((s) => ({ value: s, label: FUNDING_SOURCE_LABELS[s] }))}
                />
              )}
            />
          </FormField>

          {showNdisFields && (
            <>
              <FormField label="NDIS Number" className={span.short}>
                <input id="ndisNumber" {...register('ndisNumber')} placeholder="e.g. 431234567" />
              </FormField>

              <FormField label="Plan Start Date" className={span.date}>
                <input id="planStartDate" type="date" {...register('planStartDate')} />
              </FormField>

              <FormField label="Plan End Date" className={span.date}>
                <input id="planEndDate" type="date" {...register('planEndDate')} />
              </FormField>

              <FormField label="Plan Type" required error={errors.planType?.message} className={span.short}>
                <Controller
                  control={control}
                  name="planType"
                  render={({ field }) => (
                    <Dropdown
                      id="planType"
                      variant="form"
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      items={[
                        { value: 'SelfManaged', label: 'Self Managed' },
                        { value: 'PlanManaged', label: 'Plan Managed' },
                        { value: 'AgencyManaged', label: 'Agency Managed' },
                      ]}
                    />
                  )}
                />
              </FormField>

              <div className={span.long}>
                <PlanTypeComplianceBanner message={planTypeComplianceWarningValue} />
              </div>
            </>
          )}

          <FormField label="Region" className={span.short}>
            <input id="region" {...register('region')} placeholder="e.g. QLD" />
          </FormField>

          {!showNdisFields && (
            <FormField label="Funding Organisation" required error={errors.fundingOrganisation?.message} className={span.medium}>
              <input id="fundingOrganisation" {...register('fundingOrganisation')} placeholder="e.g. Plan Partners" />
            </FormField>
          )}

          <CheckboxField label="Repeat Client" id="isRepeatClient" {...register('isRepeatClient')} className={span.short} />
        </div>
      </Card>
    </div>
  )
}
