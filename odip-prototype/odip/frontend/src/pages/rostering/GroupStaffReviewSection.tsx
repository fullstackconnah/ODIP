import { useState } from 'react'
import { useApproveGroupStaffRows, useGroupStaffReviews, useSetGroupStaffActuals } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { Modal } from '@/components/Modal'
import { StatusBadge } from '@/components/StatusBadge'
import { fieldSurface } from '@/components/FormField'
import { apiErrorCode, apiErrorMessages } from '@/lib/shiftPackageErrors'
import { formatDateAu, formatWithTimeZone } from '@/lib/utils'
import { plural } from '@/lib/format'
import { TONE } from '@/lib/tone'
import { providerLocalToUtcInstant, utcInstantToProviderLocal } from '@/pages/portal/shift/shiftTime'
import { formatShiftTimeRange } from './lib/roster'
import type { GroupStaffApproveResultDto, GroupStaffReviewDto } from '@/api/types'
import type { Tone } from '@/lib/tone'

const REASON_MAX = 500
const FALLBACK_ZONE = 'Australia/Sydney'
const STATE: Record<GroupStaffReviewDto['state'], { label: string; tone: Tone }> = {
  NotStarted: { label: 'Not started', tone: 'neutral' },
  Started: { label: 'In progress', tone: 'info' },
  Finished: { label: 'Finished', tone: 'warning' },
  Approved: { label: 'Approved', tone: 'success' },
}
const fieldClass = `w-full py-2 min-h-[var(--control-h)] text-sm ${fieldSurface}`
const APPROVE_COMPLETES = 'Approving marks everyone still on this activity as attended.'
const chip = (tone: Tone) => `inline-block whitespace-nowrap text-xs px-2 py-0.5 rounded-full ${TONE[tone].solid}`

const zoneOf = (r: GroupStaffReviewDto) => r.timeZoneId || FALLBACK_ZONE
const clock = (r: GroupStaffReviewDto, iso: string) => formatWithTimeZone(iso, zoneOf(r), { hour: 'numeric', minute: '2-digit' })

function actualLine(r: GroupStaffReviewDto): string {
  if (!r.actualStart) return '—'
  const span = `${clock(r, r.actualStart)} – ${r.actualEnd ? clock(r, r.actualEnd) : '…'}`
  const mins = r.breakStartedAt && r.breakEndedAt ? Math.round((Date.parse(r.breakEndedAt) - Date.parse(r.breakStartedAt)) / 60000) : 0
  return mins > 0 ? `${span} · break ${mins} min` : span
}

/** The server codes the Record times modal maps to a field, with the rest shown at the top. */
const FIELD_OF_CODE: Record<string, 'reason' | 'finish' | 'break'> = {
  GA_REASON: 'reason', GA_TOO_LONG: 'reason', GA_TIMES: 'finish', GA_ACTUALS_LONG: 'finish', GA_ACTUALS_FUTURE: 'finish', GA_BREAK: 'break', GA_BREAK_RANGE: 'break',
}

