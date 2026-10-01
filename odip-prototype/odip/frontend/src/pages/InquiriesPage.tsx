import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPlus, Search } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { SearchInput } from '@/components/SearchInput'
import { ToggleGroup } from '@/components/ToggleGroup'
import { useConvertParticipantInquiry, useParticipantInquiries } from '@/api/hooks'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { queryPhase } from '@/lib/queryPhase'

/**
 * Where an enquiry has got to. `new`: no participant yet. `draftintake`: a draft participant whose intake is still open. `intakecomplete`:
 * intake done, onboarding and profile in progress. `participant`: finalised. An API that does not send the participant's state (an older
 * server) leaves the first two to tell apart as before: any converted enquiry is a draft intake.
 */
type Stage = 'new' | 'draftintake' | 'intakecomplete' | 'participant'

function stageOf(row: ParticipantInquiryDto): Stage {
  if (!row.participantId) return 'new'
  if (row.participantIsDraft === false) return 'participant'
  return row.participantIntakeCompletedAt ? 'intakecomplete' : 'draftintake'
}

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'draftintake', label: 'Draft intake' },
  { key: 'converted', label: 'In onboarding' },
]
const matchesFilter = (stage: Stage, filter: string) =>
  filter === 'all' || filter === stage || (filter === 'converted' && (stage === 'intakecomplete' || stage === 'participant'))

export default function InquiriesPage() {
  const screen = useInquiriesScreen()
  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Enquiries"
        subtitle="Capture new enquiries and start their intake. Starting intake creates an inactive draft participant you can come back to."
      >
        {screen.showTable && screen.toolbar}
      </PageHeader>
      {screen.body}
    </div>
  )
}

/**
 * Body export — rendered by the ParticipantsHubPage tabbed container so the hub owns
 * one PageHeader. The standalone /inquiries route is now redirected to
 * /participants?tab=enquiries, so this default page component is only retained for the
 * dedicated InquiriesPage test that mounts it under its own MemoryRouter.
 *
 * Capture/edit lives on its own routed page at /participants/new-inquiry — see
 * InquiryFormPage. Edit and Start-intake remain row-level actions here. The status filter and
 * search render above the table: the hub used to show the body alone, which left them with nowhere to live (L2-02).
 */
export function InquiriesTable() {
  const screen = useInquiriesScreen()
  return (
    <>
      {screen.showTable && <div className="flex flex-wrap items-center gap-3 mb-4">{screen.toolbar}</div>}
      {screen.body}
    </>
  )
}

