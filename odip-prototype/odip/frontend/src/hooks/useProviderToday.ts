import { useProviderSettings } from '@/api/hooks'
import { todayInZone } from '@/lib/dateOnly'
import { ZONES } from '@/pages/settings/timeZones'

/**
 * Today's date as "YYYY-MM-DD" on the provider's (organisation's) calendar: its saved time zone, else its State's default, as the server
 * resolves it (Sydney when it has no settings or State). The browser's day until the settings arrive, and for a role that may not read them (pass `enabled` false: provider settings are
 * SuperAdmin, Admin and Coordinator only). Not re-read at midnight; the screens that use it are short forms.
 */
export function useProviderToday(enabled = true): string {
  const row = useProviderSettings(enabled).data
  if (row === undefined) return todayInZone(undefined)
  const state = (row?.state ?? '').toUpperCase()
  return todayInZone(row?.timeZoneId || ZONES.find(z => z.states.includes(state))?.value || 'Australia/Sydney')
}