function RecordTimesModal({ row, onClose }: { row: GroupStaffReviewDto; onClose: () => void }) {
  const save = useSetGroupStaffActuals()
  const zone = zoneOf(row)
  const local = (iso: string | null) => (iso ? utcInstantToProviderLocal(iso, zone) : '')
  const [start, setStart] = useState(local(row.actualStart))
  const [finish, setFinish] = useState(local(row.actualEnd))
  const [breakStart, setBreakStart] = useState(local(row.breakStartedAt))
  const [breakEnd, setBreakEnd] = useState(local(row.breakEndedAt))
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<{ reason?: string; finish?: string; break?: string; top?: string }>({})

  const submit = () => {
    const startUtc = providerLocalToUtcInstant(start, zone)
    const finishUtc = providerLocalToUtcInstant(finish, zone)
    if (!startUtc || !finishUtc) return setErrors({ finish: 'Enter the start and the finish.' })
    if (!reason.trim()) return setErrors({ reason: 'Enter why these times are being recorded.' })
    if ((breakStart === '') !== (breakEnd === '')) return setErrors({ break: 'Enter both break times, or neither.' })
    setErrors({})
    save.mutate({
      row,
      data: {
        actualStart: startUtc, actualEnd: finishUtc, reason: reason.trim(),
        ...(breakStart && breakEnd ? { breakStart: providerLocalToUtcInstant(breakStart, zone) ?? undefined, breakEnd: providerLocalToUtcInstant(breakEnd, zone) ?? undefined } : {}),
      },
    }, {
      onSuccess: onClose,
      onError: e => {
        const message = apiErrorMessages(e)[0] ?? "Couldn't save these times. Try again."
        const field = FIELD_OF_CODE[apiErrorCode(e) ?? '']
        setErrors(field ? { [field]: message } : { top: message })
      },
    })
  }

  const err = (id: string, message?: string) => (message ? <p id={id} role="alert" className="mt-1 text-xs text-[var(--color-destructive)]">{message}</p> : null)
  return (
    <Modal
      open onClose={save.isPending ? () => {} : onClose} title={`Record times — ${row.staffName}`} size="md" closeOnBackdrop={false}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save times'}</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        {errors.top && <p role="alert" className="text-sm text-[var(--color-destructive)]">{errors.top}</p>}
        <p className="text-sm text-[var(--color-muted-foreground)]">{row.activityTitle}, {formatDateAu(row.serviceDate)}. Planned {formatShiftTimeRange(row.startTime, row.endTime)}.</p>
        <div>
          <label htmlFor="gs-start" className="text-sm font-medium">Start</label>
          <input id="gs-start" type="datetime-local" className={fieldClass} value={start} onChange={e => setStart(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gs-finish" className="text-sm font-medium">Finish</label>
          <input id="gs-finish" type="datetime-local" className={fieldClass} value={finish} aria-invalid={errors.finish ? true : undefined}
            aria-describedby={errors.finish ? 'gs-finish-error' : undefined} onChange={e => setFinish(e.target.value)} />
          {err('gs-finish-error', errors.finish)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="gs-break-start" className="text-sm font-medium">Break start (optional)</label>
            <input id="gs-break-start" type="datetime-local" className={fieldClass} value={breakStart} aria-invalid={errors.break ? true : undefined}
              aria-describedby={errors.break ? 'gs-break-error' : undefined} onChange={e => setBreakStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="gs-break-end" className="text-sm font-medium">Break end</label>
            <input id="gs-break-end" type="datetime-local" className={fieldClass} value={breakEnd} aria-invalid={errors.break ? true : undefined}
              aria-describedby={errors.break ? 'gs-break-error' : undefined} onChange={e => setBreakEnd(e.target.value)} />
          </div>
        </div>
        {err('gs-break-error', errors.break)}
        <div>
          <label htmlFor="gs-reason" className="text-sm font-medium">Reason</label>
          <textarea id="gs-reason" rows={3} maxLength={REASON_MAX} className={fieldClass} value={reason} aria-required="true" aria-invalid={errors.reason ? true : undefined}
            aria-describedby={errors.reason ? 'gs-reason-error gs-reason-count' : 'gs-reason-count'} onChange={e => setReason(e.target.value)} />
          {err('gs-reason-error', errors.reason)}
          <p id="gs-reason-count" className="text-xs text-[var(--color-muted-foreground)]">{reason.length} of {REASON_MAX}</p>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Group activity staff awaiting approval (GA PR3), above the shift table on the completions page. Finished rows can be approved one at
 * a time or in bulk; any unapproved row can have its times recorded. Not drawn when there is nothing to review.
 */
export function GroupStaffReviewSection({ canReview }: { canReview: boolean }) {
  const { data, isLoading, isError, refetch } = useGroupStaffReviews()
  const approve = useApproveGroupStaffRows()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [recording, setRecording] = useState<GroupStaffReviewDto | null>(null)
  const [failures, setFailures] = useState<{ row: GroupStaffReviewDto | undefined; result: GroupStaffApproveResultDto }[]>([])
  const [error, setError] = useState<string | null>(null)

  const rows = data?.rows ?? []
  const run = (ids: string[], done: () => void) => {
    setError(null)
    approve.mutate(ids, {
      onSuccess: results => {
        setFailures(results.filter(r => !r.ok).map(result => ({ row: rows.find(r => r.rowId === result.rowId), result })))
        setSelected(new Set())
        done()
      },
      onError: e => { setError(apiErrorMessages(e)[0] ?? "Couldn't approve. Try again."); },
    })
  }

  // The last listed Finished row of an activity completes it on approve (the server completes once every staff row is approved; a row hidden by the list cap is the one case this misses).
  const completesActivity = (r: GroupStaffReviewDto) => r.state === 'Finished' && !rows.some(o => o.rowId !== r.rowId && o.groupActivityId === r.groupActivityId)
  // An activity completes when every one of its listed rows is selected (and finished), however many rows it has.
  const completing = new Set(rows.filter(r => selected.has(r.rowId)).map(r => r.groupActivityId)
    .filter(id => rows.filter(o => o.groupActivityId === id).every(o => selected.has(o.rowId) && o.state === 'Finished')))

  const columns: Column<GroupStaffReviewDto>[] = [
    { key: 'serviceDate', header: 'Date', render: r => formatDateAu(r.serviceDate) },
    {
      key: 'activityTitle', header: 'Activity', render: r => (
        <>
          {r.activityTitle}
          <p className="text-xs text-[var(--color-muted-foreground)]">{r.participantCount} attending{r.didNotAttendCount > 0 && ` · ${r.didNotAttendCount} didn't attend`}</p>
        </>
      ),
    },
    { key: 'staffName', header: 'Staff', render: r => r.staffName },
    { key: 'planned', header: 'Planned', render: r => formatShiftTimeRange(r.startTime, r.endTime) },
    { key: 'actual', header: 'Actual', render: actualLine },
    {
      key: 'state', header: 'State', render: r => (
        <>
          <StatusBadge tone={STATE[r.state].tone} label={STATE[r.state].label} />
          {r.state !== 'Finished' && <span id={`gs-block-${r.rowId}`} className="sr-only">Only finished shifts can be approved.</span>}
        </>
      ),
    },
    {
      key: 'flags', header: 'Flags', render: r => (
        <div className="flex flex-wrap items-center gap-1">
          {r.offRoster && <span className={chip('warning')}>Off roster</span>}
          {r.locationCheck === 'NotAtLocation' && <span className={chip('warning')}>Off site</span>}
          {!r.payrollLinked && <span className={chip('danger')}>No payroll ID</span>}
          {r.adjustmentReason && <span className={chip('info')} title={r.adjustmentReason} aria-label={`Edited: ${r.adjustmentReason}`}>Edited</span>}
        </div>
      ),
    },
    ...(canReview ? [{
      key: 'actions', header: 'Actions', render: (r: GroupStaffReviewDto) => (
        <div className="flex min-w-0 flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" className="pointer-coarse:min-h-[var(--tap-min)]" onClick={() => setRecording(r)} aria-label={`Record times for ${r.staffName} on ${r.activityTitle}`}>Record times</Button>
          {r.state === 'Finished' && (
            <div className="flex min-w-0 flex-col items-start gap-1">
              <Button size="sm" className="pointer-coarse:min-h-[var(--tap-min)]" disabled={approve.isPending} onClick={() => run([r.rowId], () => {})} aria-label={`Approve ${r.staffName} on ${r.activityTitle}`}>Approve</Button>
              {completesActivity(r) && <p className="max-w-[32ch] whitespace-normal text-xs text-[var(--color-muted-foreground)]">{APPROVE_COMPLETES}</p>}
            </div>
          )}
        </div>
      ),
    }] : []),
  ]

  if (isLoading) {
    return (
      <section aria-labelledby="group-staff-heading" className="space-y-3">
        <h2 id="group-staff-heading" className="text-base font-semibold">Group activity staff</h2>
        <DataTable data={[]} columns={columns} keyField="rowId" loading />
      </section>
    )
  }
  if (isError) {
    return (
      <Callout tone="danger" actions={<Button variant="secondary" size="sm" onClick={() => refetch()}>Try again</Button>}>
        Couldn't load group activity staff. Check your connection and try again.
      </Callout>
    )
  }
  if (rows.length === 0) return null

  return (
    <section aria-labelledby="group-staff-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="group-staff-heading" className="text-base font-semibold">Group activity staff ({data?.total ?? rows.length})</h2>
        {canReview && selected.size > 0 && <Button onClick={() => setConfirmOpen(true)}>Approve selected ({selected.size})</Button>}
      </div>
      {failures.length > 0 && (
        <div role="status" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]/40 p-3 text-sm space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p>{plural(failures.length, 'staff shift')} could not be approved.</p>
            <Button variant="ghost" size="sm" onClick={() => setFailures([])}>Dismiss</Button>
          </div>
          {failures.map(f => (
            <p key={f.result.rowId} className="text-xs text-[var(--color-destructive)]">{f.row ? `${f.row.staffName}, ${f.row.activityTitle}` : f.result.rowId}: {f.result.message ?? f.result.code ?? 'Could not approve.'}</p>
          ))}
        </div>
      )}
      {error && !confirmOpen && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
      <DataTable
        data={rows} columns={columns} keyField="rowId" emptyMessage="No group activity staff to review"
        selectable={canReview} selectedRows={selected} onSelectionChange={ids => setSelected(new Set([...ids].filter(id => rows.find(r => r.rowId === id)?.state === 'Finished')))}
        selectBlockedBy={r => (r.state === 'Finished' ? undefined : `gs-block-${r.rowId}`)}
      />
      {data && data.total > rows.length && <p className="text-xs text-[var(--color-muted-foreground)]">Showing the oldest {rows.length} of {data.total}.</p>}

      <ConfirmDialog
        open={confirmOpen} onCancel={() => { setConfirmOpen(false); setError(null) }} onConfirm={() => run([...selected], () => setConfirmOpen(false))}
        title="Approve selected staff shifts" confirmLabel="Approve" loading={approve.isPending}
        message={(
          <div className="space-y-2">
            <p>{plural(selected.size, 'staff shift')} will be approved and sent to payroll.</p>
            {completing.size > 0 && <p>{completing.size > 1 ? APPROVE_COMPLETES.replace('this activity', 'these activities') : APPROVE_COMPLETES}</p>}
            {error && <p role="alert" className="text-xs text-[var(--color-destructive)]">{error}</p>}
          </div>
        )}
      />
      {recording && <RecordTimesModal row={recording} onClose={() => setRecording(null)} />}
    </section>
  )
}
