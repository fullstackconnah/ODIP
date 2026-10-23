import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Plug, CalendarX } from 'lucide-react'
import { usePayPeriods, usePayrollCheck, useSendMissingTimesheets } from '@/api/hooks'
import type { PayPeriodDto, PayrollShiftDto, PayrollWorkerDto } from '@/api/types'
import type { PayrollShiftStatus } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { SelectField } from '@/components/SelectField'
import { StatusBadge } from '@/components/StatusBadge'
import { formatWithTimeZone, extractErrorMessage } from '@/lib/utils'
import { plural } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { retryingAfterError } from '@/lib/queryPhase'
import type { Tone } from '@/lib/tone'

/** The five words pin their own tone, so a word used elsewhere ("Sent", "Failed") keeps its tone there. */
const WORD_TONE: Record<PayrollShiftStatus, Tone> = { Sent: 'success', Waiting: 'warning', NotLinked: 'warning', Failed: 'danger', Changed: 'danger' }
const WORD_LABEL: Record<PayrollShiftStatus, string> = { Sent: 'Sent', Waiting: 'Waiting', NotLinked: 'Not linked', Failed: 'Failed', Changed: 'Changed' }
/** Worst first: what a worker's row says, and the order of the table. */
const SEVERITY: PayrollShiftStatus[] = ['Changed', 'Failed', 'NotLinked', 'Waiting', 'Sent']
const MUTED = 'text-sm text-[var(--color-muted-foreground)]'
/** An en dash with no-break spaces, and a word joiner after it so a line can't break straight after the dash. */
const DASH = ' –⁠ '

function Word({ status }: { status: PayrollShiftStatus }) {
  return <StatusBadge status={status} label={WORD_LABEL[status]} tone={WORD_TONE[status]} />
}

const calendarDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const shortDate = (iso: string, withYear = false) =>
  calendarDate(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })

const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`
}
/** A no-break space before am/pm, so a time never splits from it at 390. */
const keepAmPm = (t: string) => t.replace(/(?<=\d)\s+(?=[ap]m\b)/gi, '\u00A0')
const clock = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return keepAmPm(new Date(2000, 0, 1, h, m).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }))
}
const periodKey = (p: PayPeriodDto) => `${p.payScheduleId}|${p.from}`

function periodLabel(p: PayPeriodDto, showSchedule: boolean) {
  const range = `${shortDate(p.from)}${DASH}${shortDate(p.to, true)} · ${p.finalised ? 'Finalised' : 'Open'}`
  return showSchedule ? `${p.scheduleName} · ${range}` : range
}

type WorkerRow = PayrollWorkerDto & { id: string; worst: PayrollShiftStatus; notSent: number }

function shiftLine(s: PayrollShiftDto) {
  const rostered = `Rostered ${clock(s.rosteredStart)}${DASH}${clock(s.rosteredEnd)} (${hours(s.rosteredMinutes)})`
  if (s.nightType === 'Sleepover') return `${rostered} · Sleepover: rostered times sent`
  const time = (iso: string | null) => keepAmPm(formatWithTimeZone(iso, s.timeZoneId, { hour: 'numeric', minute: '2-digit' }))
  const actual = s.actualEnd
    ? `Actual ${time(s.actualStart)}${DASH}${time(s.actualEnd)}${s.breakMinutes > 0 ? `, ${s.breakMinutes} min break` : ''} (${hours(s.paidMinutes)})`
    : 'Actual hours not recorded'
  const lead = s.nightType === 'ActiveNight' ? 'Active night · ' : s.nightType === 'PassiveNight' ? 'Passive night · ' : ''
  return `${lead}${rostered} · ${actual}`
}

function ShiftLines({ id, shifts, canLink }: { id: string; shifts: PayrollShiftDto[]; canLink: boolean }) {
  return (
    <ul id={id} className="flex flex-col gap-3 py-1">
      {shifts.map(s => (
        <li key={s.shiftId} className="flex flex-col gap-0.5">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {calendarDate(s.serviceDate).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} {'·'} {s.participantName}
            </span>
            <Word status={s.status} />
          </div>
          <span className="text-[13px] text-[var(--color-muted-foreground)] [overflow-wrap:anywhere]">{shiftLine(s)}</span>
          {s.status !== 'Sent' && s.reason && <span className="text-[13px] [overflow-wrap:anywhere]">{keepAmPm(s.reason)}</span>}
          {s.status === 'NotLinked' && canLink && (
            <Link className="flex w-fit items-center text-[13px] underline pointer-coarse:min-h-[var(--tap-min)]" to="/settings?section=integrations">Link in Settings → Integrations</Link>
          )}
          {s.status === 'Sent' && s.sentAt && (
            <span className="text-[13px] text-[var(--color-muted-foreground)]">
              Sent {keepAmPm(formatWithTimeZone(s.sentAt, undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function summaryText(c: { approved: number; sent: number; waiting: number; failed: number; changed: number; notLinked: number }) {
  if (c.approved === 0) return 'No approved shifts in this period.'
  if (c.sent === c.approved) return `All ${c.approved} approved shifts are in Employment Hero.`
  const parts = [[c.sent, 'sent'], [c.waiting, 'waiting'], [c.failed, 'failed'], [c.changed, 'changed'], [c.notLinked, 'not linked']]
    .filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}`)
  return `${plural(c.approved, 'approved shift')}: ${parts.join(', ')}.`
}

