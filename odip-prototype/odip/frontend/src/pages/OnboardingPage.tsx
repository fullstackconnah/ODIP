import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { apiGet } from '@/api/client'
import { DataTable, type Column } from '@/components/DataTable'
import { ProgressBar } from '@/components/ProgressBar'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { usePermissions } from '@/lib/permissions'

type WorklistRow = {
  participantId: string
  fullName: string
  stage: string
  nextAction: string
  completedSteps: number
  totalSteps: number
  reasons?: string[]
}

/**
 * The worklist API returns a coarse `stage` ("Intake incomplete" / "Onboarding
 * incomplete"), which is too flat to triage on. The actionable signal is `reasons`
 * (what is blocking) plus whether any gate has been completed, so the badge tone is
 * derived from those instead of being echoed from the stage string.
 */
function stageBadge(row: WorklistRow): { status: string; label: string } {
  if (row.reasons?.length) return { status: 'needsattention', label: row.reasons[0] }
  if (row.completedSteps === 0) return { status: 'blocked', label: row.stage }
  return { status: 'stalled', label: row.stage }
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const { canManageParticipantLifecycle, canAccessPage } = usePermissions()
  // The API scopes this query to the current tenant; this page does not add a client-side tenant filter.
  const worklist = useQuery({ queryKey: ['participant-onboarding-worklist'], queryFn: () => apiGet<WorklistRow[]>('/inquiries/onboarding-worklist') })
  const [search, setSearch] = useState('')
  const allRows = useMemo(() => worklist.data ?? [], [worklist.data])
  // The onboarding worklist endpoint takes no query parameters, so search is client-side.
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return allRows
    return allRows.filter(row =>
      [row.fullName, row.stage, row.nextAction, ...(row.reasons ?? [])]
        .filter(Boolean)
        .some(field => String(field).toLowerCase().includes(term)))
  }, [allRows, search])
  const columns: Column<WorklistRow>[] = [
    { key: 'fullName', header: 'Participant', sortable: true },
    {
      key: 'stage',
      header: 'Current stage',
      sortable: true,
      render: row => {
        const badge = stageBadge(row)
        return <StatusBadge status={badge.status} label={badge.label} />
      },
    },
    {
      key: 'completedSteps',
      header: 'Progress',
      render: row => (
        <ProgressBar
          value={row.completedSteps}
          total={row.totalSteps}
          label={`${row.completedSteps} of ${row.totalSteps} gates`}
        />
      ),
    },
    {
      key: 'nextAction',
      header: 'Recommended next action',
      render: row => (
        <div>
          <span className="font-medium">{row.nextAction}</span>
          {row.reasons && row.reasons.length > 1 && (
            <ul className="mt-1 text-xs text-[var(--color-muted-foreground)] space-y-0.5">
              {row.reasons.slice(1).map(reason => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
    {
      key: 'participantId',
      header: 'Action',
      type: 'custom',
      render: row => canManageParticipantLifecycle
        ? <button type="button" aria-label={`Open onboarding for ${row.fullName}`} className="w-full rounded border px-3 py-2 sm:w-auto" onClick={() => navigate(`/onboarding/${row.participantId}`)}>Open</button>
        : <button type="button" className="w-full rounded border px-3 py-2 sm:w-auto" onClick={() => navigate(`/onboarding/${row.participantId}`)}>View checklist</button>,
    },
  ]

  return <div className="space-y-6">
    <PageHeader
      title="Onboarding"
      subtitle={`${allRows.length} participant${allRows.length !== 1 ? 's' : ''} in progress. Onboarding doesn't activate a participant or allow bookings, rostering, invoicing or claims.`}
    >
      {allRows.length > 0 && <SearchInput value={search} onChange={setSearch} placeholder="Search participants, stages or gates..." />}
    </PageHeader>
    {worklist.isError && (
      <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm flex flex-wrap items-center justify-between gap-3">
        <span>Could not load the onboarding worklist. Please try again.</span>
        <button type="button" className="font-medium underline shrink-0" onClick={() => worklist.refetch()}>Retry</button>
      </div>
    )}
    {!worklist.isError && (!worklist.isLoading && rows.length === 0 ? (
      <EmptyState
        icon={ClipboardCheck}
        title="No participants in onboarding"
        description="Participants appear here once their intake is completed. Capture and complete an enquiry's intake to start their onboarding checklist."
        action={canAccessPage('participants') ? { label: 'View enquiries', to: '/inquiries' } : undefined}
      />
    ) : (
      <DataTable data={rows} columns={columns} keyField="participantId" loading={worklist.isLoading} sortable emptyMessage="No incomplete onboarding work." />
    ))}
  </div>
}
