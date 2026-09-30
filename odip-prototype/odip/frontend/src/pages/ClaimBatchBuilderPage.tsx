import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useBillableEvents, useValidateClaimBatch, useCreateClaimBatch } from '@/api/hooks'
import type { BillableEventDto, BillingValidationResultDto } from '@/api/types'
import { INCOME_STREAMS, INCOME_STREAM_LABELS } from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Dropdown } from '@/components/Dropdown'
import { ParticipantPicker } from '@/components/ParticipantPicker'
import { formatCurrency, formatDateAu } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  FilterX,
  Inbox,
  ListChecks,
  Loader2,
  ShieldCheck,
} from 'lucide-react'

// ── Filter option list — driven by the shared IncomeStream enum ──

const STREAM_OPTIONS = INCOME_STREAMS.map(value => ({ value, label: INCOME_STREAM_LABELS[value] }))

// Stable, module-level empty-array fallback for `useBillableEvents`'s `data` while it's
// undefined (pre-fetch / loading). A `= []` default in the destructure below would allocate a
// NEW array literal on every render, and the render-time state sync a few lines down keys off
// `events`'s referential identity — a fresh literal every render never settles, causing
// "Too many re-renders".
const NO_EVENTS: BillableEventDto[] = []

const dateInputClass =
  'px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-input)] border border-[var(--color-border)] text-sm ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:opacity-50 disabled:cursor-not-allowed transition-all'

const filterLabelClass = 'block text-xs font-medium text-[var(--color-muted-foreground)] mb-1'

const primaryBtn =
  'inline-flex items-center gap-2 px-4 h-[var(--control-h)] rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium ' +
  'hover:bg-[var(--color-primary)]/90 active:bg-[var(--color-primary)]/80 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ' +
  'transition-all shadow-md shadow-[var(--color-primary)]/20'

const secondaryBtn =
  'inline-flex items-center gap-2 px-4 h-[var(--control-h)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] ' +
  'text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-accent)] active:bg-[var(--color-accent)]/70 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed transition-all'

const linkBtn =
  'text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded'

