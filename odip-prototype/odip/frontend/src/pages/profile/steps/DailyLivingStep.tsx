/**
 * PF-10.4 — Profile wizard, "Daily Living" step (whole step, entirely Profile-owned). The 20-row
 * ADL grid itself is ungated, but its `howToHelpNotes` column is CommunityAccessDailyLiving-gated
 * (a column-level gate distinct from the two section-level PROFILE_CONDITIONAL_SECTIONS gates —
 * see documentMapping.ts's adlAssessments entry note).
 */
import { Controller } from 'react-hook-form'
import type { Control, UseFormRegister, UseFieldArrayReturn } from 'react-hook-form'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import { TextAreaField } from '@/components/TextAreaField'
import { CompactGridRow } from '@/components/wizard'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { ADL_TYPE_LABELS, ADL_LEVEL_LABELS } from '@/api/types/adl-assessments'
import { PERSONAL_ADL_TYPES, ADL_LEVELS } from '@/api/types/enums'
import type { AdlType } from '@/api/types/enums'

export function DailyLivingStep({ control, register, adlFieldArray, watchedValues, caVisible }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  adlFieldArray: UseFieldArrayReturn<ParticipantFormData, 'adlAssessments'>
  watchedValues: Partial<ParticipantFormData>
  caVisible: boolean
}) {
  return (
    <div className="space-y-6">
      <Card title="Activities of Daily Living" className="space-y-0">
        {adlFieldArray.fields.map((field, index) => {
          const type = field.adlType as AdlType
          const isFirstCommunity = index > 0 && (PERSONAL_ADL_TYPES as readonly string[]).includes(adlFieldArray.fields[index - 1].adlType) && !(PERSONAL_ADL_TYPES as readonly string[]).includes(type)
          const row = watchedValues.adlAssessments?.[index]
          return (
            <div key={field.id}>
              {isFirstCommunity && <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] pt-3">Community / Domestic</p>}
              <CompactGridRow
                label={ADL_TYPE_LABELS[type]}
                control={
                  <Controller
                    control={control}
                    name={`adlAssessments.${index}.level` as const}
                    render={({ field: f }) => (
                      <select aria-label={ADL_TYPE_LABELS[type]} value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value)}>
                        <option value="">Not assessed</option>
                        {ADL_LEVELS.map((l) => <option key={l} value={l}>{ADL_LEVEL_LABELS[l]}</option>)}
                      </select>
                    )}
                  />
                }
                expanded={row?.level ? (
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Notes" className="mb-0">
                      <input {...register(`adlAssessments.${index}.notes` as const)} />
                    </FormField>
                    {caVisible && (
                      <FormField label="How to Help Me" className="mb-0">
                        <input {...register(`adlAssessments.${index}.howToHelpNotes` as const)} />
                      </FormField>
                    )}
                  </div>
                ) : undefined}
              />
            </div>
          )
        })}
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Meals & Diet" className="space-y-4">
          <TextAreaField label="Meal Assistance" id="mealAssistanceDetail" rows={2} {...register('mealAssistanceDetail')} />
          <TextAreaField label="Choking Risk — Meal Management" id="chokingRiskMealDetail" rows={2} {...register('chokingRiskMealDetail')} />
          <FormField label="Modified Diet"><input id="modifiedDietDetail" {...register('modifiedDietDetail')} /></FormField>
          <FormField label="PEG Regime"><input id="pegRegimeMealDetail" {...register('pegRegimeMealDetail')} /></FormField>
          <FormField label="Special Utensils"><input id="specialUtensilsDetail" {...register('specialUtensilsDetail')} /></FormField>
          <TextAreaField label="Special Dietary Needs" id="specialDietaryNeedsDetail" rows={2} {...register('specialDietaryNeedsDetail')} />
          <FormField label="Favourite Breakfast"><input id="favouriteBreakfast" {...register('favouriteBreakfast')} /></FormField>
          <FormField label="Favourite Lunch"><input id="favouriteLunch" {...register('favouriteLunch')} /></FormField>
          <FormField label="Favourite Dinner"><input id="favouriteDinner" {...register('favouriteDinner')} /></FormField>
          <FormField label="Medication Tricks"><input id="medicationTricks" {...register('medicationTricks')} /></FormField>
          <FormField label="Foods Always Eaten"><input id="foodsAlwaysEaten" {...register('foodsAlwaysEaten')} /></FormField>
        </Card>

        <Card title="About Me" className="space-y-4">
          <TextAreaField label="Goals" id="goals" rows={2} {...register('goals')} />
          <TextAreaField label="Support Areas" id="supportAreas" rows={2} {...register('supportAreas')} />
          <TextAreaField label="Strengths / Fears" id="strengthsFears" rows={2} {...register('strengthsFears')} />
          <TextAreaField label="Things to Know" id="thingsToKnow" rows={2} {...register('thingsToKnow')} />
          <TextAreaField label="Who/What Is Important" id="whoIsImportant" rows={2} {...register('whoIsImportant')} />
          <TextAreaField label="Likes & Dislikes" id="likesDislikes" rows={2} {...register('likesDislikes')} />
        </Card>
      </div>
    </div>
  )
}
