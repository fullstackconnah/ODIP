import {
  useApproveLeave, useApproveUnavailability, useDeclineLeave, useDeclineUnavailability, useLeaveRequests, useRecurringUnavailabilities,
  LEAVE_TYPE_LABELS, type OverlapShiftDto, type RosterFindingDto,
} from '@/api/hooks'
import { calendarDaysUntil } from '@/lib/dateOnly'
import { formatDateRange, formatDayMonth } from '@/lib/dateRange'
import { plural } from '@/lib/format'
import { rosterLink } from '@/lib/rosterLinks'
import { formatShiftTime } from '@/lib/utils'
import { groupPhase, type ActionOutcome, type GroupModel, type QuickForm, type QuickRow } from '../quickGroupModel'

const firstName = (name: string) => name.split(' ')[0]

/**
 * What an approval that overlaps the roster says, from the server's own result. Shifts come from `overlapShifts`; a LEAVE approval raised a cover task for
 * each (LeaveController.RaiseLeaveCoverageTasksAsync), an unavailability approval raises none. Trips come from the TRIP_OVERLAP findings. Null: nothing overlaps.
 */
export function overlapNotice(
  kind: 'leave' | 'unavailability',
  person: string,
  result: { overlaps: RosterFindingDto[]; overlapShifts: OverlapShiftDto[] },
): ActionOutcome['notice'] | null {
  if (result.overlaps.length === 0) return null
  // The Leave page guards it the same way (LeaveApprovalsPage: `result.overlapShifts ?? []`): a throw here would land AFTER the server approved.
  const overlapShifts = result.overlapShifts ?? []
  const shifts = overlapShifts.length
  const trips = result.overlaps.filter((finding) => finding.code === 'TRIP_OVERLAP').length
  const parts = [kind === 'leave' ? 'Leave approved.' : 'Unavailability approved.']
  if (shifts > 0) {
    parts.push(kind === 'unavailability' ? `It overlaps ${plural(shifts, 'shift')}.`
      : shifts === 1 ? 'It overlaps 1 shift, and it has a cover task.' : `It overlaps ${shifts} shifts, and each one has a cover task.`)
  }
  if (trips > 0) parts.push(`It ${shifts > 0 ? 'also ' : ''}overlaps ${plural(trips, 'trip')}.`)
  if (shifts === 0 && trips === 0) parts.push('It overlaps the roster.')
  return { title: person, message: parts.join(' '), link: { label: 'Open roster', to: overlapRosterLink(overlapShifts) } }
}

/** The board at the first overlapped shift's week, filtered to its participant when every shift is theirs; otherwise the whole board. */
export function overlapRosterLink(overlapShifts: OverlapShiftDto[]): string {
  const first = [...overlapShifts].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate))[0]
  const oneParticipant = new Set(overlapShifts.map((s) => s.participantId)).size === 1
  return first && oneParticipant ? rosterLink(first.serviceDate, first.participantId) : '/rostering'
}

/** An approval's overlap counts, for a bulk run's one rolled-up notice. */
const overlapOf = (kind: 'leave' | 'unavailability', result: { overlaps: RosterFindingDto[]; overlapShifts: OverlapShiftDto[] }) =>
  ({ kind, shifts: result.overlapShifts ?? [], trips: result.overlaps.filter((finding) => finding.code === 'TRIP_OVERLAP').length })

const declineForm = (person: string, submit: QuickForm['submit']): QuickForm => ({
  field: 'textarea', label: 'Reason (optional)', hint: `${firstName(person)} sees this.`,
  submitLabel: 'Decline request', busyLabel: 'Declining…', danger: true, failText: "Couldn't decline it. Try again.", submit,
})

