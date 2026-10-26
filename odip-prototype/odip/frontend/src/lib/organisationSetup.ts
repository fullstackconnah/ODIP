import { currentTenantId } from '@/api/hooks/settings'
import type { ProviderSettingsDto, SetupStatusDto } from '@/api/types'
import { calendarDaysUntil } from './dateOnly'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']

/** The one rule for "organisation details are recorded": the legal name, an address and a valid state. */
export const organisationDetailsRecorded = (provider?: ProviderSettingsDto | null) =>
  !!provider?.organisationName?.trim() && !!provider?.address?.trim() && STATES.includes(provider?.state ?? '')

const hiddenKey = () => `bunya-setup-hidden:${currentTenantId() ?? 'none'}`

/** Hiding is per device and organisation; a blocked store just means the card shows. */
export function isSetupHidden(): boolean {
  try { return localStorage.getItem(hiddenKey()) === '1' } catch { return false }
}

export function setSetupHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(hiddenKey(), '1')
    else localStorage.removeItem(hiddenKey())
  } catch { /* the card simply shows */ }
}

export type SetupCard = 'waiting' | 'none' | 'steps' | 'done'

/** `today` is the viewer's date-only. Until a week is published the steps show; for the rest of that week a one-line done card; then nothing. */
export function setupCard(
  status: SetupStatusDto | undefined,
  phase: { waiting: boolean; failed: boolean },
  today: string,
): SetupCard {
  if (phase.waiting) return 'waiting'
  if (phase.failed || !status) return 'none'
  if (status.firstPublishedWeekStart === null) return 'steps'
  const daysSinceWeekStart = -(calendarDaysUntil(status.firstPublishedWeekStart, today) ?? -Infinity)
  return daysSinceWeekStart < 7 ? 'done' : 'none'
}
