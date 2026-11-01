import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePreviewShiftClaimRun, useRunShiftClaims } from '@/api/hooks/claims'
import type { ShiftClaimRunDto, ShiftClaimRunParticipantDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ClaimBudgetBlock } from '@/components/ClaimBudgetBlock'
import { DataTable } from '@/components/DataTable'
import { FlaggedShifts } from '@/components/FlaggedShifts'
import { FormField } from '@/components/FormField'
import { LeftOutCallout, SHIFT_LEFT_OUT_FOOTER } from '@/components/LeftOutCallout'
import { Modal } from '@/components/Modal'
import { TAP_FLOOR } from '@/components/tapArea'
import { plural } from '@/lib/format'
import { extractErrorMessage, formatCurrency, formatDateAu } from '@/lib/utils'

const PREVIEW_FAILED = "Couldn't load the preview. Check your connection and try again."
const RUN_FAILED = "Couldn't make the claims. Check your connection, then open the preview again: anything already claimed won't be claimed twice."

type Failure = { kind: 'preview' | 'run'; message: string }

/** The claim run: one draft claim for every participant with completed shifts that haven't been claimed yet, previewed first. */
export function ShiftClaimRunModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const previewRun = usePreviewShiftClaimRun()
  const run = useRunShiftClaims()
  const [preview, setPreview] = useState<ShiftClaimRunDto | null>(null)
  const [done, setDone] = useState<ShiftClaimRunDto | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const started = useRef(false)

  // No dates on the first request: the server picks the period (the last 14 days to yesterday, in the organisation's time zone) and sends it back.
  const load = (dates: { from?: string; to?: string }) => {
    setFailure(null)
    previewRun.mutate(dates, {
      onSuccess: data => { setPreview(data); setFrom(data.from); setTo(data.to) },
      onError: err => setFailure({ kind: 'preview', message: extractErrorMessage(err, PREVIEW_FAILED) }),
    })
  }
  const make = () => {
    setFailure(null)
    run.mutate({ from, to }, {
      onSuccess: setDone,
      onError: err => setFailure({ kind: 'run', message: extractErrorMessage(err, RUN_FAILED) }),
    })
  }
  useEffect(() => {
    if (!open || started.current) return
    started.current = true
    load({})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, [open])

  const pending = run.isPending
  const close = () => { if (!pending) onClose() }
  const shown = done ?? preview
  const loading = previewRun.isPending && !preview
  const edited = !!preview && !done && (from !== preview.from || to !== preview.to)
  const claims = preview?.participants.length ?? 0
  const retry = failure?.kind === 'run' ? make : () => load(preview ? { from, to } : {})

  let footer
  if (done) {
    footer = <Button size="md" onClick={onClose}>Done</Button>
  } else if (!shown || shown.participants.length === 0) {
    footer = <Button variant="secondary" size="md" onClick={close}>Close</Button>
  } else {
    footer = (
      <div className="flex w-full flex-wrap justify-end gap-3">
        <Button variant="secondary" size="md" onClick={close} disabled={pending}>Close</Button>
        <Button size="md" onClick={make} disabled={pending || edited || previewRun.isPending}>
          {pending ? 'Claiming…' : `Make ${plural(claims, 'claim')}`}
        </Button>
      </div>
    )
  }
  if (failure && !done) {
    footer = (
      <div className="flex w-full flex-wrap justify-end gap-3">
        <Button variant="secondary" size="md" onClick={close}>Close</Button>
        <Button size="md" onClick={retry}>Try again</Button>
      </div>
    )
  }

  return (
    <Modal open={open} onClose={close} title={done ? 'Claims made' : 'Claim completed shifts'} size="lg" footer={footer} closeOnBackdrop={!pending} hideClose={pending}>
      <div className="flex flex-col gap-[var(--section-gap)]">
        {!done && (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Bunya Support makes one claim for each participant with completed shifts that haven't been claimed yet. NDIA-managed claims go to Ready to send; plan- and self-managed ones are listed under Plan- and self-managed.
          </p>
        )}
        {failure && <Callout tone="danger">{failure.message}</Callout>}
        {loading && <p role="status" className="text-sm text-[var(--color-muted-foreground)]">Finding completed shifts…</p>}
        {!done && (preview || loading) && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="From">
                <input type="date" value={from} max={to || undefined} disabled={loading || pending} onChange={e => setFrom(e.target.value)} />
              </FormField>
              <FormField label="To">
                <input type="date" value={to} min={from || undefined} disabled={loading || pending} onChange={e => setTo(e.target.value)} />
              </FormField>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className="text-[13px] text-[var(--color-muted-foreground)]">
                {edited ? 'Update the preview to claim these dates.' : 'The last 14 days up to yesterday, unless you change it.'}
              </p>
              {edited && (
                <Button variant="secondary" size="md" onClick={() => load({ from, to })} disabled={previewRun.isPending}>
                  {previewRun.isPending ? 'Updating…' : 'Update preview'}
                </Button>
              )}
            </div>
          </div>
        )}
        {shown && <RunBody run={shown} made={!!done} preview={!done} />}
        {pending && <p role="status" className="text-sm text-[var(--color-muted-foreground)]">{`Making ${plural(claims, 'claim')}…`}</p>}
      </div>
    </Modal>
  )
}

