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
import { formGrid, span } from '@/lib/formGrid'

export function DailyLivingStep({ control, register, adlFieldArray, watchedValues, caVisible }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  adlFieldArray: UseFieldArrayReturn<ParticipantFormData, 'adlAssessments'>
  watchedValues: Partial<ParticipantFormData>
  caVisible: boolean
}) {
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
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

      <div className="grid md:grid-cols-2 gap-[var(--section-gap)] items-start">
        <Card title="Meals & Diet">
          <div className={formGrid}>
            <TextAreaField label="Meal Assistance" id="mealAssistanceDetail" rows={2} {...register('mealAssistanceDetail')} className={span.long} />
            <TextAreaField label="Choking Risk — Meal Management" id="chokingRiskMealDetail" rows={2} {...register('chokingRiskMealDetail')} className={span.long} />
            <FormField label="Modified Diet" className={span.medium}><input id="modifiedDietDetail" {...register('modifiedDietDetail')} /></FormField>
            <FormField label="PEG Regime" className={span.medium}><input id="pegRegimeMealDetail" {...register('pegRegimeMealDetail')} /></FormField>
            <FormField label="Special Utensils" className={span.medium}><input id="specialUtensilsDetail" {...register('specialUtensilsDetail')} /></FormField>
            <TextAreaField label="Special Dietary Needs" id="specialDietaryNeedsDetail" rows={2} {...register('specialDietaryNeedsDetail')} className={span.long} />
            <FormField label="Favourite Breakfast" className={span.medium}><input id="favouriteBreakfast" {...register('favouriteBreakfast')} /></FormField>
            <FormField label="Favourite Lunch" className={span.medium}><input id="favouriteLunch" {...register('favouriteLunch')} /></FormField>
            <FormField label="Favourite Dinner" className={span.medium}><input id="favouriteDinner" {...register('favouriteDinner')} /></FormField>
            <FormField label="Medication Tricks" className={span.medium}><input id="medicationTricks" {...register('medicationTricks')} /></FormField>
            <FormField label="Foods Always Eaten" className={span.medium}><input id="foodsAlwaysEaten" {...register('foodsAlwaysEaten')} /></FormField>
          </div>
        </Card>

        <Card title="About Me">
          <div className={formGrid}>
            <TextAreaField label="Goals" id="goals" rows={2} {...register('goals')} className={span.long} />
            <TextAreaField label="Support Areas" id="supportAreas" rows={2} {...register('supportAreas')} className={span.long} />
            <TextAreaField label="Strengths / Fears" id="strengthsFears" rows={2} {...register('strengthsFears')} className={span.long} />
            <TextAreaField label="Things to Know" id="thingsToKnow" rows={2} {...register('thingsToKnow')} className={span.long} />
            <TextAreaField label="Who/What Is Important" id="whoIsImportant" rows={2} {...register('whoIsImportant')} className={span.long} />
            <TextAreaField label="Likes & Dislikes" id="likesDislikes" rows={2} {...register('likesDislikes')} className={span.long} />
          </div>
        </Card>
      </div>
    </div>
  )
}
