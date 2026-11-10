import type { OnboardingItemKey } from '@/api/types'

/** The Onboarding checklist's own words for each item: the Settings form and the Settings history read the same. */
export const ITEM_LABELS: Record<OnboardingItemKey, string> = {
  complaints: 'Told how to make a complaint',
  rights: 'Rights explained',
  myProvider: 'Recorded as my provider',
  budget: 'Plan budget added',
}
