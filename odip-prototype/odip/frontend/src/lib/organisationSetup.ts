import { currentTenantId } from '@/api/hooks/settings'
import type { ProviderSettingsDto, SetupStatusDto } from '@/api/types'
import { calendarDaysUntil } from './dateOnly'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]

/** 11 digits once spaces are removed, and the standard ABN checksum (first digit less 1, weighted sum divisible by 89). */
export function isValidAbn(abn?: string | null): boolean {
  const digits = (abn ?? '').replace(/ /g, '')
  if (!/^[0-9]{11}$/.test(digits)) return false
  const sum = ABN_WEIGHTS.reduce((total, weight, i) => total + weight * (Number(digits[i]) - (i === 0 ? 1 : 0)), 0)
  return sum % 89 === 0
}

/** The one rule for "organisation details are recorded": the legal name, an address, a valid state and a valid ABN. The registration number stays optional. */
export const organisationDetailsRecorded = (provider?: ProviderSettingsDto | null) =>
  !!provider?.organisationName?.trim() && !!provider?.address?.trim() && STATES.includes(provider?.state ?? '') && isValidAbn(provider?.abn)

/** The one short line for a step that waits on the ABN; null once the ABN is valid. */
export const organisationDetailsHint = (provider?: ProviderSettingsDto | null) =>
  isValidAbn(provider?.abn) ? null : provider?.abn?.trim() ? 'Check your ABN to finish this step.' : 'Add your ABN to finish this step.'

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
