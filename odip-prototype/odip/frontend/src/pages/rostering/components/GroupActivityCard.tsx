import { useContext } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { AlertOctagon, AlertTriangle, Clock, MoreVertical, Users } from 'lucide-react'
import type { GroupActivityDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { ON_TINT, TONE } from '@/lib/tone'
import { formatShiftTimeRange } from '../lib/roster'
import { ActivityContext, isStaffShort, staffCountText } from '../lib/groupActivities'
import { DropStateContext, dropOutcome, firstName, isLockedShift, lockedWords, type DragCarry, type DropTarget } from '../lib/rosterDrag'
import { findingsSeverityLabel } from './ShiftChip'

export type GroupActivityCardProps = {
  activity: GroupActivityDto
  /** The participant whose row hosts this card: their times-differ glyph and the menu's "Remove {first name}". Absent in the By activity view, where no row hosts it. */
  participantId?: string
  canWrite: boolean
  /** Roster drag and drop is on for this row (Participant view, writers, md and up). */
  draggable?: boolean
  onOpen: (activity: GroupActivityDto) => void
}

/** The menu trigger's geometry, the same as ShiftChip's (a --control-h-sm square with TAP_AREA's pad), spelled as variants because Dropdown's icon trigger takes no className. */
const MENU_WRAP = 'relative z-[1] col-start-3 row-start-2 flex shrink-0 items-center pr-1 [&_button]:inline-flex [&_button]:h-[var(--control-h-sm)] [&_button]:w-[var(--control-h-sm)] [&_button]:items-center [&_button]:justify-center [&_button]:rounded-[var(--radius-sm)] [&_button]:p-0 [&_button]:relative [&_button]:before:absolute [&_button]:before:left-1/2 [&_button]:before:top-1/2 [&_button]:before:h-full [&_button]:before:w-full [&_button]:before:min-h-[var(--tap-min)] [&_button]:before:min-w-[var(--tap-min)] [&_button]:before:-translate-x-1/2 [&_button]:before:-translate-y-1/2'

/** "3 of 3 staff", and "3/3" when the tray's container is too narrow for the words (the accessible name keeps the words). */
function Count({ activity }: { activity: GroupActivityDto }) {
  return (
    <span className="truncate">
      <span className="@max-[180px]:hidden">{staffCountText(activity)}</span>
      <span className="hidden @max-[180px]:inline">{activity.staffAssigned}/{activity.staffNeeded}</span>
    </span>
  )
}

/**
 * A group activity on a participant's day (SHAPE section 2): a sibling of ShiftChip with the same two-row tray and height, its own fill (`--color-activity-container`, a category, never a state),
 * the Users glyph where a chip has its grip, and the staff count where a chip has its name. The whole card is the drop target of a join; the ring draws on the box only. Activities are never dragged.
 */
export function GroupActivityCard({ activity, participantId, canWrite, draggable = false, onOpen }: GroupActivityCardProps) {
  const board = useContext(ActivityContext)
  const { disabled: dragsOff, pending } = useContext(DropStateContext)
  const hostId = participantId ?? ''
  const target: DropTarget = { kind: 'activity', activity, participantId: hostId }
  const { setNodeRef, isOver, active } = useDroppable({ id: `drop-activity:${activity.id}:${hostId}`, data: target, disabled: !draggable || !canWrite })
  const overKind = isOver && active ? dropOutcome(active.data.current as DragCarry, target).kind : null
  const carrying = draggable && Boolean(active)
  const cancelled = activity.status === 'Cancelled'
  const locked = isLockedShift(activity)
  const draft = activity.status === 'Draft'
  const person = activity.participants.find(p => participantId !== undefined && p.participantId === participantId)
  const adding = pending?.targetId === activity.id
  const busy = board?.busyIds.has(activity.id) ?? false
  const short = !cancelled && isStaffShort(activity)
  // ACTIVITY_STAFF_SHORT never draws the marker: the pill is its marker.
  const findings = activity.findings.filter(f => f.code !== 'ACTIVITY_STAFF_SHORT')
  const hasFindings = findings.length > 0
  const hasBlocking = findings.some(f => f.severity === 'Blocking')
  const range = formatShiftTimeRange(activity.startTime, activity.endTime)
  const state = cancelled ? lockedWords('Cancelled') : locked ? lockedWords(activity.status) : draft ? 'Draft' : null
  const nameParts = [
    `Group activity, ${activity.title}`,
    activity.endsNextDay ? `${range}, ends the next day` : range,
    staffCountText(activity),
    short ? '1 short' : null,
    person?.timesDiffer ? 'times differ from agreement' : null,
    state,
  ].filter((part): part is string => Boolean(part))
  const openName = nameParts.join(', ')
  const hasMenu = canWrite && !adding && !carrying && !cancelled

  function handleOpenKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(activity) }
  }

  return (
    <div
      ref={setNodeRef}
      data-activity-card={activity.id}
      title={[...nameParts, ...findings.map(f => f.message)].join('\n')}
      aria-busy={adding || undefined}
      className={`group @container relative grid grid-cols-[auto_minmax(0,1fr)_auto] ${hasFindings ? 'grid-rows-[auto_var(--control-h)_auto]' : 'grid-rows-[auto_var(--control-h)]'} gap-y-0.5 rounded-sm border border-border ${cancelled ? 'bg-surface-container-low' : 'bg-[var(--color-activity-container)]'} p-0.5 text-[13px] ${overKind === 'locked' ? 'cursor-not-allowed' : ''} ${hasFindings ? 'my-2' : ''}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={openName}
        data-activity-open={activity.id}
        onClick={() => onOpen(activity)}
        onKeyDown={handleOpenKeyDown}
        className="col-span-full row-[1/span_2] grid grid-cols-subgrid grid-rows-subgrid rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="col-span-full flex h-4 min-w-0 items-center gap-0.5 px-0.5 text-xs">
          <span className={`shrink-0 font-medium tabular-nums ${cancelled ? 'text-muted-foreground line-through' : 'text-foreground'}`} title={activity.endsNextDay ? `${range} — ends the next day` : undefined}>{range}</span>
          {person?.timesDiffer && !cancelled && (
            <span className="shrink-0 text-muted-foreground" data-times-differ title="Times differ from agreement"><Clock className="h-3 w-3" aria-hidden="true" /></span>
          )}
          <span className={`min-w-0 flex-1 truncate text-right font-medium ${cancelled ? 'text-muted-foreground' : 'text-foreground'}`} data-activity-title>
            {draft && <span className={`pr-1 font-semibold ${TONE.warning.ink}`}>Draft</span>}
            {activity.title}
          </span>
        </span>
        <span
          data-activity-drop
          className={`col-span-full grid grid-cols-subgrid items-center rounded-[calc(var(--radius-sm)_-_2px)] border border-border bg-card ${overKind === 'join' ? 'ring-2 ring-ring' : ''}`}
        >
          <span className="col-start-1 ml-0.5 flex w-[18px] shrink-0 items-center justify-center text-[var(--color-on-activity-container)]" aria-hidden="true">
            <Users className="h-3.5 w-3.5" />
          </span>
          <span data-activity-count className={`col-start-2 flex min-w-0 items-center overflow-hidden pl-0.5 ${hasMenu ? '' : 'pr-1.5'}`}>
            {adding ? (
              <span className="truncate text-muted-foreground">Adding {firstName(pending?.staffName)}…</span>
            ) : cancelled ? (
              <span className="truncate text-muted-foreground">Cancelled</span>
            ) : short ? (
              <span className={`inline-flex min-w-0 items-center gap-0.5 rounded-full px-1.5 text-xs font-semibold leading-[18px] ${ON_TINT.warning}`}>
                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                <Count activity={activity} />
              </span>
            ) : (
              <span className="flex min-w-0 text-muted-foreground"><Count activity={activity} /></span>
            )}
          </span>
        </span>
      </div>

      {hasFindings && (
        <span className="pointer-events-none absolute -top-[10px] -right-1.5 z-10 flex h-3 w-3" role="img" aria-label={findingsSeverityLabel(findings)} title={findingsSeverityLabel(findings)}>
          {hasBlocking ? <AlertOctagon className="h-3 w-3 text-destructive" aria-hidden="true" /> : <AlertTriangle className="h-3 w-3 text-[var(--color-on-warning-container)]" aria-hidden="true" />}
        </span>
      )}

      {hasMenu && (
        <span className={MENU_WRAP}>
          <Dropdown
            variant="icon"
            icon={<MoreVertical className="h-3.5 w-3.5" />}
            label={`Actions for ${activity.title}`}
            items={[
              { value: 'open', label: 'Open activity' },
              ...(person ? [{ value: 'remove', label: `Remove ${firstName(person.participantName)} from activity`, disabled: busy || dragsOff }] : []),
            ]}
            onSelect={value => {
              if (value === 'open') onOpen(activity)
              else if (value === 'remove' && person && !busy) board?.removePerson(activity, person)
            }}
          />
        </span>
      )}
    </div>
  )
}