/** The summary, table and notes of a run or its preview. */
function RunBody({ run, made, preview }: { run: ShiftClaimRunDto; made: boolean; preview: boolean }) {
  const rows = run.participants
  const failed = run.skipped.filter(s => s.failed)
  const leftOut = [
    ...run.leftOut.map(l => ({ key: `${l.participantId}-${l.shiftId}`, lead: <><span>{l.participantName}</span> · <span className="tabular-nums">{formatDateAu(l.serviceDate)}</span></>, description: l.description, reason: l.reason })),
    ...run.skipped.filter(s => !s.failed).map(s => ({ key: `skip-${s.participantId}`, lead: <span>{s.participantName}</span>, description: 'Every shift in this period', reason: s.reason })),
  ]
  const leftOutCount = run.leftOut.length + run.skipped.filter(s => !s.failed).length
  const empty = rows.length === 0 && leftOut.length === 0 && failed.length === 0

  const columns = [
    { key: 'participantName', header: 'Participant', mobile: 'primary' as const, wrap: true },
    { key: 'shiftCount', header: 'Shifts', align: 'right' as const, className: 'tabular-nums' },
    { key: 'hours', header: 'Hours', align: 'right' as const, className: 'tabular-nums' },
    { key: 'totalAmount', header: 'Total', type: 'currency' as const, align: 'right' as const, className: 'tabular-nums font-medium' },
    ...(made ? [{
      key: 'claimReference', header: 'Claim',
      render: (r: ShiftClaimRunParticipantDto) => r.claimId ? <Link to={`/claims/${r.claimId}`} className={`${TAP_FLOOR} underline underline-offset-2`}>{r.claimReference ?? 'View claim'}</Link> : null,
    }] : []),
  ]

  return (
    <>
      {failed.length > 0 && (
        <Callout tone="danger">
          <p className="font-medium">{`${plural(failed.length, 'claim')} ${preview ? "couldn't be worked out" : "couldn't be made"}`}</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {failed.map(f => <li key={f.participantId} className="break-words">{f.participantName}: {f.reason}</li>)}
          </ul>
          {made && run.claimsMade > 0 && <p className="mt-2 text-[13px]">The claims above are saved.</p>}
        </Callout>
      )}
      {empty && (
        <div className="text-sm text-[var(--color-muted-foreground)]">
          <p>{`No completed, unclaimed shifts between ${formatDateAu(run.from)} and ${formatDateAu(run.to)}.`}</p>
          <p className="mt-1">Completed shifts show here until they're claimed.</p>
        </div>
      )}
      {!empty && rows.length === 0 && !made && <p className="text-sm text-[var(--color-muted-foreground)]">Nothing in this period can be claimed yet.</p>}
      {made && <p className="text-sm">{run.claimsMade === 0 ? 'No claims were made.' : `Made ${plural(run.claimsMade, 'claim')} for ${formatCurrency(run.totalAmount)} from ${plural(run.shiftCount, 'shift')}.`}</p>}
      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <span className="text-sm tabular-nums text-[var(--color-muted-foreground)]">{`${plural(rows.length, 'participant')} · ${plural(run.shiftCount, 'shift')} · ${plural(run.hours, 'hour')}`}</span>
            <span className="whitespace-nowrap text-xl font-semibold tabular-nums">{formatCurrency(run.totalAmount)}</span>
          </div>
          <DataTable
            data={rows}
            keyField="participantId"
            columns={columns}
            footer={
              // On the phone the cards sit in the table's first column, so a four-cell footer row would shrink them and push the total out: one flex line there instead.
              <tr className="max-md:flex max-md:items-baseline max-md:justify-between">
                <td className="p-3 font-semibold text-[var(--color-foreground)]">Total</td>
                <td className="max-md:hidden" /><td className="max-md:hidden" />
                <td className="p-3 text-right font-bold tabular-nums text-[var(--color-foreground)]">{formatCurrency(run.totalAmount)}</td>
                {made && <td className="max-md:hidden" />}
              </tr>
            }
          />
        </>
      )}
      {leftOut.length > 0 && (
        <LeftOutCallout items={leftOut} heading={`${plural(leftOutCount, 'shift')} ${made ? (leftOutCount === 1 ? 'was' : 'were') : 'will be'} left out`} footer={SHIFT_LEFT_OUT_FOOTER} />
      )}
      {run.flagged.length > 0 && <FlaggedShifts shifts={run.flagged} scope="these claims" />}
      {/* What the whole run would do to the budgets: a warning, never a block. */}
      {preview && <ClaimBudgetBlock budget={run.budget} />}
    </>
  )
}
