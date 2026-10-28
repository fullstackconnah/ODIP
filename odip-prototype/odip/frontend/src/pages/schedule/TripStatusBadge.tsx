import { StatusBadge } from '@/components/StatusBadge'
import { TRIP_STATUS_LABELS } from '@/lib/tone'
import type { TripStatus } from '@/api/types/enums'

/**
 * A trip's status pill in the schedule header. Coloured by StatusBadge's tones (lib/tone.ts), the same as the trip detail header, the
 * dashboard and the trips list: a trip status is coloured one way everywhere.
 */
export default function TripStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} label={TRIP_STATUS_LABELS[status as TripStatus] ?? status} className="shrink-0 whitespace-nowrap" />
}
