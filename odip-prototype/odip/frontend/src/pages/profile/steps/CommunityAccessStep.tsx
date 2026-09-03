/**
 * PF-10.4 — Profile wizard, "Community Access" step. Entire step is gated on
 * serviceStreams.includes('CommunityAccessDailyLiving') (see PROFILE_CONDITIONAL_SECTIONS'
 * `communityAccess` entry) — ProfileWizardPage.tsx only ever mounts this component when visible.
 * Owns the narrative BOC/About-Me/Supports-Look-Like fields, the 21-item checklist (whole
 * collection, unlike the old monolithic wizard's split-by-row ownership — PF-10.1 tags
 * `checklistItems` entirely CommunityAccessDailyLiving-gated here), and PF-10.2's 22-item risk
 * matrix (saved via its own nested-CRUD endpoint, not a PatchParticipantDto collection group).
 */
import { Controller } from 'react-hook-form'
import type { Control, UseFormRegister, UseFieldArrayReturn } from 'react-hook-form'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import { CompactGridRow } from '@/components/wizard'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { CHECKLIST_ITEM_TYPE_LABELS, CHECKLIST_ITEM_VALUES, CHECKLIST_ITEM_VALUE_LABELS, COMMUNITY_MOBILITY_RISK_ITEM_TYPES } from '@/api/types/enums'
import type { ChecklistItemType } from '@/api/types/enums'
import { COMMUNITY_ACCESS_RISK_ITEM_TYPE_LABELS, RISK_RATING_LEVELS, ROAD_TRAFFIC_RISK_ITEM_TYPES, BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES } from '@/api/types/enums'
import { RISK_RATING_LEVEL_LABELS } from '@/api/types/participants'
import type { CommunityAccessRiskItemType } from '@/api/types/enums'

