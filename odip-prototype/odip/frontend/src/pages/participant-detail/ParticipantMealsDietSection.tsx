import { useState } from 'react'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { FactList } from '@/components/FactList'
import { formGrid, span } from '@/lib/formGrid'
import { SectionEditPanel } from './SectionEditPanel'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { extractErrorMessage } from '@/lib/utils'

const pl = (v?: string | null) => (v ? <span className="whitespace-pre-line">{v}</span> : undefined)

/** PD-7: Meals & Diet card — CORE-02's `mealsAndDiet` group, fully rendered (all 11 fields optional, no merge needed). */
type MealsDietDraft = {
  mealAssistanceDetail: string; chokingRiskMealDetail: string; modifiedDietDetail: string; pegRegimeMealDetail: string
  specialUtensilsDetail: string; specialDietaryNeedsDetail: string
  favouriteBreakfast: string; favouriteLunch: string; favouriteDinner: string
  medicationTricks: string; foodsAlwaysEaten: string
}

function readMealsDiet(p: ParticipantDetailDto): MealsDietDraft {
  return {
    mealAssistanceDetail: p.mealAssistanceDetail ?? '', chokingRiskMealDetail: p.chokingRiskMealDetail ?? '',
    modifiedDietDetail: p.modifiedDietDetail ?? '', pegRegimeMealDetail: p.pegRegimeMealDetail ?? '',
    specialUtensilsDetail: p.specialUtensilsDetail ?? '', specialDietaryNeedsDetail: p.specialDietaryNeedsDetail ?? '',
    favouriteBreakfast: p.favouriteBreakfast ?? '', favouriteLunch: p.favouriteLunch ?? '', favouriteDinner: p.favouriteDinner ?? '',
    medicationTricks: p.medicationTricks ?? '', foodsAlwaysEaten: p.foodsAlwaysEaten ?? '',
  }
}

export function ParticipantMealsDietSection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const saved = readMealsDiet(p)
  const [draft, setDraft] = useState<MealsDietDraft>(saved)
  const isDirty = (Object.keys(saved) as (keyof MealsDietDraft)[]).some((k) => draft[k] !== saved[k])

  const hasAnyData = !!(p.mealAssistanceDetail || p.chokingRiskMealDetail || p.modifiedDietDetail || p.pegRegimeMealDetail
    || p.specialUtensilsDetail || p.specialDietaryNeedsDetail || p.favouriteBreakfast || p.favouriteLunch
    || p.favouriteDinner || p.medicationTricks || p.foodsAlwaysEaten)

  if (!canEdit && !hasAnyData) return null

  async function handleSave() {
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          mealsAndDiet: {
            mealAssistanceDetail: draft.mealAssistanceDetail.trim() || null,
            chokingRiskMealDetail: draft.chokingRiskMealDetail.trim() || null,
            modifiedDietDetail: draft.modifiedDietDetail.trim() || null,
            pegRegimeMealDetail: draft.pegRegimeMealDetail.trim() || null,
            specialUtensilsDetail: draft.specialUtensilsDetail.trim() || null,
            specialDietaryNeedsDetail: draft.specialDietaryNeedsDetail.trim() || null,
            favouriteBreakfast: draft.favouriteBreakfast.trim() || null,
            favouriteLunch: draft.favouriteLunch.trim() || null,
            favouriteDinner: draft.favouriteDinner.trim() || null,
            medicationTricks: draft.medicationTricks.trim() || null,
            foodsAlwaysEaten: draft.foodsAlwaysEaten.trim() || null,
          },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Meals & Diet.'))
    }
  }

  return (
    <SectionEditPanel title="Meals & Diet" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className="space-y-4">
          <FormField label="Meal Assistance">
            <textarea value={draft.mealAssistanceDetail} onChange={(e) => setDraft((d) => ({ ...d, mealAssistanceDetail: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Choking Risk — Meal Management">
            <textarea value={draft.chokingRiskMealDetail} onChange={(e) => setDraft((d) => ({ ...d, chokingRiskMealDetail: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Modified Diet">
            <textarea value={draft.modifiedDietDetail} onChange={(e) => setDraft((d) => ({ ...d, modifiedDietDetail: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="PEG Regime">
            <textarea value={draft.pegRegimeMealDetail} onChange={(e) => setDraft((d) => ({ ...d, pegRegimeMealDetail: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Special Utensils">
            <textarea value={draft.specialUtensilsDetail} onChange={(e) => setDraft((d) => ({ ...d, specialUtensilsDetail: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Special Dietary Needs">
            <textarea value={draft.specialDietaryNeedsDetail} onChange={(e) => setDraft((d) => ({ ...d, specialDietaryNeedsDetail: e.target.value }))} rows={2} />
          </FormField>
          <div className={formGrid}>
            <FormField label="Favourite Breakfast" className={`mb-0 ${span.short}`}>
              <input value={draft.favouriteBreakfast} onChange={(e) => setDraft((d) => ({ ...d, favouriteBreakfast: e.target.value }))} />
            </FormField>
            <FormField label="Favourite Lunch" className={`mb-0 ${span.short}`}>
              <input value={draft.favouriteLunch} onChange={(e) => setDraft((d) => ({ ...d, favouriteLunch: e.target.value }))} />
            </FormField>
            <FormField label="Favourite Dinner" className={`mb-0 ${span.short}`}>
              <input value={draft.favouriteDinner} onChange={(e) => setDraft((d) => ({ ...d, favouriteDinner: e.target.value }))} />
            </FormField>
          </div>
          <FormField label="Medication Tricks">
            <textarea value={draft.medicationTricks} onChange={(e) => setDraft((d) => ({ ...d, medicationTricks: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Foods Always Eaten">
            <textarea value={draft.foodsAlwaysEaten} onChange={(e) => setDraft((d) => ({ ...d, foodsAlwaysEaten: e.target.value }))} rows={2} />
          </FormField>
        </div>
      ) : (
        <FactList
          items={[
            { label: 'Meal Assistance', value: pl(p.mealAssistanceDetail) },
            { label: 'Choking Risk — Meal Management', value: pl(p.chokingRiskMealDetail) },
            { label: 'Modified Diet', value: pl(p.modifiedDietDetail) },
            { label: 'PEG Regime', value: pl(p.pegRegimeMealDetail) },
            { label: 'Special Utensils', value: pl(p.specialUtensilsDetail) },
            { label: 'Special Dietary Needs', value: pl(p.specialDietaryNeedsDetail) },
            {
              label: 'Favourite Meals',
              value: pl([p.favouriteBreakfast && `Breakfast: ${p.favouriteBreakfast}`, p.favouriteLunch && `Lunch: ${p.favouriteLunch}`, p.favouriteDinner && `Dinner: ${p.favouriteDinner}`].filter(Boolean).join('\n')),
            },
            { label: 'Medication Tricks', value: pl(p.medicationTricks) },
            { label: 'Foods Always Eaten', value: pl(p.foodsAlwaysEaten) },
          ].filter((item) => item.value)}
        />
      )}
    </SectionEditPanel>
  )
}

export default ParticipantMealsDietSection
