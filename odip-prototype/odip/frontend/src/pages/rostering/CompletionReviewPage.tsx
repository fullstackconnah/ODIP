import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, AlertTriangle } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { locationCheckLine } from '@/lib/locationCheck'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Dropdown } from '@/components/Dropdown'
import { TextField } from '@/components/TextField'
import { SearchableSelect } from '@/components/SearchableSelect'
import {
  useCompletions, useCompletion, useApproveCompletion, useReturnCompletion, useApproveCompletionsBatch, useStaff,
  useEditCompletionTravel, usePlanPricingSettings, useSetBreakKind, useDecideExtraTime,
} from '@/api/hooks'
import type { CompletionQueueItemDto, ShiftStatus, ShiftCompletionDto, ApproveBatchResultDto, ExtraTimeChoice, ExtraTimeDecision } from '@/api/types'
import { formatDateAu, formatWithTimeZone, extractErrorMessage } from '@/lib/utils'
import { formatVarianceMinutes } from './lib/roster'
import { formatServiceDate, plural } from '@/lib/format'
import { unbroken } from '@/lib/intakeBooking'
import { Button } from '@/components/Button'
import { ToggleGroup } from '@/components/ToggleGroup'
import { Modal } from '@/components/Modal'
import { formatDuration } from '@/lib/planBlocks'
import { firstNameOf as firstName } from '@/lib/greeting'
import { TONE } from '@/lib/tone'
import { NumberField } from '@/components/NumberField'
import { apiErrorCode } from '@/lib/shiftPackageErrors'
import { SHIFT_PACKAGE_ERROR_CODES as C } from '@/api/types'
import { travelLabel } from '@/pages/portal/shift/checklist'

const PAGE_SIZE = 50
const DASH = '–'

const STATUS_FILTER_ITEMS: { value: ShiftStatus; label: string }[] = [
  { value: 'PendingReview', label: 'Pending review' },
  { value: 'InProgress', label: 'In progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Published', label: 'Returned / not submitted' },
]

function varianceBadgeClass(isOutlier: boolean): string {
  return isOutlier
    ? 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
    : 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
}

const EXTRA_TIME_LABEL: Record<ExtraTimeDecision, string> = { Pending: 'Extra time to decide', Approved: 'Extra time paid', Declined: 'Extra time not paid' }
const EXTRA_TIME_CHOICE: Record<ExtraTimeDecision, ExtraTimeChoice | ''> = { Pending: '', Approved: 'approve', Declined: 'decline' }
const SYNC_WINDOW_DAYS = 62   // the sender's change window (EmploymentHeroTimesheetSender.ChangeWindowDays)

const spanMinutes = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 60000)

/** Pay the actual times or the rostered hours. No option is checked until the coordinator picks; the caller says what picking does. */
function ExtraTimeChoiceGroup({ row, value, onChange, disabled, saving }: {
  row: CompletionQueueItemDto; value: ExtraTimeChoice | ''; onChange: (choice: ExtraTimeChoice) => void; disabled?: boolean; saving?: ExtraTimeChoice | null
}) {
  const actual = row.actualEnd ? ` (${formatDuration(spanMinutes(row.actualStart, row.actualEnd))})` : ''
  const rostered = ` (${formatDuration(spanMinutes(row.rosteredStart, row.rosteredEnd))})`
  return (
    <ToggleGroup
      ariaLabel="Extra time"
      value={value}
      onChange={key => onChange(key as ExtraTimeChoice)}
      disabled={disabled}
      className="flex-wrap"
      options={[
        { key: 'approve', label: saving === 'approve' ? 'Saving…' : `Pay actual time${actual}` },
        { key: 'decline', label: saving === 'decline' ? 'Saving…' : `Pay rostered hours${rostered}` },
      ]}
    />
  )
}

