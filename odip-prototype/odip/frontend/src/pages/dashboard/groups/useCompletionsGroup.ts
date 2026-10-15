import { useApproveCompletion, useApproveCompletionsBatch, useCompletions, useReturnCompletion, type CompletionQueueItemDto } from '@/api/hooks'
import { formatDayMonth } from '@/lib/dateRange'
import { plural } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import { formatWithTimeZone } from '@/lib/utils'
import { formatVarianceMinutes } from '@/pages/rostering/lib/roster'
import { groupPhase, type GroupModel, type QuickRow } from '../quickGroupModel'

/** A queue row's review flags, in SHAPE's order (the first two are drawn). */
export function completionFlags(item: CompletionQueueItemDto): Array<{ label: string; tone: Tone }> {
  const flags: Array<{ label: string; tone: Tone }> = []
  if (item.incidentCount > 0) flags.push({ label: plural(item.incidentCount, 'incident'), tone: 'danger' })
  if (item.dosesWithoutOutcome > 0) flags.push({ label: `${plural(item.dosesWithoutOutcome, 'dose')} unrecorded`, tone: 'warning' })
  if (item.isOutlierVariance) flags.push({ label: 'Outlier time', tone: 'warning' })
  if (item.startWasManual) flags.push({ label: 'Manual start', tone: 'warning' })
  if (item.timesAdjusted) flags.push({ label: 'Times adjusted', tone: 'info' })
  return flags
}

/** One-tap approval only for a row with nothing to look at. The incident count must be a known 0: a server that sent none is never clean. */
export const isClean = (item: CompletionQueueItemDto) => item.incidentCount === 0 && completionFlags(item).length === 0

/** The Shift completions group (SHAPE §5): the review queue's first five, approved or returned with the Completions page's own hooks. */
export function useCompletionsGroup(enabled: boolean): GroupModel {
  // The whole pending queue in one read (the server's page maximum, PagingParams.MaxPageSize), so Complete all counts the clean rows of the whole tab
  // (decision-bulk DECISIONS 1); five are shown. Its own entry beside the nav badge's 1-row one; every approve hook invalidates ['rostering-completions'].
  // shortcut: past 200 pending, the rows after the first 200 are neither counted nor sent; page the read if a provider ever queues that many.
  const queue = useCompletions({ status: 'PendingReview' }, 1, 200, { enabled })
  const approve = useApproveCompletion()
  const approveBatch = useApproveCompletionsBatch()
  const giveBack = useReturnCompletion()

  const rows = (queue.data?.items ?? []).map((item): QuickRow => {
    const day = formatDayMonth(item.serviceDate)
    const time = (iso: string) => formatWithTimeZone(iso, item.timeZoneId, { timeStyle: 'short' })
    const shift = `${item.staffName} with ${item.participantName}, ${day}`
    return {
      id: item.shiftId,
      subject: item.staffName,
      facts: [
        item.participantName,
        `${day}, ${time(item.actualStart)} – ${item.actualEnd ? time(item.actualEnd) : '…'}`,
        `${formatVarianceMinutes(item.varianceMinutesStart)} / ${formatVarianceMinutes(item.varianceMinutesEnd)}`,
      ],
      flags: completionFlags(item),
      actions: [
        { kind: 'form', label: 'Return', name: `Return shift: ${shift}`, form: {
          field: 'textarea', label: 'Why are you returning it?', hint: `${item.staffName.split(' ')[0]} sees this.`,
          required: "Say why you're returning it.", maxLength: 500,
          submitLabel: 'Return shift', busyLabel: 'Returning…', danger: true, failText: "Couldn't return it. Try again.",
          submit: async (reason) => {
            await giveBack.mutateAsync({ shiftId: item.shiftId, data: { reason: reason.trim() } })
            return { announce: `Returned ${item.staffName}'s shift on ${day}.` }
          },
        } },
        isClean(item)
          ? { kind: 'tap', label: 'Approve', busyLabel: 'Approving…', name: `Approve shift: ${shift}`, failText: "Couldn't approve. Try again.",
              run: async () => {
                await approve.mutateAsync(item.shiftId)
                return { announce: `Approved ${item.staffName}'s shift with ${item.participantName} on ${day}.` }
              } }
          // A flagged row needs judgement: the full page, whose confirm lists the incidents (SHAPE §5).
          : { kind: 'link', label: 'Review', name: `Review shift: ${shift}`, to: '/rostering/completions' },
      ],
    }
  })

  return {
    key: 'completions',
    title: 'Completions',
    noun: 'shift completions',
    subjectHeader: 'Staff',
    columns: [{ header: 'Participant', long: true }, { header: 'Shift' }, { header: 'Variance' }],
    phase: groupPhase(queue),
    refetch: () => { void queue.refetch() },
    count: queue.data?.totalCount ?? 0,
    rows,
    link: { to: '/rostering/completions', openLabel: 'Open Completions' },
    approveBatch: (ids) => approveBatch.mutateAsync(ids),
  }
}
