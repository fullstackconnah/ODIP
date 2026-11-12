import { createContext } from 'react'
import type { GroupActivityDto, GroupActivityParticipantDto, ShiftDto } from '@/api/types'

/**
 * What the board hands its cells while the group-activities flag is on (SHAPE section 7). Outside a provider (flag off) there are no cards, no chip menu item and no activity drop target,
 * whatever the board DTO holds.
 */
export type ActivityBoardState = {
  byId: ReadonlyMap<string, GroupActivityDto>
  open: (activity: GroupActivityDto) => void
  /** Detach one participant (all of their shifts) from the activity: the card menu's "Remove {first name} from activity". */
  removePerson: (activity: GroupActivityDto, person: GroupActivityParticipantDto) => void
  /** The chip menu's "Add to an activity…" for an unattached group-line shift. */
  addShift: (shift: ShiftDto) => void
  /** The activities whose participant or staff write is out, so a card disables its menu. */
  busyIds: ReadonlySet<string>
}
export const ActivityContext = createContext<ActivityBoardState | null>(null)

/** Order a day's chips and cards by start time (a card at its own start). */
export type DayItem = { kind: 'shift'; shift: ShiftDto } | { kind: 'activity'; activity: GroupActivityDto; participantId: string }

/** A day cell's items: shifts attached to a known activity draw as one card (a 2:1 participant once), the rest as chips; all by start time. */
export function dayItems(shifts: ShiftDto[], byId: ReadonlyMap<string, GroupActivityDto> | undefined): DayItem[] {
  const items: DayItem[] = []
  const seen = new Set<string>()
  for (const shift of shifts) {
    const activity = shift.groupActivityId ? byId?.get(shift.groupActivityId) : undefined
    if (!activity) items.push({ kind: 'shift', shift })
    else if (!seen.has(`${activity.id}:${shift.participantId}`)) {
      seen.add(`${activity.id}:${shift.participantId}`)
      items.push({ kind: 'activity', activity, participantId: shift.participantId })
    }
  }
  const start = (i: DayItem) => (i.kind === 'shift' ? i.shift.startTime : i.activity.startTime)
  return items.map((item, index) => ({ item, index })).sort((a, b) => start(a.item).localeCompare(start(b.item)) || a.index - b.index).map(x => x.item)
}

/** The card's count words: "3 of 3 staff", or "No staff yet" when nobody is on it and none is needed. */
export function staffCountText(activity: Pick<GroupActivityDto, 'staffNeeded' | 'staffAssigned'>): string {
  return activity.staffNeeded === 0 && activity.staffAssigned === 0 ? 'No staff yet' : `${activity.staffAssigned} of ${activity.staffNeeded} staff`
}

export const isStaffShort = (activity: Pick<GroupActivityDto, 'findings'>) => activity.findings.some(f => f.code === 'ACTIVITY_STAFF_SHORT')

/** The confirm before taking one person off an activity (modal X, staff X, card menu). DetachShift keeps a participant's shift on the board as a regular shift. */
export function removeFromActivityCopy(kind: 'participant' | 'staff', first: string, activityTitle: string) {
  return {
    title: `Remove ${first} from ${activityTitle}?`,
    message: kind === 'participant' ? 'Their shift stays on the board as a regular shift.' : `${first} comes off this activity.`,
  }
}

export type ActivityLane = { key: string; label: string; activities: GroupActivityDto[] }

const sessionOrder = (a: GroupActivityDto, b: GroupActivityDto) => a.serviceDate.localeCompare(b.serviceDate) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id)

/** The By activity view's lanes: one per activity name (the library name, else the title), A to Z; each lane's sessions by date, start time, then id, and its label taken from the earliest. */
export function activityLanes(activities: readonly GroupActivityDto[]): ActivityLane[] {
  const byKey = new Map<string, GroupActivityDto[]>()
  for (const a of [...activities].sort(sessionOrder)) {
    const key = (a.activityName ?? a.title).trim().toLocaleLowerCase('en-AU')
    byKey.set(key, [...(byKey.get(key) ?? []), a])
  }
  return [...byKey].map(([key, list]) => ({ key, label: (list[0].activityName ?? list[0].title).trim(), activities: list }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en-AU', { sensitivity: 'base' }))
}