function rosteredVsActual(row: CompletionQueueItemDto) {
  const timeFmt = { timeStyle: 'short' as const }
  return (
    <div className="text-xs space-y-0.5 whitespace-nowrap">
      <div>
        <span className="text-[var(--color-muted-foreground)]">Rostered:</span>{' '}
        {formatWithTimeZone(row.rosteredStart, row.timeZoneId, timeFmt)}–{formatWithTimeZone(row.rosteredEnd, row.timeZoneId, timeFmt)}
      </div>
      <div>
        <span className="text-[var(--color-muted-foreground)]">Actual:</span>{' '}
        {formatWithTimeZone(row.actualStart, row.timeZoneId, timeFmt)}–{row.actualEnd ? formatWithTimeZone(row.actualEnd, row.timeZoneId, timeFmt) : '—'}
      </div>
    </div>
  )
}

/**
 * Reads the incidents count out of the shared ['rostering-completion', shiftId] query cache
 * without triggering a fetch of its own — the queue must not N+1 a detail call per row (design
 * spec §4), so this only lights up once the coordinator has already opened the Approve/Return
 * dialog for that row at least once in this session (which fetches and caches the detail).
 */
function useCachedIncidentCount(shiftId: string): number {
  const qc = useQueryClient()
  const cached = qc.getQueryData<ShiftCompletionDto>(['rostering-completion', shiftId])
  return cached?.incidents.length ?? 0
}

function IncidentIndicator({ shiftId }: { shiftId: string }) {
  const count = useCachedIncidentCount(shiftId)
  if (count === 0) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-on-error-container)]">
      <AlertTriangle className="w-3.5 h-3.5" /> {plural(count, 'incident')}
    </span>
  )
}

