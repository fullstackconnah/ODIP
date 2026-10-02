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
import { useConvertParticipantInquiry, useParticipantInquiries } from '@/api/hooks'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { queryPhase } from '@/lib/queryPhase'

/**
 * Where an enquiry has got to. `new`: no participant yet. `draftintake`: a draft participant whose intake is still open. `intakecomplete`:
 * intake done, so the participant is on the Onboarding tab. `participant`: finalised, so they are on the Active participants tab. Only the
 * first two are open enquiries, and only those are listed here. An API that does not send the participant's state (an older server) leaves the
 * first two to tell apart as before: any converted enquiry is a draft intake.
 */
type Stage = 'new' | 'draftintake' | 'intakecomplete' | 'participant'

function stageOf(row: ParticipantInquiryDto): Stage {
  if (!row.participantId) return 'new'
  if (row.participantIsDraft === false) return 'participant'
  return row.participantIntakeCompletedAt ? 'intakecomplete' : 'draftintake'
}

const isOpen = (stage: Stage) => stage === 'new' || stage === 'draftintake'

/** A direct intake has no enquiry behind it, so no source: the cell says how it started instead of showing nothing. */
const sourceLabel = (row: ParticipantInquiryDto) => (row.isDirectIntake ? 'Direct intake' : row.source)

export default function InquiriesPage() {
  const screen = useInquiriesScreen()
  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Enquiries"
        subtitle="Open enquiries and intakes in progress. Starting intake creates an inactive draft participant you can come back to."
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
 * InquiryFormPage. Edit and Start-intake remain row-level actions here. The search renders above the table: the hub used to show the body
 * alone, which left it with nowhere to live (L2-02). There is no status filter: the tab IS the stage filter.
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
  // empty list: "No open enquiries" follows only a request that succeeded.
  const isLoading = queryPhase(inquiriesQuery) === 'loading'
  const convert = useConvertParticipantInquiry()
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
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
  // The /inquiries endpoint takes no query parameters, so the stage and the search are client-side over the already-fetched tenant-scoped list
  // (the server owns the tenant predicate, and which drafts are direct intakes). An enquiry whose intake is complete is not listed: its participant
  // is on the Onboarding tab, and once finalised on Active participants.
  const open = inquiries.filter(row => isOpen(stageOf(row)))
  const filtered = open.filter(row => {
    if (!search.trim()) return true
    const term = search.trim().toLowerCase()
    return [row.firstName, row.lastName, row.phone, row.email, sourceLabel(row), row.provenance]
      .filter(Boolean)
      .some(field => String(field).toLowerCase().includes(term))
  })

  // Only open enquiries are listed, so a row is New (no participant yet) or Draft intake (intake started, not complete).
  const statusBadge = (row: ParticipantInquiryDto) => stageOf(row) === 'new'
    ? <StatusBadge status="new" label="New" />
    : <StatusBadge status="draftintake" label="Draft intake" />
  // The one next step that is real for each stage. Resuming an intake that is complete led to the L2-03 data loss, which is why such a row is not listed.
  const primaryAction = (row: ParticipantInquiryDto) => stageOf(row) === 'new'
    ? <Button size="sm" disabled={convert.isPending} onClick={() => startIntake(row.id)}>Start intake</Button>
    : <Button size="sm" onClick={() => navigate(`/participants/${row.participantId}/intake`)}>Resume intake</Button>

  const columns: Column<ParticipantInquiryDto>[] = [
    { key: 'firstName', header: 'Name', sortable: true, render: row => `${row.firstName} ${row.lastName}` },
    { key: 'phone', header: 'Contact', render: row => row.phone || row.email || 'No contact details' },
    { key: 'source', header: 'Source', sortable: true, render: sourceLabel },
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
          {/* A direct intake has no enquiry record, so there is nothing to edit as one. */}
          {!row.isDirectIntake && <Button size="sm" variant="secondary" onClick={() => editExisting(row)}>Edit enquiry</Button>}
        </div>
      ) : <span className="text-sm text-[var(--color-muted-foreground)]">Read-only</span>,
    },
  ]
  const showEmptyState = !isError && !isLoading && open.length === 0
  const showTable = !isError && !showEmptyState && (open.length > 0 || isLoading)

  const toolbar = <SearchInput value={search} onChange={setSearch} placeholder="Search enquiries..." />

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
      {showEmptyState && <EmptyState icon={ClipboardPlus} title="No open enquiries" description="Capture an enquiry when someone first contacts the service, then start their intake. Once an intake is complete, the participant moves to the Onboarding tab." action={canManageParticipantLifecycle ? { label: 'New enquiry', onClick: openNew } : undefined} />}
      {showTable && !isLoading && filtered.length === 0
        ? <EmptyState icon={Search} title="No enquiries match your search" description="Try a different search term, or clear the search to see every open enquiry." action={{ label: 'Clear search', onClick: () => setSearch('') }} />
        : showTable && <DataTable data={filtered} columns={columns} keyField="id" loading={isLoading} sortable emptyMessage="No open enquiries." />}
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
