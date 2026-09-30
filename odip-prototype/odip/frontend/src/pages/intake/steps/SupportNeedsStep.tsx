/**
 * PF-10.3 — Intake wizard, "Support Needs" step: the day-one physical-support/mobility-aid subset
 * of the old "Support Needs & Mobility" step. Per PF-10.1's fission table, only
 * mobilityAidWheelchair/mobilityAidWalker/overnightSupport/overnightRatio/the 5 equipment
 * checkboxes/supportRatio/isHighSupport/isIntensiveSupport are `entryPhase: 'intake'` — every
 * Profile-only field (mobilitySupportOptions, mobilityNotes, equipmentRequirements,
 * transportRequirements, ambulantStatus, fallsRiskRating, unevenGroundFlag,
 * levelOfPersonalCare, orthotics, continenceSupportDetail, bowelCareDetail, menstruationSupport,
 * skinIntegrity) is absent — it moves to the Profile wizard (PF-10.4).
 */
import type { Control, FieldErrors, UseFormRegister } from 'react-hook-form'
import { Controller } from 'react-hook-form'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { CheckboxField } from '@/components/CheckboxField'
import { Card } from '@/components/Card'
import { OVERNIGHT_SUPPORT_TYPES, SUPPORT_RATIOS } from '@/api/types/enums'
import { OVERNIGHT_SUPPORT_LABELS, OVERNIGHT_RATIO_LABELS } from '@/api/types/participants'
import type { SupportRatio } from '@/api/types/enums'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { formGrid, span } from '@/lib/formGrid'

export function SupportNeedsStep({ control, register, errors, overnightSupportValue }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  overnightSupportValue: string | undefined
}) {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Support Needs">
        <div className={formGrid}>
          <CheckboxField label="High Support" id="isHighSupport" {...register('isHighSupport')} className={span.short} />

          <CheckboxField label="Intensive Support (NDIS billing)" id="isIntensiveSupport" {...register('isIntensiveSupport')} className={span.short} />

          <FormField label="Support Ratio" required error={errors.supportRatio?.message} className={span.medium}>
            <Controller
              control={control}
              name="supportRatio"
              render={({ field }) => (
                <Dropdown
                  id="supportRatio"
                  variant="form"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  items={[
                    { value: 'SharedSupport', label: 'Shared Support' },
                    { value: 'OneToOne', label: '1:1' },
                    { value: 'OneToTwo', label: '1:2' },
                    { value: 'TwoToOne', label: '2:1' },
                    { value: 'Other', label: 'Other' },
                  ]}
                />
              )}
            />
          </FormField>
        </div>
      </Card>

      <Card title="Mobility Aids">
        <fieldset className="m-0 p-0 border-0">
          <legend className="sr-only">Mobility Aids</legend>
          <CheckboxField label="Wheelchair" id="mobilityAidWheelchair" {...register('mobilityAidWheelchair')} />
          <CheckboxField label="Walker" id="mobilityAidWalker" {...register('mobilityAidWalker')} />
        </fieldset>
      </Card>

      <Card title="Overnight Support">
        <div className={formGrid}>
          <FormField label="Overnight Support" className={span.medium}>
            <Controller
              control={control}
              name="overnightSupport"
              render={({ field }) => (
                <Dropdown
                  id="overnightSupport"
                  variant="form"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  items={OVERNIGHT_SUPPORT_TYPES.map((type) => ({ value: type, label: OVERNIGHT_SUPPORT_LABELS[type] }))}
                />
              )}
            />
          </FormField>

          {overnightSupportValue !== 'None' && (
            <FormField label="Overnight Ratio" className={span.medium}>
              <Controller
                control={control}
                name="overnightRatio"
                render={({ field }) => (
                  <Dropdown
                    id="overnightRatio"
                    variant="form"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={SUPPORT_RATIOS.map((ratio) => ({ value: ratio, label: OVERNIGHT_RATIO_LABELS[ratio as SupportRatio] }))}
                  />
                )}
              />
            </FormField>
          )}
        </div>
      </Card>

      <Card title="Equipment">
        <fieldset className="m-0 p-0 border-0">
          <legend className="sr-only">Equipment</legend>
          <CheckboxField label="Hi-Lo Bed" id="requiresHiLoBed" {...register('requiresHiLoBed')} />
          <CheckboxField label="Hoist" id="requiresHoist" {...register('requiresHoist')} />
          <CheckboxField label="Shower Chair" id="requiresShowerChair" {...register('requiresShowerChair')} />
          <CheckboxField label="Commode" id="requiresCommode" {...register('requiresCommode')} />
          <CheckboxField label="Standing Machine" id="requiresStandingMachine" {...register('requiresStandingMachine')} />
        </fieldset>
      </Card>
    </div>
  )
}
