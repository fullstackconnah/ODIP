import { NIGHT_TYPE_LABELS, RATIO_LABELS } from '@/pages/rostering/lib/roster'

/** OvernightSupportType shares its first four values with SleepoverType (see NIGHT_TYPE_LABELS) plus one extra. */
export const OVERNIGHT_SUPPORT_LABELS: Record<string, string> = {
  ...NIGHT_TYPE_LABELS,
  SleepoverSupport: 'Sleepover Support',
}

export { RATIO_LABELS }
