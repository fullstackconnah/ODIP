import { statusClass } from '@/lib/tone'

/**
 * A trip's status pill in the schedule header. Coloured by StatusBadge's tones (lib/tone.ts), the same as the trip detail header, the
 * dashboard and the trips list: a trip status is coloured one way everywhere.
 */
export default function TripStatusBadge({ status }: { status: string }) {
  // 12px, sentence case: the shared badge size (StatusBadge) instead of the old 10px tracked-uppercase pill.
  return (
    <span className={`shrink-0 whitespace-nowrap text-xs px-2 py-0.5 rounded-full font-semibold ${statusClass(status)}`}>
      {status.replace(/([A-Z])/g, ' $1').trim()}
    </span>
  )
}
