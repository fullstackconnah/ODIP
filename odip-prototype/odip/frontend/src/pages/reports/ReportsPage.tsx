import { useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import { useHoursByWorkerReport, useLeaveTakenReport, useShiftFulfilmentReport } from '@/api/hooks'
import { LEAVE_TYPE_LABELS } from '@/api/types/leave'
import type { HoursByWorkerRowDto, LeaveTakenRowDto, ShiftFulfilmentWeekDto } from '@/api/types/reports'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column, type SortState } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { RetryCallout } from '@/components/PageState'
import { useShowAll } from '@/components/ShowAllButton'
import { TextField } from '@/components/TextField'
import { csvFileName, downloadCsv, toCsv, type CsvValue } from '@/lib/csv'
import { usePermissions } from '@/lib/permissions'
import { retryingAfterError } from '@/lib/queryPhase'
import { TONE } from '@/lib/tone'
import { formatDateAu } from '@/lib/utils'
import { defaultReportRange, reportRangeError } from './reportRange'

const STRIP = 'min-h-[60px] flex items-center justify-center px-[var(--card-pad)] py-2 text-center text-sm text-[var(--color-muted-foreground)]'
const CSV_FAILED = "Couldn't create the CSV. Try again."
const NUMBER = 'tabular-nums whitespace-nowrap'

const byText = (a: string, b: string) => a.localeCompare(b, 'en-AU')

const hours = (n: number) => n.toFixed(2)

/** The rows in the order the table shows them, so a CSV follows the screen. Same comparator rule as DataTable's own sort. */
function sortedRows<T>(rows: T[], columns: Column<T>[], sort: SortState): T[] {
  const col = columns.find(c => c.key === sort.key)
  if (!col?.sortFn) return rows
  return [...rows].sort((a, b) => (sort.direction === 'desc' ? -1 : 1) * col.sortFn!(a, b))
}

const HOURS_COLUMNS: Column<HoursByWorkerRowDto>[] = [
  { key: 'workerName', header: 'Worker', sortable: true, mobile: 'primary', sortFn: (a, b) => byText(a.workerName, b.workerName) },
  { key: 'approvedShifts', header: 'Approved shifts', sortable: true, align: 'right', sortFn: (a, b) => a.approvedShifts - b.approvedShifts, render: r => <span className={NUMBER}>{r.approvedShifts}</span> },
  { key: 'approvedHours', header: 'Approved hours', sortable: true, align: 'right', sortFn: (a, b) => a.approvedHours - b.approvedHours, render: r => <span className={NUMBER}>{hours(r.approvedHours)}</span> },
  { key: 'awaitingApprovalHours', header: 'Awaiting approval', sortable: true, align: 'right', sortFn: (a, b) => a.awaitingApprovalHours - b.awaitingApprovalHours, render: r => <span className={NUMBER}>{hours(r.awaitingApprovalHours)}</span> },
]

const count = (key: 'shifts' | 'filled' | 'unstaffed' | 'cancelled', header: string): Column<ShiftFulfilmentWeekDto> => ({
  key, header, align: 'right', render: r => <span className={NUMBER}>{r[key]}</span>,
})

const FULFILMENT_COLUMNS: Column<ShiftFulfilmentWeekDto>[] = [
  {
    key: 'weekStart', header: 'Week starting', mobile: 'primary',
    render: r => (
      <span className="whitespace-nowrap">
        <span className="md:hidden">Week starting </span>{formatDateAu(r.weekStart)}{r.partWeek ? ' (part week)' : ''}
      </span>
    ),
  },
  count('shifts', 'Shifts'),
  count('filled', 'Filled'),
  count('unstaffed', 'Unstaffed'),
  count('cancelled', 'Cancelled'),
  {
    key: 'fillRatePercent', header: 'Fill rate', align: 'right',
    render: r => r.fillRatePercent === null
      ? <><span aria-hidden="true">–</span><span className="sr-only">No shifts to fill</span></>
      : <span className={NUMBER}>{r.fillRatePercent}%</span>,
  },
]

const LEAVE_COLUMNS: Column<LeaveTakenRowDto>[] = [
  { key: 'workerName', header: 'Worker', sortable: true, mobile: 'primary', sortFn: (a, b) => byText(a.workerName, b.workerName) || byText(a.from, b.from) },
  { key: 'type', header: 'Type', mobile: 'meta', render: r => LEAVE_TYPE_LABELS[r.type] },
  {
    key: 'from', header: 'From', sortable: true, mobile: 'meta',
    sortFn: (a, b) => byText(a.from, b.from) || byText(a.workerName, b.workerName),
    render: r => <span className="whitespace-nowrap"><span className="md:hidden">From </span>{formatDateAu(r.from)}</span>,
  },
  { key: 'to', header: 'To', mobile: 'meta', render: r => <span className="whitespace-nowrap"><span className="md:hidden">to </span>{formatDateAu(r.to)}</span> },
  { key: 'daysInRange', header: 'Days in range', align: 'right', render: r => <span className={NUMBER}>{r.daysInRange}</span> },
]