export function CommunityAccessStep({ control, register, checklistFieldArray, riskItemsFieldArray, watchedValues }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  checklistFieldArray: UseFieldArrayReturn<ParticipantFormData, 'checklistItems'>
  riskItemsFieldArray: UseFieldArrayReturn<ParticipantFormData, 'communityAccessRiskItems'>
  watchedValues: Partial<ParticipantFormData>
}) {
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <Card title="About Me & Behaviours of Concern" className="space-y-4">
          <FormField label="Signs I Am Happy and Settled"><textarea id="signsHappyAndSettled" rows={2} {...register('signsHappyAndSettled')} /></FormField>
          <FormField label="What Helps Me Calm Down"><textarea id="whatHelpsMeCalmDown" rows={2} {...register('whatHelpsMeCalmDown')} /></FormField>
          <FormField label="BOC — Triggers"><textarea id="bocTriggers" rows={2} {...register('bocTriggers')} /></FormField>
          <FormField label="BOC — Early Warning Signs"><textarea id="bocEarlyWarningSigns" rows={2} {...register('bocEarlyWarningSigns')} /></FormField>
          <FormField label="BOC — De-Escalation Strategies"><textarea id="bocDeEscalationStrategies" rows={2} {...register('bocDeEscalationStrategies')} /></FormField>
          <FormField label="BOC — What Not To Do"><textarea id="bocWhatNotToDo" rows={2} {...register('bocWhatNotToDo')} /></FormField>
        </Card>

        <Card title="What My Supports Look Like" className="space-y-4">
          <FormField label="Morning"><textarea id="supportsLookLikeMorning" rows={2} {...register('supportsLookLikeMorning')} /></FormField>
          <FormField label="Day"><textarea id="supportsLookLikeDay" rows={2} {...register('supportsLookLikeDay')} /></FormField>
          <FormField label="Afternoon / Evening"><textarea id="supportsLookLikeAfternoonEvening" rows={2} {...register('supportsLookLikeAfternoonEvening')} /></FormField>
          <FormField label="Overnight"><textarea id="supportsLookLikeOvernight" rows={2} {...register('supportsLookLikeOvernight')} /></FormField>
        </Card>
      </div>

      <Card title="Community Mobility & Transport Risk / Behaviours of Concern Checklist" className="space-y-0">
        {checklistFieldArray.fields.map((field, index) => {
          const type = field.itemType as ChecklistItemType
          const isFirstBoc = index > 0 && (COMMUNITY_MOBILITY_RISK_ITEM_TYPES as readonly string[]).includes(checklistFieldArray.fields[index - 1].itemType) && !(COMMUNITY_MOBILITY_RISK_ITEM_TYPES as readonly string[]).includes(type)
          const row = watchedValues.checklistItems?.[index]
          return (
            <div key={field.id}>
              {isFirstBoc && <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] pt-3">Behaviours of Concern</p>}
              <CompactGridRow
                label={CHECKLIST_ITEM_TYPE_LABELS[type]}
                control={
                  <Controller
                    control={control}
                    name={`checklistItems.${index}.value` as const}
                    render={({ field: f }) => (
                      <select aria-label={CHECKLIST_ITEM_TYPE_LABELS[type]} value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value)}>
                        <option value="">Not assessed</option>
                        {CHECKLIST_ITEM_VALUES.map((v) => <option key={v} value={v}>{CHECKLIST_ITEM_VALUE_LABELS[v]}</option>)}
                      </select>
                    )}
                  />
                }
                expanded={row?.value ? (
                  <FormField label="Notes" className="mb-0">
                    <input {...register(`checklistItems.${index}.notes` as const)} />
                  </FormField>
                ) : undefined}
              />
            </div>
          )
        })}
      </Card>

      <Card title="Community Access Risk Assessment" className="space-y-4">
        <FormField label="Overall Community Access Risk Rating">
          <select id="overallCommunityAccessRiskRating" {...register('overallCommunityAccessRiskRating')}>
            <option value="">Not rated</option>
            {RISK_RATING_LEVELS.map((r) => <option key={r} value={r}>{RISK_RATING_LEVEL_LABELS[r]}</option>)}
          </select>
        </FormField>
        <div>
          {riskItemsFieldArray.fields.map((field, index) => {
            const type = field.itemType as CommunityAccessRiskItemType
            const prevType = index > 0 ? (riskItemsFieldArray.fields[index - 1].itemType as CommunityAccessRiskItemType) : null
            const isFirstBoc = prevType !== null && (ROAD_TRAFFIC_RISK_ITEM_TYPES as readonly string[]).includes(prevType) && !(ROAD_TRAFFIC_RISK_ITEM_TYPES as readonly string[]).includes(type)
            const isFirstHealth = prevType !== null && (BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES as readonly string[]).includes(prevType) && !(BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES as readonly string[]).includes(type) && !(ROAD_TRAFFIC_RISK_ITEM_TYPES as readonly string[]).includes(type)
            const row = watchedValues.communityAccessRiskItems?.[index]
            return (
              <div key={field.id}>
                {isFirstBoc && <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] pt-3">Behaviours of Concern</p>}
                {isFirstHealth && <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] pt-3">Health & Personal Safety</p>}
                <CompactGridRow
                  label={COMMUNITY_ACCESS_RISK_ITEM_TYPE_LABELS[type]}
                  control={
                    <Controller
                      control={control}
                      name={`communityAccessRiskItems.${index}.rating` as const}
                      render={({ field: f }) => (
                        <select aria-label={COMMUNITY_ACCESS_RISK_ITEM_TYPE_LABELS[type]} value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value)}>
                          <option value="">Not rated</option>
                          {RISK_RATING_LEVELS.map((r) => <option key={r} value={r}>{RISK_RATING_LEVEL_LABELS[r]}</option>)}
                        </select>
                      )}
                    />
                  }
                  expanded={row?.rating ? (
                    <FormField label="Support / Strategy" className="mb-0">
                      <input {...register(`communityAccessRiskItems.${index}.strategyNotes` as const)} />
                    </FormField>
                  ) : undefined}
                />
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