/** The Leave group (SHAPE §5): pending leave and unavailability, soonest start first, decided with the Leave page's own mutation hooks. */
export function useLeaveGroup(enabled: boolean, viewerId: string | null): GroupModel {
  // The nav badge's own requests and cache keys (usePendingLeaveQueue), so one fetch serves both.
  const leave = useLeaveRequests({ status: 'Pending' }, { enabled })
  const unavailability = useRecurringUnavailabilities({ status: 'Pending' }, { enabled })
  const approveLeave = useApproveLeave()
  const declineLeave = useDeclineLeave()
  const approveUnavailability = useApproveUnavailability()
  const declineUnavailability = useDeclineUnavailability()

  const leaveRows = (leave.data ?? []).map((r): { start: string; row: QuickRow } => {
    const range = formatDateRange(r.startDate, r.endDate)
    const days = (calendarDaysUntil(r.endDate, r.startDate) ?? 0) + 1
    // Deciding your own request, either way, is the conflict (spec): it is shown, never decided here. The full Leave page is unchanged.
    const own = r.userId === viewerId
    return { start: r.startDate, row: {
      id: `leave:${r.id}`,
      subject: r.userFullName,
      facts: [`${LEAVE_TYPE_LABELS[r.leaveType]} leave`, `${range}, ${plural(days, 'day')}`, r.reason && `“${r.reason}”`],
      flags: own ? [{ label: 'Your request', tone: 'neutral' }] : [],
      actions: own ? [] : [
        { kind: 'form', label: 'Decline', name: `Decline leave: ${r.userFullName}, ${range}`, form: declineForm(r.userFullName, async (note) => {
          await declineLeave.mutateAsync({ id: r.id, data: { decisionNote: note.trim() } })
          return { announce: `Declined ${r.userFullName}'s leave, ${range}.` }
        }) },
        { kind: 'tap', label: 'Approve', busyLabel: 'Approving…', name: `Approve leave: ${r.userFullName}, ${range}`, failText: "Couldn't approve. Try again.",
          run: async () => {
            const result = await approveLeave.mutateAsync(r.id)
            const notice = overlapNotice('leave', r.userFullName, result)
            return notice ? { notice, overlap: overlapOf('leave', result) } : { announce: `Approved ${r.userFullName}'s leave, ${range}.` }
          } },
      ],
    } }
  })

  const ruleRows = (unavailability.data ?? []).map((r): { start: string; row: QuickRow } => {
    const when = `${r.dayOfWeek}s`
    const from = formatDayMonth(r.effectiveFrom)
    const own = r.userId === viewerId
    return { start: r.effectiveFrom, row: {
      id: `unavailability:${r.id}`,
      subject: r.userFullName,
      // The Leave page's word for a rule.
      facts: ['Regular unavailability', [when, `${formatShiftTime(r.startTime)} – ${formatShiftTime(r.endTime)}`, from && `from ${from}`].filter(Boolean).join(', '), r.notes && `“${r.notes}”`],
      flags: own ? [{ label: 'Your request', tone: 'neutral' }] : [],
      actions: own ? [] : [
        { kind: 'form', label: 'Decline', name: `Decline unavailability: ${r.userFullName}, ${when}`, form: declineForm(r.userFullName, async (note) => {
          await declineUnavailability.mutateAsync({ id: r.id, data: { decisionNote: note.trim() } })
          return { announce: `Declined ${r.userFullName}'s unavailability, ${when} from ${from}.` }
        }) },
        { kind: 'tap', label: 'Approve', busyLabel: 'Approving…', name: `Approve unavailability: ${r.userFullName}, ${when}`, failText: "Couldn't approve. Try again.",
          run: async () => {
            const result = await approveUnavailability.mutateAsync(r.id)
            const notice = overlapNotice('unavailability', r.userFullName, result)
            return notice ? { notice, overlap: overlapOf('unavailability', result) } : { announce: `Approved ${r.userFullName}'s unavailability, ${when} from ${from}.` }
          } },
      ],
    } }
  })

  return {
    key: 'leave',
    title: 'Leave',
    noun: 'leave requests',
    subjectHeader: 'Staff',
    columns: [{ header: 'Type' }, { header: 'Dates' }, { header: 'Note', long: true }],
    phase: groupPhase(leave, unavailability),
    refetch: () => { void leave.refetch(); void unavailability.refetch() },
    count: (leave.data?.length ?? 0) + (unavailability.data?.length ?? 0),
    // Soonest start first: the nearest one is the most urgent decision (SHAPE §5).
    rows: [...leaveRows, ...ruleRows].sort((a, b) => a.start.localeCompare(b.start)).map((r) => r.row),
    link: { to: '/rostering/leave', openLabel: 'Open Leave' },
  }
}