// ── Loading skeleton — replaces DataTable's built-in spinner for the initial load so content ──
// ── doesn't jump when data arrives. Purely decorative; a live region announces the state. ──

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">Loading unclaimed billable events…</div>
      <div aria-hidden="true" className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden">
        <div className="h-10 bg-[var(--color-accent)]" />
        <div className="divide-y divide-[var(--color-border)]">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-3">
              <div className="h-4 w-4 rounded bg-[var(--color-input)] animate-pulse shrink-0" />
              <div className="h-4 flex-[2] rounded bg-[var(--color-input)] animate-pulse" />
              <div className="h-4 flex-1 rounded bg-[var(--color-input)] animate-pulse" />
              <div className="h-4 flex-1 rounded bg-[var(--color-input)] animate-pulse" />
              <div className="h-4 w-20 rounded bg-[var(--color-input)] animate-pulse shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default function ClaimBatchBuilderPage() {
  const navigate = useNavigate()
  const { canWrite } = usePermissions()

  // ── Filters ──────────────────────────────────────────────────────────────
  const [participantId, setParticipantId] = useState('')
  const [stream, setStream] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const filtersActive = !!(participantId || stream || fromDate || toDate)

  function clearFilters() {
    setParticipantId('')
    setStream('')
    setFromDate('')
    setToDate('')
  }

  const queryParams = useMemo(() => {
    // Unclaimed = Draft. Once an event is Validated/Claimed/etc it belongs to a batch already
    // (or is mid-route) and has no business appearing as a fresh candidate here.
    const params: Record<string, string> = { status: 'Draft' }
    if (participantId) params.participantId = participantId
    if (stream) params.stream = stream
    if (fromDate) params.fromDate = fromDate
    if (toDate) params.toDate = toDate
    return params
  }, [participantId, stream, fromDate, toDate])

  const { data, isLoading, isFetching, isError } = useBillableEvents(queryParams)
  const events = data ?? NO_EVENTS

  // ── Selection — survives filter changes ─────────────────────────────────
  // `selectedIds` is never touched by a refetch. `knownEvents` accumulates event records we've
  // actually seen so a selection made under one filter still has amount/name data available
  // after the filters change and that event scrolls out of the current result set.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [knownEvents, setKnownEvents] = useState<Record<string, BillableEventDto>>({})

  // Adjusted during render rather than in an effect — this is React's documented pattern
  // for syncing state from a changed value (react.dev: "you might not need an effect").
  // `lastSeenEvents` gates the merge to once per new `events` array identity, matching the
  // previous effect's `[events]` dependency, while avoiding the extra commit+re-render an
  // effect would cost. Empty result sets (a fetch/filter transition) are ignored so the
  // accumulator is never clobbered.
  const [lastSeenEvents, setLastSeenEvents] = useState<BillableEventDto[] | null>(null)
  if (events !== lastSeenEvents) {
    setLastSeenEvents(events)
    if (events.length > 0) {
      setKnownEvents(prev => {
        const next = { ...prev }
        for (const e of events) next[e.id] = e
        return next
      })
    }
  }

  const selectedEvents = useMemo(
    () => Array.from(selectedIds).map(id => knownEvents[id]).filter((e): e is BillableEventDto => !!e),
    [selectedIds, knownEvents]
  )
  const selectedCount = selectedIds.size
  const selectedTotal = selectedEvents.reduce((sum, e) => sum + e.totalAmount, 0)
  const selectedIdsSorted = useMemo(() => Array.from(selectedIds).sort(), [selectedIds])

  // ── Validation — a free, repeatable dry run. Never mutates. ─────────────
  const validateMutation = useValidateClaimBatch()
  const createMutation = useCreateClaimBatch()
  const [validation, setValidation] = useState<{ ids: string[]; results: BillingValidationResultDto[] } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // THE STALE-VALIDATION GUARD — a clean pass only authorises Create while the selection it
  // was run against is exactly the current selection. Any change (add, remove, or a filter
  // change that drops a selected row) makes `isValidationStale` true immediately, which alone
  // is enough to disable Create — no explicit "clear the old result" step is required, and the
  // stale result stays visible (labelled stale) rather than silently vanishing.
  const isValidationStale = useMemo(() => {
    if (!validation) return true
    if (validation.ids.length !== selectedIdsSorted.length) return true
    return validation.ids.some((id, i) => id !== selectedIdsSorted[i])
  }, [validation, selectedIdsSorted])

  const resultsByEvent = useMemo(() => {
    const map = new Map<string, BillingValidationResultDto[]>()
    if (!validation || isValidationStale) return map
    for (const r of validation.results) {
      const list = map.get(r.eventId) ?? []
      list.push(r)
      map.set(r.eventId, list)
    }
    return map
  }, [validation, isValidationStale])

  const errorCount = !isValidationStale ? (validation?.results.filter(r => r.severity === 'Error').length ?? 0) : 0
  const warningCount = !isValidationStale ? (validation?.results.filter(r => r.severity === 'Warning').length ?? 0) : 0

  const canCreate = !isValidationStale && !!validation && errorCount === 0 && selectedCount > 0

  function handleValidate() {
    if (selectedIdsSorted.length === 0) return
    validateMutation.mutate(
      { eventIds: selectedIdsSorted },
      { onSuccess: results => setValidation({ ids: selectedIdsSorted, results }) }
    )
  }

  function handleConfirmCreate() {
    createMutation.mutate(
      { eventIds: selectedIdsSorted },
      {
        onSuccess: batch => {
          setConfirmOpen(false)
          navigate(`/billing/claim-batches/${batch.id}`)
        },
      }
    )
  }

  let createHelpText = ''
  if (selectedCount === 0) createHelpText = 'Select at least one event to create a batch.'
  else if (!validation || isValidationStale) createHelpText = 'Validate the current selection before creating a batch.'
  else if (errorCount > 0) createHelpText = `Resolve ${errorCount} error${errorCount !== 1 ? 's' : ''} before creating a batch.`
  const createHelpId = 'create-batch-help'

  // ── Table columns ────────────────────────────────────────────────────────
  // Column budget (density §4): ten columns with an uncapped participant and reference need ~1600px against a ~1006px box at 1280, which
  // pushed the Findings column off-screen. Both are capped (ellipsis, full text in the tooltip); Stream gives way below 2xl (1536)
  // and Day Type below 1792.
  const columns: Column<BillableEventDto>[] = [
    {
      key: 'participantName',
      header: 'Participant',
      sortable: true,
      className: 'font-medium',
      maxWidth: '10rem',
      render: e => e.participantName || '—',
    },
    {
      key: 'stream',
      header: 'Stream',
      sortable: true,
      priority: 'low',
      render: e => INCOME_STREAM_LABELS[e.stream] ?? e.stream,
    },
    {
      key: 'supportItemNumber',
      header: 'Support Item',
      className: 'font-mono text-xs text-[var(--color-muted-foreground)]',
    },
    { key: 'dayType', header: 'Day Type', sortable: true, priority: 'lowest' },
    {
      key: 'supportsDeliveredFrom',
      header: 'Dates',
      sortable: true,
      render: e => (
        <span className="text-xs text-[var(--color-muted-foreground)] whitespace-nowrap">
          {formatDateAu(e.supportsDeliveredFrom)} – {formatDateAu(e.supportsDeliveredTo)}
        </span>
      ),
    },
    {
      key: 'quantity',
      header: 'Qty / Hours',
      align: 'right' as const,
      render: e => (e.hours != null ? `${e.hours}h` : e.quantity != null ? String(e.quantity) : '—'),
    },
    {
      key: 'totalAmount',
      header: 'Amount',
      type: 'currency' as const,
      align: 'right' as const,
      sortable: true,
      className: 'font-medium',
    },
    {
      key: 'claimReference',
      header: 'Reference',
      maxWidth: '8rem',
      className: 'font-mono text-xs text-[var(--color-muted-foreground)]',
    },
    {
      key: 'findings',
      header: 'Findings',
      render: e => {
        if (!validation || isValidationStale) {
          return <span className="text-xs text-[var(--color-muted-foreground)] opacity-50">—</span>
        }
        const rowResults = resultsByEvent.get(e.id)
        if (!rowResults || rowResults.length === 0) {
          return (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-primary)]">
              <CheckCircle2 className="w-3.5 h-3.5" /> Clean
            </span>
          )
        }
        return (
          <div className="flex flex-col gap-1">
            {rowResults.map((r, i) => (
              <span
                key={i}
                title={r.code}
                className={`inline-flex items-start gap-1 text-xs px-2 py-0.5 rounded-full w-fit ${
                  r.severity === 'Error'
                    ? 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
                    : 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
                }`}
              >
                {r.severity === 'Error' ? (
                  <CircleAlert className="w-3 h-3 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                )}
                {r.message}
              </span>
            ))}
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <div className="text-sm text-[var(--color-muted-foreground)]">
        <Link to="/billing" className={linkBtn}>← Back to Billing</Link>
      </div>

      <PageHeader
        title="Build Claim Batch"
        subtitle={`${events.length} unclaimed event${events.length !== 1 ? 's' : ''}${filtersActive ? ' matching filters' : ''}`}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-[var(--card-pad)]">
        <div>
          <label id="filter-participant-label" className={filterLabelClass}>Participant</label>
          <ParticipantPicker
            id="filter-participant"
            aria-labelledby="filter-participant-label"
            value={participantId}
            onChange={setParticipantId}
            placeholder="All participants"
          />
        </div>
        <div>
          <label id="filter-stream-label" className={filterLabelClass}>Stream</label>
          <Dropdown
            variant="pill"
            id="filter-stream"
            aria-labelledby="filter-stream-label"
            value={stream}
            onChange={setStream}
            label="All streams"
            items={STREAM_OPTIONS}
            colorClass="bg-[var(--color-input)] border border-[var(--color-border)]"
          />
        </div>
        <div>
          <label htmlFor="filter-from" className={filterLabelClass}>From</label>
          <input
            id="filter-from"
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className={dateInputClass}
          />
        </div>
        <div>
          <label htmlFor="filter-to" className={filterLabelClass}>To</label>
          <input
            id="filter-to"
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className={dateInputClass}
          />
        </div>
        {filtersActive && (
          <button type="button" onClick={clearFilters} className={secondaryBtn}>
            <FilterX className="w-4 h-4" /> Clear filters
          </button>
        )}
      </div>

      {canWrite && (
        <>
          {/* Selection summary + actions */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-[var(--card-pad)]">
            <div>
              <p className="text-sm font-semibold text-[var(--color-foreground)]">
                {selectedCount} event{selectedCount !== 1 ? 's' : ''} selected
              </p>
              <p className="text-xs text-[var(--color-muted-foreground)]">Total {formatCurrency(selectedTotal)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-col items-start gap-1">
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={selectedCount === 0 || validateMutation.isPending}
                  className={secondaryBtn}
                >
                  {validateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
                  {validateMutation.isPending ? 'Validating…' : 'Validate selection'}
                </button>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Read-only — validating never creates or changes anything.
                </p>
                {validateMutation.isError && (
                  <p role="alert" className="text-xs text-[var(--color-destructive)]">
                    Couldn't validate the selection. Check your connection and try again.
                  </p>
                )}
              </div>
              <div className="flex flex-col items-start gap-1">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canCreate || createMutation.isPending}
                  aria-describedby={createHelpText ? createHelpId : undefined}
                  className={primaryBtn}
                >
                  <ListChecks className="w-4 h-4" />
                  Create claim batch
                </button>
                {createHelpText && (
                  <p id={createHelpId} className="text-xs text-[var(--color-muted-foreground)]">{createHelpText}</p>
                )}
              </div>
            </div>
          </div>

          {/* Validation result banner */}
          {validation && (
            <div
              className={`flex items-start gap-3 p-4 rounded-[var(--radius-md)] border text-sm ${
                isValidationStale
                  ? 'bg-[var(--color-surface-container-low)] border-[var(--color-border)] text-[var(--color-muted-foreground)]'
                  : errorCount > 0
                  ? 'bg-[var(--color-error-container)]/40 border-[var(--color-error-container)] text-[var(--color-on-error-container)]'
                  : 'bg-[var(--color-primary-fixed)]/40 border-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
              }`}
              role="status"
            >
              {isValidationStale ? (
                <>
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p>
                    <strong>Selection changed since the last validation.</strong> Run validation again before
                    creating a batch — the previous result no longer applies.
                  </p>
                </>
              ) : errorCount > 0 ? (
                <>
                  <CircleAlert className="w-5 h-5 shrink-0 mt-0.5" />
                  <p>
                    <strong>{errorCount} error{errorCount !== 1 ? 's' : ''}</strong>
                    {warningCount > 0 ? ` and ${warningCount} warning${warningCount !== 1 ? 's' : ''}` : ''} found.
                    Fix the flagged events before creating a batch — nothing was created.
                  </p>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
                  <p>
                    <strong>Validation passed</strong>
                    {warningCount > 0 ? ` with ${warningCount} warning${warningCount !== 1 ? 's' : ''}` : ''} —
                    nothing was changed. You can now create the batch.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Table / states */}
      {isError ? (
        <div className="p-[var(--card-pad)] text-center text-[var(--color-destructive)]">
          Failed to load billable events. Please refresh the page.
        </div>
      ) : isLoading && events.length === 0 ? (
        <TableSkeleton />
      ) : !isLoading && events.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={FilterX}
            title="No events match your filters"
            description="Try widening the date range or clearing a filter to see unclaimed billable events again."
            action={{ label: 'Clear filters', onClick: clearFilters }}
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="No unclaimed events right now"
            description="Every billable event has already been claimed, invoiced, or routed elsewhere. New events land here in Draft status as soon as they're generated."
          />
        )
      ) : (
        <DataTable
          data={events}
          columns={columns}
          keyField="id"
          sortable
          loading={isFetching}
          selectable={canWrite}
          selectedRows={selectedIds}
          onSelectionChange={setSelectedIds}
          rowClassName={e => {
            if (!validation || isValidationStale) return ''
            const rowResults = resultsByEvent.get(e.id)
            if (rowResults?.some(r => r.severity === 'Error')) return 'bg-[var(--color-error-container)]/20'
            if (rowResults?.some(r => r.severity === 'Warning')) return 'bg-[var(--color-warning-container)]/20'
            return ''
          }}
          emptyMessage="No unclaimed events found"
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => { if (!createMutation.isPending) setConfirmOpen(false) }}
        onConfirm={handleConfirmCreate}
        variant="danger"
        loading={createMutation.isPending}
        title="Create claim batch?"
        confirmLabel="Create batch"
        message={
          <>
            <p>
              Create a claim batch from <strong>{selectedCount} event{selectedCount !== 1 ? 's' : ''}</strong> totalling{' '}
              <strong>{formatCurrency(selectedTotal)}</strong>? This consumes service-booking balance and cannot be undone.
            </p>
            {createMutation.isError && (
              <p role="alert" className="text-[var(--color-destructive)]">
                Couldn't create the batch. Please check the flagged events and try again.
              </p>
            )}
          </>
        }
      />
    </div>
  )
}