function IncidentsList({ incidents }: { incidents: ShiftCompletionDto['incidents'] }) {
  if (incidents.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-[var(--color-foreground)]">Incidents during this shift</p>
      <ul className="space-y-1">
        {incidents.map(incident => (
          <li key={incident.id} className="rounded-sm border border-[var(--color-error-container)] bg-[var(--color-error-container)]/30 px-2 py-1.5 text-xs">
            <span className="font-medium">{incident.title}</span> — {incident.severity}, {incident.status}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Staff fix a worker's trip before approving it: four NumberFields, saved on their own so the approval stays one click. */
function TravelEditor({ c, onOpenChange }: { c: ShiftCompletionDto; onOpenChange: (open: boolean) => void }) {
  const edit = useEditCompletionTravel()
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<{ message: string; onClaim: boolean } | null>(null)
  const [v, setV] = useState({ preMin: NaN, preKm: NaN, postMin: NaN, postKm: NaN })
  const [bad, setBad] = useState<Record<string, boolean>>({})
  const toNum = (n?: number | null) => n ?? NaN
  const toApi = (n: number) => (Number.isNaN(n) ? null : n)
  const show = (next: boolean) => { setOpen(next); setBad({}); onOpenChange(next) }
  const refocus = useRef(false)
  const close = () => { refocus.current = true; show(false); setError(null) }
  // Focus the new Edit travel button after the commit that swaps it in; a timer can fire before that commit and drop focus on body.
  useEffect(() => {
    if (!open && refocus.current) { refocus.current = false; button.current?.focus() }
  }, [open])
  function begin() {
    setV({ preMin: toNum(c.preShiftTravelMinutes), preKm: toNum(c.preShiftTravelKilometres), postMin: toNum(c.postShiftTravelMinutes), postKm: toNum(c.postShiftTravelKilometres) })
    show(true)
  }
  async function save() {
    setError(null)
    try {
      await edit.mutateAsync({
        shiftId: c.shiftId,
        data: { preShiftTravelMinutes: toApi(v.preMin), preShiftTravelKilometres: toApi(v.preKm), postShiftTravelMinutes: toApi(v.postMin), postShiftTravelKilometres: toApi(v.postKm) },
      })
      close()
    } catch (err) {
      setError({ message: extractErrorMessage(err, 'Could not save the travel. Please try again.'), onClaim: apiErrorCode(err) === C.travelOnClaim })
    }
  }
  if (!open) return <Button ref={button} variant="ghost" size="sm" onClick={begin}>Edit travel</Button>
  const leg = (legend: string, min: keyof typeof v, km: keyof typeof v) => (
    <fieldset className="grid grid-cols-2 gap-3">
      <legend className="mb-1 text-xs font-medium">{legend}</legend>
      <NumberField label="Minutes" value={v[min]} min={0} max={480} step={1} onChange={n => setV(p => ({ ...p, [min]: n }))} onBadInput={b => setBad(p => ({ ...p, [min]: b }))} error={bad[min] ? 'Enter a number' : undefined} />
      <NumberField label="Kilometres" value={v[km]} min={0} max={2000} step="0.1" inputMode="decimal" onChange={n => setV(p => ({ ...p, [km]: n }))} onBadInput={b => setBad(p => ({ ...p, [km]: b }))} error={bad[km] ? 'Enter a number' : undefined} />
    </fieldset>
  )
  return (
    <div className="mt-2 space-y-3">
      {leg('Trip to the participant', 'preMin', 'preKm')}
      {leg('Trip after the shift', 'postMin', 'postKm')}
      {error && <Callout tone={error.onClaim ? 'warning' : 'danger'}>{error.message}</Callout>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={edit.isPending || Object.values(bad).some(Boolean)}>Save travel</Button>
        <Button variant="secondary" onClick={close} aria-label="Cancel travel edit">Cancel</Button>
      </div>
    </div>
  )
}

/**
 * The breaks the worker took, one line each. In the Approve dialog (`onChange` given) each line has a ToggleGroup that saves at once; elsewhere the kind
 * reads as text. `first` is the participant's first name, `staffFirst` the worker's.
 */
function BreaksBlock({ c, first, staffFirst, pendingKind, onChange }: {
  c: ShiftCompletionDto; first: string; staffFirst: string; pendingKind?: boolean; onChange?: (breakId: string, withParticipant: boolean) => void
}) {
  const t = (iso: string) => formatWithTimeZone(iso, c.timeZoneId, { hour: 'numeric', minute: '2-digit' })
  return (
    <div className="space-y-1 pt-2">
      <ul className="space-y-1.5 text-xs">
        {c.breaks.map(b => (
          <li key={b.id} className="space-y-1">
            <span>{t(b.startedAt)}{DASH}{b.endedAt ? t(b.endedAt) : 'now'}, {b.minutes} min{onChange ? '' : `, ${b.withParticipant ? `with ${first}` : 'on my own'}`}</span>
            {onChange && (
              <ToggleGroup
                ariaLabel={`Who was ${staffFirst}'s break with?`}
                value={b.withParticipant ? 'with' : 'alone'}
                onChange={key => onChange(b.id, key === 'with')}
                disabled={pendingKind}
                options={[{ key: 'alone', label: 'On my own' }, { key: 'with', label: `With ${first}` }]}
              />
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs font-medium">Unpaid breaks {c.breakMinutes} min</p>
    </div>
  )
}

/** "Started 12 min early. Reason: …" or "… No reason given." for a start or finish more than 5 minutes off the roster. */
function offRosterLine(what: 'Started' | 'Finished', variance: number, reason: string | null | undefined) {
  return `${what} ${Math.abs(variance)} min ${variance < 0 ? 'early' : 'late'}. ${reason ? `Reason: ${reason}` : 'No reason given.'}`
}

/** What the worker confirmed at Finish (My shifts redesign): moved times with the stamps they replaced, the reason, kilometres, the report answer. */
function WorkerAnswers({ c, canEditTravel = false, onTravelOpenChange = () => {}, breaks }: {
  c: ShiftCompletionDto; canEditTravel?: boolean; onTravelOpenChange?: (open: boolean) => void; breaks?: { first: string; staffFirst: string; pendingKind?: boolean; onChange?: (breakId: string, withParticipant: boolean) => void }
}) {
  const t = (iso: string) => formatWithTimeZone(iso, c.timeZoneId, { hour: 'numeric', minute: '2-digit' })
  const lines = [
    c.originalActualStart && `Start ${t(c.originalActualStart)}, changed to ${t(c.actualStart)}.`,
    locationCheckLine(c),
    c.offRosterStart && offRosterLine('Started', c.varianceMinutesStart, c.startTimeReason),
    c.originalActualEnd && c.actualEnd && `Finish ${t(c.originalActualEnd)}, changed to ${t(c.actualEnd)}.`,
    c.offRosterFinish && offRosterLine('Finished', c.varianceMinutesEnd, c.finishTimeReason),
    c.timeAdjustmentReason && `Reason: ${c.timeAdjustmentReason}`,
    c.kilometres != null && `${c.kilometres} km driven with the participant`,
    (c.preShiftTravelMinutes != null || c.preShiftTravelKilometres != null) && `Trip to the participant: ${travelLabel(c.preShiftTravelMinutes ?? null, c.preShiftTravelKilometres ?? null)}`,
    (c.postShiftTravelMinutes != null || c.postShiftTravelKilometres != null) && `Trip after the shift: ${travelLabel(c.postShiftTravelMinutes ?? null, c.postShiftTravelKilometres ?? null)}`,
    c.anythingToReport && 'The worker said there was something to report.',
    c.shiftReturnCount > 0 && `Returned to the worker ${plural(c.shiftReturnCount, 'time')} before.`,
  ].filter((line): line is string => typeof line === 'string')
  const hasBreaks = !!breaks && c.breaks.length > 0
  if (lines.length === 0 && !c.sentFromOffline && !canEditTravel && !hasBreaks) return null
  return (
    <div className="space-y-1">
      {c.sentFromOffline && (
        <div>
          <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TONE.neutral.solid}`}>Sent from offline</span>
          {c.submittedAt && <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">Reached Bunya Support {t(c.submittedAt)}</span>}
        </div>
      )}
      {lines.length > 0 && <ul className="space-y-0.5 text-xs">{lines.map(line => <li key={line}>{line}</li>)}</ul>}
      {hasBreaks && <BreaksBlock c={c} {...breaks} />}
      {canEditTravel && <TravelEditor c={c} onOpenChange={onTravelOpenChange} />}
    </div>
  )
}

export default function CompletionReviewPage() {
  const { canReviewCompletions } = usePermissions()
  const [statusFilter, setStatusFilter] = useState<ShiftStatus>('PendingReview')
  const [staffFilter, setStaffFilter] = useState('')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')
  const [page, setPage] = useState(1)

  const filters = useMemo(() => ({
    status: statusFilter,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  }), [statusFilter, fromFilter, toFilter])

  const { data, isLoading, isError, refetch } = useCompletions(filters, page, PAGE_SIZE)
  const { data: staff = [] } = useStaff()
  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: s.fullName })), [staff])
  const staffNameById = useMemo(() => new Map(staff.map(s => [s.id, s.fullName])), [staff])

  // GET /rostering/completions has no staffId query param (see RosteringController.GetCompletions)
  // — applied client-side over the fetched page, same "doesn't filter server-side" caveat
  // useLeaveRequests documents for its own from/to.
  const rows = useMemo(() => {
    const items = data?.items ?? []
    if (!staffFilter) return items
    const name = staffNameById.get(staffFilter)
    return name ? items.filter(r => r.staffName === name) : items
  }, [data, staffFilter, staffNameById])

  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [approveTarget, setApproveTarget] = useState<CompletionQueueItemDto | null>(null)
  const [returnTarget, setReturnTarget] = useState<CompletionQueueItemDto | null>(null)
  const [returnReason, setReturnReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)
  const [travelEditing, setTravelEditing] = useState(false)
  const [kindError, setKindError] = useState(false)
  const [extraChoice, setExtraChoice] = useState<ExtraTimeChoice | ''>('')   // the Approve dialog's optional extra-time choice
  const [decideTarget, setDecideTarget] = useState<CompletionQueueItemDto | null>(null)
  const [decideError, setDecideError] = useState(false)
  const [decideStale, setDecideStale] = useState(false)   // set on open: Date.now() is impure in render
  const [batchResults, setBatchResults] = useState<ApproveBatchResultDto[] | null>(null)

  const detailShiftId = approveTarget?.shiftId ?? returnTarget?.shiftId
  const { data: detail } = useCompletion(detailShiftId)

  const { data: pricing } = usePlanPricingSettings(canReviewCompletions)
  const approveCompletion = useApproveCompletion()
  const setBreakKind = useSetBreakKind()
  const decideExtraTime = useDecideExtraTime()
  const returnCompletion = useReturnCompletion()
  const approveBatch = useApproveCompletionsBatch()

  // A tap saves at once (the server only allows it while the shift awaits review); Approve waits for the save.
  async function changeKind(breakId: string, withParticipant: boolean) {
    if (!approveTarget) return
    setKindError(false)
    try { await setBreakKind.mutateAsync({ shiftId: approveTarget.shiftId, breakId, withParticipant }) }
    catch { setKindError(true) }
  }

  function closeApprove() {
    setKindError(false)
    setExtraChoice('')
    setApproveTarget(null)
    setActionError(null)
    setTravelEditing(false)
  }

  function closeReturn() {
    setReturnTarget(null)
    setReturnReason('')
    setActionError(null)
  }

  async function handleApproveConfirm() {
    if (!approveTarget) return
    setActionError(null)
    try {
      await approveCompletion.mutateAsync(extraChoice ? { shiftId: approveTarget.shiftId, extraTime: extraChoice } : approveTarget.shiftId)
      closeApprove()
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Could not approve this shift. Please try again.'))
    }
  }

  // Saves at once on the tap; a failure keeps the old choice on screen.
  async function decide(decision: ExtraTimeChoice) {
    if (!decideTarget) return
    setDecideError(false)
    try {
      const saved = await decideExtraTime.mutateAsync({ shiftId: decideTarget.shiftId, decision })
      setDecideTarget({ ...decideTarget, extraTime: saved.extraTime ?? decideTarget.extraTime })
    } catch { setDecideError(true) }
  }

  function closeDecide() {
    if (decideExtraTime.isPending) return
    setDecideError(false)
    setDecideTarget(null)
  }

  async function handleReturnConfirm() {
    if (!returnTarget) return
    const reason = returnReason.trim()
    if (!reason) {
      setActionError('A return reason is required.')
      return
    }
    setActionError(null)
    try {
      await returnCompletion.mutateAsync({ shiftId: returnTarget.shiftId, data: { reason } })
      closeReturn()
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Could not return this shift. Please try again.'))
    }
  }

  async function handleBatchApproveConfirm() {
    setActionError(null)
    try {
      const results = await approveBatch.mutateAsync(Array.from(selectedRows))
      setBatchResults(results)
      setSelectedRows(new Set())
      setBatchConfirmOpen(false)
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Could not approve the selected shifts. Please try again.'))
    }
  }

  const columns: Column<CompletionQueueItemDto>[] = [
    { key: 'participantName', header: 'Participant', render: row => row.participantName },
    { key: 'staffName', header: 'Staff', render: row => row.staffName },
    { key: 'serviceDate', header: 'Date', render: row => formatDateAu(row.serviceDate) },
    { key: 'times', header: 'Rostered vs actual', render: rosteredVsActual },
    {
      key: 'variance', header: 'Variance', render: row => (
        <div className="flex flex-wrap items-center gap-1">   {/* the badges wrap in a narrow column instead of running under the buttons */}
          <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${varianceBadgeClass(row.isOutlierVariance)}`}>
            {formatVarianceMinutes(row.varianceMinutesStart)} / {formatVarianceMinutes(row.varianceMinutesEnd)}
          </span>
          {row.offRoster && (
            // Words, not colour alone: the start or a set finish is more than 5 minutes off the roster, whatever the outlier setting says.
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TONE.warning.solid}`}>Off roster</span>
          )}
          {row.timesAdjusted && (
            // An adjustment is not a compliance warning, so it takes the info tone (SHAPE §7).
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TONE.info.solid}`}>Times adjusted by the worker</span>
          )}
          {row.returnCount > 0 && (
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TONE.neutral.solid}`}>Returned {plural(row.returnCount, 'time')}</span>
          )}
          {row.extraTime && (
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TONE.neutral.solid}`}>{EXTRA_TIME_LABEL[row.extraTime]}</span>
          )}
          <IncidentIndicator shiftId={row.shiftId} />
        </div>
      ),
    },
    ...(canReviewCompletions ? [{
      key: 'actions', header: '', align: 'right' as const, render: (row: CompletionQueueItemDto) => (
        // Always visible (not a hover-revealed RowActions): reviewing is this queue's whole purpose. sm keeps the row at --row-h.
        row.status === 'PendingReview' ? (
          <div className="flex justify-end gap-1.5 pointer-coarse:gap-2">
            <Button variant="secondary" size="sm" onClick={() => setReturnTarget(row)} aria-label={`Return ${row.staffName} with ${row.participantName} on ${formatServiceDate(row.serviceDate)}`}>
              Return
            </Button>
            <Button size="sm" onClick={() => setApproveTarget(row)} aria-label={`Approve ${row.staffName} with ${row.participantName} on ${formatServiceDate(row.serviceDate)}`}>
              Approve
            </Button>
          </div>
        ) : row.status === 'Completed' && row.extraTime ? (
          // Decided later: the shift is already approved, so this is the one place to pay the actual times or the rostered hours.
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => { setDecideStale(row.status === 'Completed' && (Date.now() - Date.parse(row.serviceDate)) / 86_400_000 > SYNC_WINDOW_DAYS); setDecideTarget(row) }} aria-label={`Extra time for ${row.staffName} with ${row.participantName} on ${formatServiceDate(row.serviceDate)}`}>
              Extra time
            </Button>
          </div>
        ) : null
      ),
    }] : []),
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader title="Completions">
        {canReviewCompletions && selectedRows.size > 0 && (
          <Button onClick={() => setBatchConfirmOpen(true)}>
            Approve selected ({selectedRows.size})
          </Button>
        )}
      </PageHeader>

      {!canReviewCompletions && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          You have read-only access here — approving, returning and batch-approving completions are unavailable.
        </p>
      )}

      {batchResults && (
        <div role="status" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]/40 p-3 text-sm space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p>
              {batchResults.filter(r => r.approved).length} approved
              {batchResults.some(r => !r.approved) && `, ${batchResults.filter(r => !r.approved).length} failed`}.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setBatchResults(null)}>Dismiss</Button>
          </div>
          {batchResults.filter(r => !r.approved).map(r => (
            <p key={r.shiftId} className="text-xs text-[var(--color-destructive)]">{r.shiftId}: {r.message ?? r.code ?? 'Could not approve.'}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Dropdown
            variant="form"
            value={statusFilter}
            onChange={v => { setStatusFilter(v as ShiftStatus); setPage(1) }}
            items={STATUS_FILTER_ITEMS}
            label="Status"
          />
        </div>
        <div className="w-56">
          <SearchableSelect
            value={staffFilter}
            onChange={setStaffFilter}
            items={[{ value: '', label: 'All staff' }, ...staffOptions]}
            placeholder="All staff"
            aria-label="Filter by staff"
          />
        </div>
        <TextField label="From" type="date" value={fromFilter} max={toFilter || undefined} onChange={e => { setFromFilter(e.target.value); setPage(1) }} />
        <TextField label="To" type="date" value={toFilter} min={fromFilter || undefined} onChange={e => { setToFilter(e.target.value); setPage(1) }} />
      </div>

      {isLoading ? (
        <PageState kind="loading" noun="shift completions" />
      ) : isError ? (
        <Callout tone="danger" actions={<Button variant="secondary" size="sm" onClick={() => refetch()}>Try again</Button>}>
          Couldn't load shift completions. Check your connection and try again.
        </Callout>
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No completions match these filters" description="Try a different status, staff member or date range." />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            keyField="shiftId"
            emptyMessage="No completions found"
            selectable={canReviewCompletions}
            selectedRows={selectedRows}
            onSelectionChange={setSelectedRows}
            pagination={{ page, pageSize: PAGE_SIZE, totalCount: data?.totalCount ?? rows.length, onPageChange: setPage }}
          />
        </>
      )}

      <ConfirmDialog
        open={approveTarget !== null}
        onCancel={closeApprove}
        onConfirm={handleApproveConfirm}
        title="Approve completion"
        confirmLabel="Approve"
        loading={approveCompletion.isPending}
        confirmDisabled={travelEditing || setBreakKind.isPending}
        alignTop
        message={
          <div className="space-y-3">
            <p>{approveTarget ? `Approve ${approveTarget.participantName}'s shift on ${unbroken(formatServiceDate(approveTarget.serviceDate))} for ${approveTarget.staffName}?` : ''}</p>
            {detail && approveTarget && (
              <WorkerAnswers c={detail} canEditTravel={pricing?.claimProviderTravel === true} onTravelOpenChange={setTravelEditing}
                breaks={{ first: firstName(approveTarget.participantName), staffFirst: firstName(approveTarget.staffName), pendingKind: setBreakKind.isPending, onChange: changeKind }} />
            )}
            {approveTarget?.extraTime === 'Pending' && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Extra time</p>
                <ExtraTimeChoiceGroup row={approveTarget} value={extraChoice} onChange={setExtraChoice} />
                <p className="text-xs text-[var(--color-muted-foreground)]">If you don't choose now, Employment Hero gets the rostered hours until you do.</p>
              </div>
            )}
            {kindError && <p role="alert" className="text-xs text-[var(--color-destructive)]">Couldn't change the break. Try again.</p>}
            {detail && <IncidentsList incidents={detail.incidents} />}
            {travelEditing && <p className="text-xs text-[var(--color-muted-foreground)]">Save or cancel the travel change first.</p>}
            {actionError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{actionError}</p>}
          </div>
        }
      />

      <Modal
        open={decideTarget !== null}
        onClose={closeDecide}
        title="Extra time"
        size="sm"
        hideClose={decideExtraTime.isPending}
        footer={<div className="flex justify-end"><Button variant="secondary" onClick={closeDecide} disabled={decideExtraTime.isPending}>Done</Button></div>}
      >
        {decideTarget?.extraTime && (
          <div className="space-y-3 text-sm">
            <p>{decideTarget.staffName} with {decideTarget.participantName} on {unbroken(formatServiceDate(decideTarget.serviceDate))}.</p>
            <p className="text-xs font-medium">{EXTRA_TIME_LABEL[decideTarget.extraTime]}</p>
            {decideStale ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">This shift is more than {SYNC_WINDOW_DAYS} days old, so Employment Hero can't be updated from here. Change its hours in Employment Hero.</p>
            ) : (
              <ExtraTimeChoiceGroup row={decideTarget} value={EXTRA_TIME_CHOICE[decideTarget.extraTime]} onChange={decide}
                disabled={decideExtraTime.isPending} saving={decideExtraTime.isPending ? decideExtraTime.variables?.decision : null} />
            )}
            {decideError && <p role="alert" className="text-xs text-[var(--color-destructive)]">Couldn't save. Try again.</p>}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={returnTarget !== null}
        onCancel={closeReturn}
        onConfirm={handleReturnConfirm}
        title="Return completion"
        variant="danger"
        confirmLabel="Return"
        loading={returnCompletion.isPending}
        message={
          <div className="space-y-3">
            <p>{returnTarget ? `Return ${returnTarget.participantName}'s shift on ${unbroken(formatServiceDate(returnTarget.serviceDate))} to ${returnTarget.staffName} for correction?` : ''}</p>
            {detail && returnTarget && <WorkerAnswers c={detail} breaks={{ first: firstName(returnTarget.participantName), staffFirst: firstName(returnTarget.staffName) }} />}
            {detail && <IncidentsList incidents={detail.incidents} />}
            <label className="block text-sm text-[var(--color-foreground)]">
              Reason (required)
              <textarea
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] p-2 text-sm"
                aria-required="true"
                aria-describedby="return-reason-hint"
              />
            </label>
            <p id="return-reason-hint" className="text-xs text-[var(--color-muted-foreground)]">The worker enters the shift details again, travel included.</p>
            {actionError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{actionError}</p>}
          </div>
        }
      />

      <ConfirmDialog
        open={batchConfirmOpen}
        onCancel={() => { setBatchConfirmOpen(false); setActionError(null) }}
        onConfirm={handleBatchApproveConfirm}
        title="Approve selected shifts"
        confirmLabel="Approve all"
        loading={approveBatch.isPending}
        message={
          <div className="space-y-2">
            <p>{`Approve ${plural(selectedRows.size, 'selected shift')}?`}</p>
            {actionError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{actionError}</p>}
          </div>
        }
      />
    </div>
  )
}