/** Rostering → Payroll: has every approved shift in a pay period reached Employment Hero as worked, and if not, why. */
export default function PayrollPage() {
  const { isAdmin, isSuperAdmin, canManageIntegrations } = usePermissions()
  const canSend = isAdmin || isSuperAdmin
  const periods = usePayPeriods()
  const [picked, setPicked] = useState<string | null>(null)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [queued, setQueued] = useState<{ key: string; text: string } | null>(null)
  const send = useSendMissingTimesheets()
  // The query drops its error while a retry runs; keep the server's words on screen through it.
  const [periodsDetail, setPeriodsDetail] = useState('')
  const periodsMessage = extractErrorMessage(periods.error, '')
  if (periodsMessage && periodsMessage !== periodsDetail) setPeriodsDetail(periodsMessage)

  const list = periods.data?.periods ?? []
  const showSchedule = new Set(list.map(p => p.payScheduleId)).size > 1
  const today = periods.data?.today
  const current = list.find(p => picked === periodKey(p))
    ?? list.find(p => today !== undefined && p.from <= today && today <= p.to)
    ?? list[0]
  const range = current ? { from: current.from, to: current.to } : null
  const check = usePayrollCheck(range)
  const data = check.data

  const rows = useMemo<WorkerRow[]>(() => (data?.workers ?? []).map(w => {
    const worst = SEVERITY.find(word => w.shifts.some(s => s.status === word)) ?? 'Sent'
    return { ...w, id: w.userId, worst, notSent: w.shifts.filter(s => s.status !== 'Sent').length }
  }), [data])
  const isOpen = (w: WorkerRow) => toggled[w.id] ?? w.worst !== 'Sent'

  const columns: Column<WorkerRow>[] = [
    {
      key: 'name', header: 'Worker', mobile: 'primary', wrap: true,
      render: w => (
        <span className="[overflow-wrap:anywhere]">
          {w.name}
          {!w.linked && <span className={`block ${MUTED}`}>Not linked</span>}
        </span>
      ),
    },
    { key: 'shifts', header: 'Shifts', mobile: 'meta', render: w => plural(w.shifts.length, 'shift') },
    { key: 'rostered', header: 'Rostered', mobile: 'meta', render: w => <span><span className="md:hidden">Rostered </span>{hours(w.rosteredMinutes)}</span> },
    { key: 'paid', header: 'Actual', mobile: 'meta', render: w => <span><span className="md:hidden">Actual </span>{hours(w.paidMinutes)}</span> },
    {
      key: 'status', header: 'Status', mobile: 'status',
      render: w => (
        <span className="inline-flex flex-wrap items-center gap-2 md:flex-nowrap">
          <Word status={w.worst} />
          {w.notSent > 0 && <span className={MUTED}>{w.notSent} of {w.shifts.length} not sent</span>}
        </span>
      ),
    },
    {
      key: 'actions', header: '',
      render: w => {
        const open = isOpen(w)
        return (
          <Button
            variant="ghost" size="sm" className="min-h-[var(--tap-min)]"
            aria-label={`${open ? 'Hide' : 'Show'} shifts: ${w.name}`}
            aria-expanded={open}
            aria-controls={open ? `shifts-${w.id}` : undefined}
            onClick={() => setToggled(t => ({ ...t, [w.id]: !open }))}
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            {open ? 'Hide shifts' : 'Show shifts'}
          </Button>
        )
      },
    },
  ]

  const header = <PageHeader title="Payroll" subtitle="Approved hours and what Employment Hero has, by pay period." />

  if (periods.isLoading && !retryingAfterError(periods)) return <>{header}<PageState kind="loading" noun="payroll" /></>
  if (!periods.data) return <>{header}<PageState kind="error" noun="payroll" detail={periodsDetail || undefined} onRetry={() => periods.refetch()} /></>
  if (!periods.data.connected) {
    return (
      <>
        {header}
        <EmptyState
          icon={Plug}
          title="Employment Hero isn't connected"
          description="Connect it in Settings → Integrations, and approved hours go to payroll from then on."
          action={canSend ? { label: 'Open Integrations', to: '/settings?section=integrations' } : undefined}
        />
      </>
    )
  }
  if (list.length === 0) {
    return (
      <>
        {header}
        <EmptyState icon={CalendarX} title="Employment Hero has no pay schedules for this business yet." description="Add one in Employment Hero; its periods appear here." />
      </>
    )
  }

  const sendable = data?.sendable ?? 0
  const pendingMessage = queued && current && queued.key === periodKey(current) ? queued.text : null
  const updated = check.dataUpdatedAt
    ? `Updated ${keepAmPm(new Date(check.dataUpdatedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }))}`
    : ''

  return (
    <>
      {header}
      <div className="flex flex-col gap-4 pt-[var(--section-gap)]">
        <SelectField
          label="Pay period"
          className="w-full max-w-[24rem]"
          value={current ? periodKey(current) : ''}
          onChange={e => { setPicked(e.target.value); setToggled({}); send.reset() }}
          options={list.map(p => ({ value: periodKey(p), label: periodLabel(p, showSchedule) }))}
        />

        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-6">
          {/* One slot for the summary and the queued/updated line, a fixed height so neither makes the page jump. */}
          <div className="flex min-h-[4.5rem] flex-col md:min-h-[3rem] gap-0.5">
            <p className={`${data && data.approved > 0 && data.sent === data.approved ? 'text-[var(--color-success)]' : ''} [overflow-wrap:anywhere]`}>
              {data ? summaryText(data) : ' '}
            </p>
            <p className={MUTED} role="status" aria-live="polite">{pendingMessage ?? updated}</p>
          </div>
          {canSend ? (
            <div className="flex flex-col gap-1 md:items-end">
              <Button
                className="min-w-[10.5rem] max-md:w-full"
                disabled={send.isPending || !data || sendable === 0 || !current}
                aria-describedby={data && sendable === 0 ? 'send-missing-none' : undefined}
                onClick={() => current && send.mutate(
                  { from: current.from, to: current.to },
                  { onSuccess: r => setQueued({ key: periodKey(current), text: `Queued ${plural(r.queued, 'shift')}. ODIP sends about 25 a minute.` }) },
                )}
              >
                {send.isPending ? 'Sending…' : data ? `Send missing (${sendable})` : 'Send missing'}
              </Button>
              {/* A reserved line, so the row holds its height whether the check is loading, failed or answered. */}
              <span id="send-missing-none" className={`${MUTED} min-h-5`}>{data && sendable === 0 ? 'Nothing to send.' : ''}</span>
            </div>
          ) : (
            <p className={MUTED}>An Admin can send missing hours.</p>
          )}
        </div>

        {current?.finalised && (
          <p className={MUTED}>This pay run is finalised in Employment Hero. Changes now have to be made there.</p>
        )}
        {send.isError && <Callout tone="danger">{extractErrorMessage(send.error, "The hours couldn't be queued. Try again.")}</Callout>}
        {data && data.awaitingApproval > 0 && (
          <Callout
            tone="info"
            actions={<Button to="/rostering/completions" variant="secondary" size="sm" className="min-h-[var(--tap-min)]">Open Completions</Button>}
          >
            {plural(data.awaitingApproval, 'shift')} in this period {data.awaitingApproval === 1 ? "isn't" : "aren't"} approved yet, so {data.awaitingApproval === 1 ? "it can't" : "they can't"} go to payroll.
          </Callout>
        )}

        <DataTable
          data={rows}
          columns={columns}
          keyField="id"
          loading={check.isLoading}
          error={check.isError}
          onRetry={() => check.refetch()}
          emptyMessage="Nothing to check for these dates."
          rowDetail={w => (isOpen(w) ? <ShiftLines id={`shifts-${w.id}`} shifts={w.shifts} canLink={canManageIntegrations} /> : null)}
        />
      </div>
    </>
  )
}
