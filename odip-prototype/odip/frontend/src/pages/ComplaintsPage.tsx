import { Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { Filter, MessageSquareWarning, Plus } from 'lucide-react'
import { useComplaints, useArchiveComplaint, useRestoreComplaint } from '@/api/hooks'
import type { TruncatableList } from '@/api/hooks/pagedList'
import type { ComplaintListDto } from '@/api/types'
import { LONG_OPEN_DAYS } from '@/api/types'
import {
  COMPLAINANT_KIND_LABELS, COMPLAINT_STATUS_LABELS, COMPLAINT_STATUSES, type ComplainantKind, type ComplaintStatus,
} from '@/api/types/enums'
import { DataTable, RowActions, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { CheckboxField } from '@/components/CheckboxField'
import { SearchInput } from '@/components/SearchInput'
import { TAP_TRUNCATED_LINK } from '@/components/tapArea'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { formatDateAu } from '@/lib/utils'
import { formatServiceDate, plural } from '@/lib/format'
import { unbroken } from '@/lib/intakeBooking'
import { TONE } from '@/lib/tone'
import { retryingAfterError } from '@/lib/queryPhase'

const COMPLAINTS_PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 300

const STATUS_FILTER_ITEMS: DropdownItem[] = COMPLAINT_STATUSES.map(s => ({ value: s, label: COMPLAINT_STATUS_LABELS[s] }))

/** "Since today", "1 day", "12 days". */
function OpenFor({ openDays }: { openDays: number }) {
  // The phone card reads "Open since today" (the label is "Open"); the desktop column keeps the capital.
  const text = openDays === 0
    ? <><span className="md:hidden">since today</span><span className="max-md:hidden">Since today</span></>
    : plural(openDays, 'day')
  return <span className={`tabular-nums ${openDays > LONG_OPEN_DAYS ? `${TONE.warning.ink} font-medium` : ''}`}>{text}</span>
}

function complainantText(row: ComplaintListDto): string {
  const kind = COMPLAINANT_KIND_LABELS[row.complainantKind as ComplainantKind] ?? row.complainantKind
  const name = row.complainantKind === 'Participant' ? row.participantName : row.complainantName
  return row.complainantKind === 'Anonymous' || !name ? kind : `${kind} · ${name}`
}

export default function ComplaintsPage() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const longOpenOnly = params.get('open') === 'over21'
  const q = params.get('q') ?? ''
  const setParam = (key: string, value: string) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (value) next.set(key, value)
    else next.delete(key)
    return next
  }, { replace: true })
  const [page, setPage] = useState(1)
  const search = useDebouncedValue(q.trim(), SEARCH_DEBOUNCE_MS)

  const archiveComplaint = useArchiveComplaint()
  const restoreComplaint = useRestoreComplaint()
  const { showArchived, params: archiveParams, toggleButtons, confirmDialog, errorNotice, actionButtons } = useArchiveRestore<ComplaintListDto>({
    deleteMutation: archiveComplaint,
    restoreMutation: restoreComplaint,
    // Never the complainant's name: the confirm dialog and any error line name the complaint by its date.
    entityName: c => `the complaint received ${unbroken(formatServiceDate(c.receivedOn))}`,
    entityId: c => c.id,
    restoreData: () => ({}),
    editPath: c => `/complaints/${c.id}`,
  })

  const queryParams: Record<string, string> = { ...archiveParams, page: String(page), pageSize: String(COMPLAINTS_PAGE_SIZE) }
  if (search) queryParams.search = search
  if (!showArchived) {
    if (status) queryParams.status = status
    if (longOpenOnly) queryParams.longOpen = 'true'
  }

  const pageQuery = useComplaints(queryParams)
  const { data: complaints = [], isLoading, isError, error, refetch } = pageQuery
  const { totalCount = complaints.length } = complaints as Partial<TruncatableList<ComplaintListDto>>
  const forbidden = apiErrorStatus(error) === 403

  // A filter change can leave `page` past the end of the smaller result: back to page 1 (adjusted during render, as IncidentsPage does).
  const filterResetKey = `${status}|${longOpenOnly}|${search}|${showArchived}`
  const [prevFilterResetKey, setPrevFilterResetKey] = useState(filterResetKey)
  if (filterResetKey !== prevFilterResetKey) {
    setPrevFilterResetKey(filterResetKey)
    setPage(1)
  }

  const clearFilters = () => setParams(prev => {
    const next = new URLSearchParams(prev)
    next.delete('status'); next.delete('open'); next.delete('q')
    return next
  }, { replace: true })

  // 1280 budget (content 1008): Summary 264 + Complainant 184 + Received 104 + Status 112 + Open for 96 + Acknowledged 112 + actions 76 = 948.
  const columns: Column<ComplaintListDto>[] = [
    {
      key: 'summary',
      header: 'Summary',
      mobile: 'primary',
      className: 'font-medium',
      render: c => (
        <Link to={`/complaints/${c.id}`} title={c.summary} className={`block max-md:line-clamp-3 md:truncate md:max-w-[15rem] text-[var(--color-primary)] hover:underline ${TAP_TRUNCATED_LINK}`}>
          {c.summary}
        </Link>
      ),
    },
    // A long unbroken name would stretch the table's min-content width, and with it every phone card.
    { key: 'complainant', header: 'Complainant', maxWidth: '12rem', className: 'max-md:[overflow-wrap:anywhere]', mobile: 'meta', render: complainantText },
    { key: 'receivedOn', header: 'Received', mobile: 'meta', render: c => <span><span className="md:hidden">Received </span>{formatDateAu(c.receivedOn)}</span> },
    { key: 'status', header: 'Status', mobile: 'status', render: c => <StatusBadge status={c.status} label={COMPLAINT_STATUS_LABELS[c.status as ComplaintStatus] ?? c.status} /> },
    {
      key: 'openDays',
      header: 'Open for',
      mobile: 'meta',
      render: c => c.openDays == null
        ? <span><span aria-hidden="true" className="max-md:hidden">{'–'}</span><span className="md:sr-only">Not open</span></span>
        : <span><span className="md:hidden">Open </span><OpenFor openDays={c.openDays} /></span>,
    },
    {
      key: 'acknowledgedOn',
      header: 'Acknowledged',
      mobile: 'meta',
      render: c => c.acknowledgedOn
        ? <span><span className="md:hidden">Acknowledged </span>{formatDateAu(c.acknowledgedOn)}</span>
        : <span className="text-[var(--color-muted-foreground)]"><span className="md:hidden">Not acknowledged</span><span className="max-md:hidden">Not yet</span></span>,
    },
    { key: 'actions', header: '', render: c => <RowActions>{actionButtons(c)}</RowActions> },
  ]

  const recordAction = !showArchived && (
    <Button to="/complaints/new" size="md">
      <Plus className="w-4 h-4" /> Record a complaint
    </Button>
  )

  const filtered = !!(status || longOpenOnly || search)
  const emptyState = showArchived ? (
    <EmptyState icon={MessageSquareWarning} title="No archived complaints" description="Archived complaints appear here, and you can restore them." />
  ) : longOpenOnly && !status && !search ? (
    <EmptyState
      icon={MessageSquareWarning}
      title="No complaints open longer than 21 days"
      description="Every open complaint is 21 days old or newer."
      action={{ label: 'Show all open complaints', onClick: () => setParam('open', '') }}
    />
  ) : filtered ? (
    <EmptyState
      icon={MessageSquareWarning}
      title="No complaints match"
      description="Try a different status or search, or clear the filters."
      action={{ label: 'Clear filters', onClick: clearFilters }}
    />
  ) : (
    <EmptyState
      icon={MessageSquareWarning}
      title="No complaints recorded"
      description="Record every complaint here, however it reached you: in person, by phone, email or letter. You'll see how long each one has been open."
      action={{ label: 'Record a complaint', to: '/complaints/new' }}
    />
  )

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader title="Complaints" subtitle={forbidden || isLoading || isError ? undefined : plural(totalCount, 'complaint')} action={recordAction}>
        {toggleButtons}
        {!showArchived && (
          <>
            <div className="flex items-center gap-1.5">
              <Filter aria-hidden="true" className="w-4 h-4 text-[var(--color-muted-foreground)]" />
              <Dropdown
                variant="pill"
                value={status}
                onChange={value => setParam('status', value)}
                label="All statuses"
                items={STATUS_FILTER_ITEMS}
                colorClass="bg-[var(--color-input)] border border-[var(--color-border)]"
              />
            </div>
            <CheckboxField
              label="Open longer than 21 days"
              checked={longOpenOnly}
              onChange={e => setParam('open', e.target.checked ? 'over21' : '')}
            />
          </>
        )}
        <SearchInput
          value={q}
          onChange={value => setParam('q', value)}
          placeholder="Search complaints…"
          label="Search complaints"
          className="max-w-md flex-1 max-sm:max-w-none max-sm:basis-full"
        />
      </PageHeader>

      {errorNotice}

      {forbidden ? (
        <Callout tone="danger">You can't see complaints. They're for Admins and Coordinators.</Callout>
      ) : !isLoading && !isError && complaints.length === 0 ? (
        emptyState
      ) : (
        <DataTable
          data={complaints}
          columns={columns}
          keyField="id"
          loading={isLoading}
          error={isError || retryingAfterError(pageQuery)}
          onRetry={() => refetch()}
          emptyMessage="No complaints found"
          pagination={{ page, pageSize: COMPLAINTS_PAGE_SIZE, totalCount, onPageChange: setPage }}
        />
      )}
      {confirmDialog}
    </div>
  )
}