function useInquiriesScreen() {
  const navigate = useNavigate()
  const { canManageParticipantLifecycle } = usePermissions()
  const inquiriesQuery = useParticipantInquiries()
  const { data: inquiries = [], isError, refetch } = inquiriesQuery
  // A request that has not run (paused while the browser reports offline: isLoading false, isError false, data undefined) is loading, not an
  // empty list: "No enquiries captured yet" follows only a request that succeeded.
  const isLoading = queryPhase(inquiriesQuery) === 'loading'
  const convert = useConvertParticipantInquiry()
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const openNew = () => navigate('/participants/new-inquiry')
  const editExisting = (row: ParticipantInquiryDto) => navigate(`/participants/new-inquiry?id=${encodeURIComponent(row.id)}`)
  const startIntake = (id: string) => {
    setError(null)
    convert.mutate(
      { id },
      {
        onSuccess: (inquiry: ParticipantInquiryDto) => {
          if (inquiry.participantId) navigate(`/participants/${inquiry.participantId}/intake`)
        },
        onError: err => setError(extractErrorMessage(err, 'Could not start intake. Please try again.')),
      },
    )
  }
  // The /inquiries endpoint takes no query parameters, so filtering is client-side over the
  // already-fetched tenant-scoped list (the server owns the tenant predicate).
  const filtered = inquiries.filter(row => {
    if (!matchesFilter(stageOf(row), statusFilter)) return false
    if (!search.trim()) return true
    const term = search.trim().toLowerCase()
    return [row.firstName, row.lastName, row.phone, row.email, row.source, row.provenance]
      .filter(Boolean)
      .some(field => String(field).toLowerCase().includes(term))
  })
  const countFor = (key: string) => inquiries.filter(row => matchesFilter(stageOf(row), key)).length
  const statusOptions = STATUS_FILTERS.map(o => ({ key: o.key, label: `${o.label} (${countFor(o.key)})` }))

  const statusBadge = (row: ParticipantInquiryDto) => {
    switch (stageOf(row)) {
      case 'new': return <StatusBadge status="new" label="New" />
      case 'draftintake': return <StatusBadge status="draftintake" label="Draft intake" />
      case 'intakecomplete': return <StatusBadge status="complete" label="Intake complete" />
      case 'participant': return row.participantIsActive === false
        ? <StatusBadge status="inactive" label="Inactive participant" />
        : <StatusBadge status="active" label="Participant" />
    }
  }
  // The one next step that is real for each stage. Resuming an intake that is complete led to the L2-03 data loss.
  const primaryAction = (row: ParticipantInquiryDto) => {
    switch (stageOf(row)) {
      case 'new': return <Button size="sm" disabled={convert.isPending} onClick={() => startIntake(row.id)}>Start intake</Button>
      case 'draftintake': return <Button size="sm" onClick={() => navigate(`/participants/${row.participantId}/intake`)}>Resume intake</Button>
      case 'intakecomplete': return <Button size="sm" onClick={() => navigate(`/onboarding/${row.participantId}`)}>Open onboarding</Button>
      case 'participant': return <Button size="sm" onClick={() => navigate(`/participants/${row.participantId}`)}>Open participant</Button>
    }
  }

  const columns: Column<ParticipantInquiryDto>[] = [
    { key: 'firstName', header: 'Name', sortable: true, render: row => `${row.firstName} ${row.lastName}` },
    { key: 'phone', header: 'Contact', render: row => row.phone || row.email || 'No contact details' },
    { key: 'source', header: 'Source', sortable: true },
    {
      key: 'provenance',
      header: 'Provenance',
      render: row => {
        const text = row.provenance || '—'
        if (!row.provenance) return <span>{text}</span>
        return (
          <span
            className="block max-w-[280px] truncate text-sm text-[var(--color-muted-foreground)]"
            title={row.provenance}
          >
            {text}
          </span>
        )
      },
    },
    { key: 'participantId', header: 'Status', render: statusBadge },
    {
      key: 'id', header: 'Actions', type: 'custom',
      render: row => canManageParticipantLifecycle ? (
        <div className="flex flex-wrap gap-2">
          {primaryAction(row)}
          <Button size="sm" variant="secondary" onClick={() => editExisting(row)}>Edit enquiry</Button>
        </div>
      ) : <span className="text-sm text-[var(--color-muted-foreground)]">Read-only</span>,
    },
  ]
  const showEmptyState = !isError && !isLoading && inquiries.length === 0
  const showTable = !isError && !showEmptyState && (inquiries.length > 0 || isLoading)

  const toolbar = (
    <>
      <ToggleGroup options={statusOptions} value={statusFilter} onChange={setStatusFilter} ariaLabel="Filter enquiries by status" />
      <SearchInput value={search} onChange={setSearch} placeholder="Search enquiries..." />
    </>
  )

  const body = (
    <>
      {isError && (
        <Callout
          tone="error"
          actions={<button type="button" className="font-medium underline shrink-0" onClick={() => refetch()}>Retry</button>}
        >
          Could not load enquiries. Please try again.
        </Callout>
      )}
      {!canManageParticipantLifecycle && <p role="status" className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-accent)] p-3 text-sm text-[var(--color-muted-foreground)]">You can review enquiries, but your role cannot capture, edit, or start participant intake.</p>}
      {error && <Callout tone="error">{error}</Callout>}
      {showEmptyState && <EmptyState icon={ClipboardPlus} title="No enquiries captured yet" description="Capture a light enquiry when someone first contacts the service, then start their draft intake when ready." action={canManageParticipantLifecycle ? { label: 'New enquiry', onClick: openNew } : undefined} />}
      {showTable && !isLoading && filtered.length === 0
        ? <EmptyState icon={Search} title="No enquiries match your search" description="Try a different search term or filter, or clear the search to see all enquiries." action={{ label: 'Clear search and filter', onClick: () => { setSearch(''); setStatusFilter('all') } }} />
        : showTable && <DataTable data={filtered} columns={columns} keyField="id" loading={isLoading} sortable emptyMessage="No enquiries captured yet." />}
    </>
  )

  return {
    canManageParticipantLifecycle,
    toolbar,
    showEmptyState,
    showTable,
    openNew,
    body,
  }
}
