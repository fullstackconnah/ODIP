import type { GroupActivityDto } from '@/api/types'
import type { ActivityLane } from '../lib/groupActivities'
import { isToday, rosterDayColumnsTemplate } from '../lib/roster'
import { GroupActivityCard } from './GroupActivityCard'

export type ActivityRowProps = {
  lane: ActivityLane
  days: string[]
  canWrite: boolean
  onOpen: (activity: GroupActivityDto) => void
}

/** "3 participants", "No participants yet", and the place after a middle dot when it is set. Attendees who did not attend are not counted. */
function captionText(activity: GroupActivityDto) {
  const n = activity.participants.filter(p => !p.didNotAttend).length
  const count = n === 0 ? 'No participants yet' : n === 1 ? '1 participant' : `${n} participants`
  return activity.location ? `${count} · ${activity.location}` : count
}

/**
 * One lane of the By activity view: ParticipantRow's row pattern (sticky first cell, a day strip on the same column template), with the lane's sessions drawn as the house GroupActivityCard.
 * Empty days stay blank: nothing is added from this view and nothing is dragged.
 */
export function ActivityRow({ lane, days, canWrite, onOpen }: ActivityRowProps) {
  const sessions = lane.activities.length
  return (
    <div className="contents">
      <div className="sticky left-0 z-10 flex min-h-14 flex-col justify-center border-b border-r border-border bg-card px-2 py-1.5">
        <p className="min-w-0 truncate font-display text-sm font-semibold leading-4 text-foreground" title={lane.label}>{lane.label}</p>
        <p className="truncate text-xs text-muted-foreground">{sessions === 1 ? '1 session' : `${sessions} sessions`}</p>
      </div>
      <div className="grid gap-x-1 gap-y-0.5 border-b border-border px-1" style={{ gridColumn: '2 / -1', gridTemplateColumns: rosterDayColumnsTemplate(days.length) }}>
        {days.map((day, i) => (
          <div
            key={day}
            data-activity-day={day}
            style={{ gridColumn: i + 1, gridRow: 1 }}
            className={`flex min-h-[calc(var(--row-h)_-_1px)] flex-col justify-center gap-1 rounded-sm px-0.5 py-0.5 ${isToday(day) ? 'bg-primary/5' : ''}`}
          >
            {lane.activities.filter(a => a.serviceDate === day).map(activity => (
              <div key={activity.id} className="flex min-w-0 flex-col gap-0.5">
                <GroupActivityCard activity={activity} canWrite={canWrite} onOpen={onOpen} />
                <p className="truncate px-0.5 text-xs text-muted-foreground" title={captionText(activity)}>{captionText(activity)}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
