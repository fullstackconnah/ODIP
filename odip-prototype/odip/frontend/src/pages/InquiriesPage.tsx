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

export default function InquiriesPage() {
  const screen = useInquiriesScreen()
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Enquiries"
        subtitle="Capture new enquiries and start their intake. Starting intake creates an inactive draft participant you can come back to."
      >
        {screen.showTable && <ToggleGroup options={screen.statusOptions} value={screen.statusFilter} onChange={screen.setStatusFilter} ariaLabel="Filter enquiries by status" />}
        {screen.showTable && <SearchInput value={screen.search} onChange={screen.setSearch} placeholder="Search enquiries..." />}
      </PageHeader>
      {screen.body}
    </div>
  )
}

/**
 * Body export — rendered by the ParticipantsHubPage tabbed container so the hub owns
 * one PageHeader; the standalone /inquiries route keeps using InquiriesPage above.
 *
 * Capture/edit lives on its own routed page at /participants/new-inquiry — see
 * InquiryFormPage. Edit and Start-intake remain row-level actions here.
 */
export function InquiriesTable() {
  const screen = useInquiriesScreen()
  return <>{screen.body}</>
}

function useInquiriesScreen() {
  const navigate = useNavigate()
  const { canManageParticipantLifecycle } = usePermissions()
  const { data: inquiries = [], isLoading, isError, refetch } = useParticipantInquiries()
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
        onError: () => setError('Could not start intake. Please try again.'),
      },
    )
  }
  // The /inquiries endpoint takes no query parameters, so filtering is client-side over the
  // already-fetched tenant-scoped list (the server owns the tenant predicate).
  const STATUS_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'new', label: 'New' },
    { key: 'draftintake', label: 'Draft intake' },
  ]
  const statusOf = (row: ParticipantInquiryDto) => (row.participantId ? 'draftintake' : 'new')
  const matchesStatus = (row: ParticipantInquiryDto) => statusFilter === 'all' || statusOf(row) === statusFilter
  const filtered = inquiries.filter(row => {
    if (!matchesStatus(row)) return false
    if (!search.trim()) return true
    const term = search.trim().toLowerCase()
    return [row.firstName, row.lastName, row.phone, row.email, row.source, row.provenance]
      .filter(Boolean)
      .some(field => String(field).toLowerCase().includes(term))
  })
  const countFor = (key: string) => inquiries.filter(row => key === 'all' || statusOf(row) === key).length
  const statusOptions = STATUS_FILTERS.map(o => ({ key: o.key, label: `${o.label} (${countFor(o.key)})` }))

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
    { key: 'participantId', header: 'Status', render: row => row.participantId ? <StatusBadge status="draftintake" label="Draft intake" /> : <StatusBadge status="new" label="New" /> },
    {
      key: 'id', header: 'Actions', type: 'custom',
      render: row => canManageParticipantLifecycle ? (
        <div className="flex flex-wrap gap-2">
          {row.participantId
            ? <Button size="sm" onClick={() => navigate(`/participants/${row.participantId}/intake`)}>Resume intake</Button>
            : <Button size="sm" disabled={convert.isPending} onClick={() => startIntake(row.id)}>Start intake</Button>}
          <Button size="sm" variant="secondary" onClick={() => editExisting(row)}>Edit enquiry</Button>
        </div>
      ) : <span className="text-sm text-[var(--color-muted-foreground)]">Read-only</span>,
    },
  ]
  const showEmptyState = !isError && !isLoading && inquiries.length === 0
  const showTable = !isError && !showEmptyState && (inquiries.length > 0 || isLoading)

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
      {!canManageParticipantLifecycle && <p role="status" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)] p-3 text-sm text-[var(--color-muted-foreground)]">You can review enquiries, but your role cannot capture, edit, or start participant intake.</p>}
      {error && <Callout tone="error">{error}</Callout>}
      {showEmptyState && <EmptyState icon={ClipboardPlus} title="No enquiries captured yet" description="Capture a light enquiry when someone first contacts the service, then start their draft intake when ready." action={canManageParticipantLifecycle ? { label: 'New enquiry', onClick: openNew } : undefined} />}
      {showTable && !isLoading && filtered.length === 0
        ? <EmptyState icon={Search} title="No enquiries match your search" description="Try a different search term or filter, or clear the search to see all enquiries." action={{ label: 'Clear search and filter', onClick: () => { setSearch(''); setStatusFilter('all') } }} />
        : showTable && <DataTable data={filtered} columns={columns} keyField="id" loading={isLoading} sortable emptyMessage="No enquiries captured yet." />}
    </>
  )

  return {
    canManageParticipantLifecycle,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    statusOptions,
    showEmptyState,
    showTable,
    openNew,
    body,
  }
}