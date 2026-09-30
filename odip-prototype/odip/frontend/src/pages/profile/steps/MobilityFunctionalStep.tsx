/**
 * PF-10.4 — Profile wizard, "Mobility & Functional Detail" step. The base mobility/equipment
 * checkboxes and overnight-support fields are Shared/Intake-owned (read-only); the richer
 * functional-assessment fields (ambulant status, falls risk, personal care level, etc.) are
 * Profile-owned. mobilityAidWalker is Intake-owned but NOT shared ("Intake, No" per PF-10.1's
 * table — intake-only equipment checklist item) so it is deliberately absent here entirely.
 */
import { Controller } from 'react-hook-form'
import type { Control, UseFormRegister } from 'react-hook-form'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import { TextAreaField } from '@/components/TextAreaField'
import type { ParticipantFormData } from '@/lib/participantSchema'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { MOBILITY_SUPPORT_OPTIONS, AMBULANT_STATUS_LABELS, RISK_RATING_LEVEL_LABELS, PERSONAL_CARE_LEVEL_LABELS } from '@/api/types/participants'
import { AMBULANT_STATUSES, RISK_RATING_LEVELS, PERSONAL_CARE_LEVELS } from '@/api/types/enums'
import { ReadOnlyField } from '../profileHelpers'
import { yesNoUnknown } from '../profileFormat'
import { formGrid, span } from '@/lib/formGrid'

const TRI_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
  { value: '', label: 'Not recorded' },
]

export function MobilityFunctionalStep({ control, register, participant }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  participant: ParticipantDetailDto
}) {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Support Needs (from Intake)">
        <div className={formGrid}>
          <ReadOnlyField field="mobilityAidWheelchair" label="Wheelchair" value={yesNoUnknown(String(participant.mobilityAidWheelchair))} />
          <ReadOnlyField field="overnightSupport" label="Overnight Support" value={participant.overnightSupport} />
          <ReadOnlyField field="overnightRatio" label="Overnight Ratio" value={participant.overnightRatio} />
          <ReadOnlyField field="supportRatio" label="Support Ratio" value={participant.supportRatio} />
          <ReadOnlyField field="requiresHiLoBed" label="Hi-Lo Bed" value={yesNoUnknown(String(participant.requiresHiLoBed))} />
          <ReadOnlyField field="requiresHoist" label="Hoist" value={yesNoUnknown(String(participant.requiresHoist))} />
          <ReadOnlyField field="requiresShowerChair" label="Shower Chair" value={yesNoUnknown(String(participant.requiresShowerChair))} />
          <ReadOnlyField field="requiresCommode" label="Commode" value={yesNoUnknown(String(participant.requiresCommode))} />
          <ReadOnlyField field="requiresStandingMachine" label="Standing Machine" value={yesNoUnknown(String(participant.requiresStandingMachine))} />
        </div>
      </Card>

      <Card title="Mobility Support">
        <div className={formGrid}>
          <FormField label="Mobility Support Options" className={span.long}>
            <Controller
              control={control}
              name="mobilitySupportOptions"
              render={({ field }) => (
                <div id="mobilitySupportOptions" className="flex flex-wrap gap-2">
                  {MOBILITY_SUPPORT_OPTIONS.map((opt) => {
                    const checked = (field.value ?? []).includes(opt)
                    return (
                      <label key={opt} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked ? [...(field.value ?? []), opt] : (field.value ?? []).filter((o) => o !== opt)
                            field.onChange(next)
                          }}
                        />
                        {opt}
                      </label>
                    )
                  })}
                </div>
              )}
            />
          </FormField>
          <TextAreaField label="Mobility Notes" id="mobilityNotes" rows={2} {...register('mobilityNotes')} className={span.long} />
          <TextAreaField label="Equipment Requirements" id="equipmentRequirements" rows={2} {...register('equipmentRequirements')} className={span.long} />
          <TextAreaField label="Transport Requirements" id="transportRequirements" rows={2} {...register('transportRequirements')} className={span.long} />
        </div>
      </Card>

      <Card title="Functional Detail">
        <div className={formGrid}>
          <FormField label="Ambulant Status" className={span.medium}>
            <select id="ambulantStatus" {...register('ambulantStatus')}>
              <option value="">Not specified</option>
              {AMBULANT_STATUSES.map((s) => <option key={s} value={s}>{AMBULANT_STATUS_LABELS[s]}</option>)}
            </select>
          </FormField>
          <FormField label="Falls Risk Rating" className={span.medium}>
            <select id="fallsRiskRating" {...register('fallsRiskRating')}>
              <option value="">Not specified</option>
              {RISK_RATING_LEVELS.map((r) => <option key={r} value={r}>{RISK_RATING_LEVEL_LABELS[r]}</option>)}
            </select>
          </FormField>
          <FormField label="Uneven Ground" className={span.medium}>
            <Controller
              control={control}
              name="unevenGroundFlag"
              render={({ field }) => (
                <select id="unevenGroundFlag" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)}>
                  {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            />
          </FormField>
          <FormField label="Level of Personal Care" className={span.medium}>
            <select id="levelOfPersonalCare" {...register('levelOfPersonalCare')}>
              <option value="">Not specified</option>
              {PERSONAL_CARE_LEVELS.map((l) => <option key={l} value={l}>{PERSONAL_CARE_LEVEL_LABELS[l]}</option>)}
            </select>
          </FormField>
          <FormField label="Orthotics" className={span.medium}><input id="orthotics" {...register('orthotics')} /></FormField>
          <FormField label="Continence Support" className={span.medium}><input id="continenceSupportDetail" {...register('continenceSupportDetail')} /></FormField>
          <FormField label="Colostomy / Catheter / Enema / Suppository" className={span.medium}><input id="bowelCareDetail" {...register('bowelCareDetail')} /></FormField>
          <FormField label="Menstruation Support" className={span.medium}><input id="menstruationSupport" {...register('menstruationSupport')} /></FormField>
          <FormField label="Skin Integrity" className={span.medium}><input id="skinIntegrity" {...register('skinIntegrity')} /></FormField>
        </div>
      </Card>
    </div>
  )
}
