import { useState } from 'react'
import type { AxiosError } from 'axios'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { SectionEditPanel } from './SectionEditPanel'
import type { ParticipantDetailDto } from '@/api/types/participants'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

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
    <SectionEditPanel title="Meals & Diet" className="md:col-span-2" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
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
          <div className="grid md:grid-cols-3 gap-4">
            <FormField label="Favourite Breakfast" className="mb-0">
              <input value={draft.favouriteBreakfast} onChange={(e) => setDraft((d) => ({ ...d, favouriteBreakfast: e.target.value }))} />
            </FormField>
            <FormField label="Favourite Lunch" className="mb-0">
              <input value={draft.favouriteLunch} onChange={(e) => setDraft((d) => ({ ...d, favouriteLunch: e.target.value }))} />
            </FormField>
            <FormField label="Favourite Dinner" className="mb-0">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          {p.mealAssistanceDetail && (<><span className="text-[var(--color-muted-foreground)]">Meal Assistance</span><span className="whitespace-pre-line">{p.mealAssistanceDetail}</span></>)}
          {p.chokingRiskMealDetail && (<><span className="text-[var(--color-muted-foreground)]">Choking Risk — Meal Management</span><span className="whitespace-pre-line">{p.chokingRiskMealDetail}</span></>)}
          {p.modifiedDietDetail && (<><span className="text-[var(--color-muted-foreground)]">Modified Diet</span><span className="whitespace-pre-line">{p.modifiedDietDetail}</span></>)}
          {p.pegRegimeMealDetail && (<><span className="text-[var(--color-muted-foreground)]">PEG Regime</span><span className="whitespace-pre-line">{p.pegRegimeMealDetail}</span></>)}
          {p.specialUtensilsDetail && (<><span className="text-[var(--color-muted-foreground)]">Special Utensils</span><span className="whitespace-pre-line">{p.specialUtensilsDetail}</span></>)}
          {p.specialDietaryNeedsDetail && (<><span className="text-[var(--color-muted-foreground)]">Special Dietary Needs</span><span className="whitespace-pre-line">{p.specialDietaryNeedsDetail}</span></>)}
          {(p.favouriteBreakfast || p.favouriteLunch || p.favouriteDinner) && (
            <>
              <span className="text-[var(--color-muted-foreground)]">Favourite Meals</span>
              <span className="whitespace-pre-line">
                {[p.favouriteBreakfast && `Breakfast: ${p.favouriteBreakfast}`, p.favouriteLunch && `Lunch: ${p.favouriteLunch}`, p.favouriteDinner && `Dinner: ${p.favouriteDinner}`].filter(Boolean).join('\n')}
              </span>
            </>
          )}
          {p.medicationTricks && (<><span className="text-[var(--color-muted-foreground)]">Medication Tricks</span><span className="whitespace-pre-line">{p.medicationTricks}</span></>)}
          {p.foodsAlwaysEaten && (<><span className="text-[var(--color-muted-foreground)]">Foods Always Eaten</span><span className="whitespace-pre-line">{p.foodsAlwaysEaten}</span></>)}
        </div>
      )}
    </SectionEditPanel>
  )
}

export default ParticipantMealsDietSection
