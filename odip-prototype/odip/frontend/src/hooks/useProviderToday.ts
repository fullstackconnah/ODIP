import { useProviderTodayQuery } from '@/api/hooks'
import { todayInZone } from '@/lib/dateOnly'

/**
 * Today's date as "YYYY-MM-DD" on the provider's (organisation's) calendar, as the server works it out, for every role. The browser's day
 * while it loads or if the read fails. Not re-read at midnight; the screens that use it are short forms.
 */
export function useProviderToday(): string {
  return useProviderTodayQuery().data?.date ?? todayInZone(undefined)
}
