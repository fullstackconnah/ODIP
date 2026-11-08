import { useGroupStaffReviews, useApproveGroupStaffRows, type ApproveBatchResultDto } from '@/api/hooks'
import type { GroupStaffReviewDto } from '@/api/types'
import { formatDayMonth } from '@/lib/dateRange'
import type { Tone } from '@/lib/tone'
import { formatWithTimeZone } from '@/lib/utils'
import { formatShiftTimeRange } from '@/pages/rostering/lib/roster'
import { groupPhase, type GroupModel, type QuickRow } from '../quickGroupModel'

const FALLBACK_ZONE = 'Australia/Sydney'

/** A staff row's review flags, the words and tones of GroupStaffReviewSection (the first two are drawn). */
export function groupStaffFlags(r: GroupStaffReviewDto): Array<{ label: string; tone: Tone }> {
  const flags: Array<{ label: string; tone: Tone }> = []
  if (r.offRoster) flags.push({ label: 'Off roster', tone: 'warning' })
  if (r.locationCheck === 'NotAtLocation') flags.push({ label: 'Off site', tone: 'warning' })
  if (!r.payrollLinked) flags.push({ label: 'No payroll ID', tone: 'danger' })
  if (r.adjustmentReason) flags.push({ label: 'Edited', tone: 'info' })
  return flags
}

/** The Group activities group (SHAPE-PAYROLL §B): finished staff rows awaiting approval, approved with the review section's own hook. */
export function useGroupStaffGroup(enabled: boolean): GroupModel {
  // shortcut: the review list is capped at 200 rows by the server, so Complete all covers those; page it if a tenant's backlog passes that.
  const queue = useGroupStaffReviews({ enabled })
  const approve = useApproveGroupStaffRows()
  const finished = (queue.data?.rows ?? []).filter((r) => r.state === 'Finished')

  const rows = finished.map((r): QuickRow => {
    const day = formatDayMonth(r.serviceDate)
    const zone = r.timeZoneId || FALLBACK_ZONE
    const time = (iso: string) => formatWithTimeZone(iso, zone, { timeStyle: 'short' })
    const what = `${r.staffName} at ${r.activityTitle}, ${day}`
    return {
      id: r.rowId,
      subject: r.staffName,
      facts: [
        r.activityTitle,
        `${day}, ${r.actualStart ? time(r.actualStart) : '…'} – ${r.actualEnd ? time(r.actualEnd) : '…'}`,
        `Planned ${formatShiftTimeRange(r.startTime, r.endTime)}`,
      ],
      flags: groupStaffFlags(r),
      actions: [
        groupStaffFlags(r).length === 0
          ? { kind: 'tap', label: 'Approve', busyLabel: 'Approving…', name: `Approve hours: ${what}`, failText: "Couldn't approve. Try again.",
              run: async () => {
                const [result] = await approve.mutateAsync([r.rowId])
                if (!result?.ok) throw new Error(result?.message ?? 'Not approved')
                return { announce: `Approved ${r.staffName}'s hours at ${r.activityTitle} on ${day}.` }
              } }
          // A flagged row needs judgement: the full page, whose review section shows every flag.
          : { kind: 'link', label: 'Review', name: `Review hours: ${what}`, to: '/rostering/completions' },
      ],
    }
  })

  return {
    key: 'groupStaff',
    title: 'Group activities',
    noun: 'group activity hours',
    subjectHeader: 'Staff',
    columns: [{ header: 'Activity', long: true }, { header: 'Hours' }, { header: 'Planned' }],
    phase: groupPhase(queue),
    refetch: () => { void queue.refetch() },
    readAt: queue.dataUpdatedAt,
    count: finished.length,
    rows,
    link: { to: '/rostering/completions', openLabel: 'Open completions' },
    approveBatch: async (ids) => (await approve.mutateAsync(ids)).map((o): ApproveBatchResultDto => ({ shiftId: o.rowId, approved: o.ok, code: o.code, message: o.message })),
  }
}
