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
import { Card } from '@/components/Card'
import { OVERNIGHT_SUPPORT_TYPES, SUPPORT_RATIOS } from '@/api/types/enums'
import { OVERNIGHT_SUPPORT_LABELS, OVERNIGHT_RATIO_LABELS } from '@/api/types/participants'
import type { SupportRatio } from '@/api/types/enums'
import type { ParticipantFormData } from '@/lib/participantSchema'

export function SupportNeedsStep({ control, register, errors, overnightSupportValue }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  errors: FieldErrors<ParticipantFormData>
  overnightSupportValue: string | undefined
}) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="Support Needs" className="space-y-4">
        <FormField label="High Support" layout="checkbox">
          <input id="isHighSupport" type="checkbox" {...register('isHighSupport')} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>

        <FormField label="Intensive Support (NDIS billing)" layout="checkbox">
          <input id="isIntensiveSupport" type="checkbox" {...register('isIntensiveSupport')} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>

        <FormField label="Support Ratio" required error={errors.supportRatio?.message}>
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
      </Card>

      <Card title="Mobility Aids" className="space-y-4">
        <fieldset className="m-0 p-0 border-0">
          <legend className="sr-only">Mobility Aids</legend>
          <FormField label="Wheelchair" layout="checkbox">
            <input id="mobilityAidWheelchair" type="checkbox" {...register('mobilityAidWheelchair')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          <FormField label="Walker" layout="checkbox">
            <input id="mobilityAidWalker" type="checkbox" {...register('mobilityAidWalker')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
        </fieldset>
      </Card>

      <Card title="Overnight Support" className="space-y-4">
        <FormField label="Overnight Support">
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
          <FormField label="Overnight Ratio">
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
      </Card>

      <Card title="Equipment" className="space-y-4">
        <fieldset className="m-0 p-0 border-0 space-y-4">
          <legend className="sr-only">Equipment</legend>
          <FormField label="Hi-Lo Bed" layout="checkbox">
            <input id="requiresHiLoBed" type="checkbox" {...register('requiresHiLoBed')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          <FormField label="Hoist" layout="checkbox">
            <input id="requiresHoist" type="checkbox" {...register('requiresHoist')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          <FormField label="Shower Chair" layout="checkbox">
            <input id="requiresShowerChair" type="checkbox" {...register('requiresShowerChair')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          <FormField label="Commode" layout="checkbox">
            <input id="requiresCommode" type="checkbox" {...register('requiresCommode')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          <FormField label="Standing Machine" layout="checkbox">
            <input id="requiresStandingMachine" type="checkbox" {...register('requiresStandingMachine')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
        </fieldset>
      </Card>
    </div>
  )
}
