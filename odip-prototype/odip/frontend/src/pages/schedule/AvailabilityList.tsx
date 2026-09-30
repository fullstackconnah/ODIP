import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/StatusBadge'
import { LEAVE_TYPE_LABELS, LEAVE_STATUS_COLORS } from '@/api/types/leave'
import { formatEffectiveRange } from '../rostering/lib/roster'
import type { ScheduleAvailabilityItemDto } from '@/api/types'

const availTypeColors: Record<string, string> = {
  Available:   'text-[var(--color-on-primary-fixed)] bg-[var(--color-primary-fixed)]/30',
  Unavailable: 'text-[var(--color-destructive)] bg-[var(--color-error-container)]/60',
  Leave:       'text-[var(--color-destructive)] bg-[var(--color-error-container)]/60',
  // #8e337b (the text color) has no token equivalent in index.css — left as a literal hex.
  // The background half (#ffd7ef) does match --color-accessible-container exactly.
  Training:    'text-[#8e337b] bg-[var(--color-accessible-container)]/60',
  Preferred:   'text-[var(--color-secondary)] bg-[var(--color-secondary-container)]/40',
  Tentative:   'text-[var(--color-on-warning-container)] bg-[var(--color-warning-container)]/60',
}

interface AvailabilityListProps {
  staffId: string
  availability: ScheduleAvailabilityItemDto[]
}

function timeShort(t: string) {
  return t.slice(0, 5)
}

function badgeForItem(item: ScheduleAvailabilityItemDto): { label: string; colorClass: string } {
  if (item.kind === 'Leave') {
    return {
      label: `Leave — ${LEAVE_TYPE_LABELS[item.leaveType!]}`,
      colorClass: availTypeColors.Leave,
    }
  }
  if (item.kind === 'RecurringRule') {
    return {
      label: 'Regular unavailability',
      colorClass: availTypeColors.Unavailable,
    }
  }
  return {
    label: item.availabilityType ?? '',
    colorClass: availTypeColors[item.availabilityType ?? ''] ?? 'text-[var(--color-muted-foreground)] bg-[var(--color-surface-container)]',
  }
}

function windowForItem(item: ScheduleAvailabilityItemDto): string {
  if (item.kind === 'RecurringRule') {
    return `${item.dayOfWeek} ${timeShort(item.startTime ?? '')}–${timeShort(item.endTime ?? '')}, ${formatEffectiveRange(item.startDate, item.endDate)}`
  }
  return formatEffectiveRange(item.startDate, item.endDate)
}

export default function AvailabilityList({ staffId, availability }: AvailabilityListProps) {
  const manageLink = `/rostering/leave?userId=${staffId}`

  return (
    <div className="pl-8 py-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide">Availability</p>
        <Link to={manageLink} className="text-xs text-[var(--color-primary)] hover:underline">
          Manage on Leave page →
        </Link>
      </div>
      <div className="space-y-2">
        {availability.length === 0 && (
          <p className="text-xs text-[var(--color-muted-foreground)] italic py-1">
            No leave, unavailability or availability records in this schedule window.{' '}
            <Link to={manageLink} className="text-[var(--color-primary)] hover:underline">Manage on Leave page →</Link>
          </p>
        )}
        {availability.map(item => {
          const { label, colorClass } = badgeForItem(item)
          return (
            <div key={item.id} className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold text-center ${colorClass}`}>
                {label}
              </span>
              <span className="text-[var(--color-muted-foreground)]">{windowForItem(item)}</span>
              {item.status !== null && (
                <StatusBadge status={item.status} colorMap={LEAVE_STATUS_COLORS} />
              )}
              {item.notes && (
                <span className="text-[var(--color-muted-foreground)] italic">{item.notes}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