const HOURS_SORT: SortState = { key: 'workerName', direction: 'asc' }
const LEAVE_SORT: SortState = { key: 'from', direction: 'asc' }

type SectionProps<T extends object> = {
  id: string
  title: string
  description: string
  noun: string
  loadingText: string
  emptyText: string
  query: UseQueryResult<T[]>
  rangeValid: boolean
  columns: Column<T>[]
  keyField: keyof T & string
  sort?: SortState
  onSortChange?: (sort: SortState | null) => void
  downloadName: string
  csvFailed: boolean
  onDownload: () => void
}

/** The shell of one report: header strip with its Download CSV, a description, then the table or the one state strip that stands in for it. */
function ReportSection<T extends object>({
  id, title, description, noun, loadingText, emptyText, query, rangeValid, columns, keyField, sort, onSortChange, downloadName, csvFailed, onDownload,
}: SectionProps<T>) {
  const rows = query.data ?? []
  const tableRef = useRef<HTMLDivElement>(null)
  const showAll = useShowAll(rows.length, tableRef, 'tbody tr')
  const hasData = query.data !== undefined
  const failed = query.isError || retryingAfterError(query)
  // Old rows stay while a new range loads or a refetch has failed; the CSV would not match the range asked for.
  const stale = query.isPlaceholderData || (hasData && query.isError)
  const showDownload = rangeValid && hasData && rows.length > 0
  let body: ReactNode
  if (!rangeValid) {
    body = <p className={STRIP}>Fix the dates above to see this report.</p>
  } else if (!hasData && failed) {
    body = <div className="p-[var(--card-pad)]"><RetryCallout onRetry={() => query.refetch()}>Couldn't load {noun}. Check your connection and try again.</RetryCallout></div>
  } else if (!hasData) {
    body = <p role="status" className={STRIP}>{loadingText}</p>
  } else if (rows.length === 0) {
    body = <p className={STRIP}>{emptyText}</p>
  } else {
    body = (
      <>
        {query.isError && <div className="p-[var(--card-pad)]"><RetryCallout onRetry={() => query.refetch()}>Couldn't load {noun}. Check your connection and try again.</RetryCallout></div>}
        <div ref={tableRef}>
          <DataTable
            data={rows}
            columns={columns}
            keyField={keyField}
            sortable={!!onSortChange}
            sort={sort}
            onSortChange={onSortChange}
            limit={showAll.limit}
            loading={query.isPlaceholderData}
            className="overflow-x-auto"
          />
        </div>
        {showAll.button && <div className="px-[var(--card-pad)] pb-2">{showAll.button}</div>}
      </>
    )
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
      <div className="px-[var(--card-pad)] py-2 bg-[var(--color-surface-container-low)] flex items-center justify-between gap-3 min-h-[calc(var(--control-h-sm)+1rem)]">
        <h2 id={`${id}-heading`} className="text-sm font-semibold">{title}</h2>
        {showDownload && (
          <Button
            variant="secondary"
            size="sm"
            className="whitespace-nowrap shrink-0"
            aria-label={`Download CSV: ${downloadName}`}
            aria-disabled={stale || undefined}
            aria-busy={stale || undefined}
            onClick={() => { if (!stale) onDownload() }}
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Download CSV
          </Button>
        )}
      </div>
      <p className="px-[var(--card-pad)] pt-2 text-[13px] text-[var(--color-muted-foreground)]">{description}</p>
      {csvFailed && <p className={`px-[var(--card-pad)] pt-1 text-[13px] ${TONE.danger.ink}`}>{CSV_FAILED}</p>}
      {body}
    </section>
  )
}

export default function ReportsPage() {
  const { hasOrganisation } = usePermissions()
  const [params, setParams] = useSearchParams()
  const fallback = defaultReportRange()
  // A cleared date stays an empty param so the field shows "Pick a date." rather than snapping back to the default.
  const from = params.get('from') ?? fallback.from
  const to = params.get('to') ?? fallback.to
  const setDate = (key: 'from' | 'to', value: string) => setParams(prev => { const next = new URLSearchParams(prev); next.set(key, value); return next }, { replace: true })

  const rangeError = reportRangeError(from, to)
  const rangeValid = !rangeError
  const enabled = rangeValid && hasOrganisation
  const range = { from, to }
  const rangeKey = `${from}/${to}`

  const hoursQuery = useHoursByWorkerReport(range, enabled)
  const fulfilmentQuery = useShiftFulfilmentReport(range, enabled)
  const leaveQuery = useLeaveTakenReport(range, enabled)

  const [hoursSort, setHoursSort] = useState(HOURS_SORT)
  const [leaveSort, setLeaveSort] = useState(LEAVE_SORT)
  const [csvFailed, setCsvFailed] = useState<{ report: string; range: string } | null>(null)
  const failedFor = (report: string) => csvFailed?.report === report && csvFailed.range === rangeKey

  function download(report: string, headers: string[], rows: CsvValue[][]) {
    setCsvFailed(null)
    try {
      downloadCsv(csvFileName(report, from, to), toCsv(headers, rows))
    } catch {
      setCsvFailed({ report, range: rangeKey })
    }
  }

  const needsDate = rangeError === 'Pick a date.'
  const fromError = needsDate && !from ? rangeError : undefined
  const toError = needsDate ? (!to ? rangeError : undefined) : rangeError ?? undefined

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <AnnouncementRegion message={csvFailed ? CSV_FAILED : ''} />
      <PageHeader title="Reports" subtitle="Hours, shift fulfilment and leave for the dates you pick, each ready to download as a CSV.">
        <div className="flex flex-wrap items-start gap-2 max-md:grid max-md:w-full max-md:grid-cols-2">
          <TextField label="From" type="date" value={from} max={to || undefined} error={fromError} onChange={e => setDate('from', e.target.value)} />
          <TextField label="To" type="date" value={to} min={from || undefined} error={toError} onChange={e => setDate('to', e.target.value)} />
        </div>
      </PageHeader>

      {!hasOrganisation ? (
        <Callout tone="info">Choose an organisation to view as first: reports belong to one organisation.</Callout>
      ) : (
        <>
          <ReportSection
            id="hours-by-worker"
            title="Hours by worker"
            description="Approved hours come from approved shift completions. Hours still waiting in Completions show as awaiting approval."
            noun="hours by worker"
            loadingText="Loading hours…"
            emptyText="No completed shifts in this range. Try a wider date range."
            query={hoursQuery}
            rangeValid={rangeValid}
            columns={HOURS_COLUMNS}
            keyField="workerId"
            sort={hoursSort}
            onSortChange={s => setHoursSort(s ?? HOURS_SORT)}
            downloadName="hours by worker"
            csvFailed={failedFor('hours-by-worker')}
            onDownload={() => download(
              'hours-by-worker',
              ['Worker', 'Approved shifts', 'Approved hours', 'Awaiting approval'],
              sortedRows(hoursQuery.data ?? [], HOURS_COLUMNS, hoursSort).map(r => [r.workerName, r.approvedShifts, hours(r.approvedHours), hours(r.awaitingApprovalHours)]),
            )}
          />
          <ReportSection
            id="shift-fulfilment"
            title="Shift fulfilment by week"
            description="Weeks run Monday to Sunday. Cancelled shifts aren't counted in the fill rate. A week cut by the range counts only its days inside it."
            noun="shift fulfilment"
            loadingText="Loading shift fulfilment…"
            emptyText="No shifts in this range. Try a wider date range."
            query={fulfilmentQuery}
            rangeValid={rangeValid}
            columns={FULFILMENT_COLUMNS}
            keyField="weekStart"
            downloadName="shift fulfilment by week"
            csvFailed={failedFor('shift-fulfilment-by-week')}
            onDownload={() => download(
              'shift-fulfilment-by-week',
              ['Week starting', 'Shifts', 'Filled', 'Unstaffed', 'Cancelled', 'Fill rate (%)', 'part_week'],
              (fulfilmentQuery.data ?? []).map(r => [r.weekStart, r.shifts, r.filled, r.unstaffed, r.cancelled, r.fillRatePercent, r.partWeek]),
            )}
          />
          <ReportSection
            id="leave-taken"
            title="Leave taken"
            description="Approved leave that falls in this range. Days in range counts only the days inside it."
            noun="leave taken"
            loadingText="Loading leave…"
            emptyText="No approved leave in this range. Try a wider date range."
            query={leaveQuery}
            rangeValid={rangeValid}
            columns={LEAVE_COLUMNS}
            keyField="leaveId"
            sort={leaveSort}
            onSortChange={s => setLeaveSort(s ?? LEAVE_SORT)}
            downloadName="leave taken"
            csvFailed={failedFor('leave-taken')}
            onDownload={() => download(
              'leave-taken',
              ['Worker', 'Type', 'From', 'To', 'Days in range'],
              sortedRows(leaveQuery.data ?? [], LEAVE_COLUMNS, leaveSort).map(r => [r.workerName, LEAVE_TYPE_LABELS[r.type], r.from, r.to, r.daysInRange]),
            )}
          />
        </>
      )}
    </div>
  )
}
