import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { useOnboardingWorklist } from '@/api/hooks'
import type { OnboardingWorklistRow as WorklistRow } from '@/api/types/inquiries'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { ProgressBar } from '@/components/ProgressBar'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { SearchInput } from '@/components/SearchInput'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { queryPhase, retryingAfterError } from '@/lib/queryPhase'
import { useIntakeCompleteNotice } from './intake/intakeComplete'

/**
 * Body export — rendered by the ParticipantsHubPage tabbed container so the hub owns
 * one PageHeader. The standalone /onboarding route is redirected to /participants?tab=onboarding.
 */
export function OnboardingTable() {
  const screen = useOnboardingScreen()
  // The search used to live in the standalone page's header only, which no route reaches any more (L2-02).
  return (
    <>
      {screen.toolbar && <div className="flex flex-wrap items-center gap-3 mb-4">{screen.toolbar}</div>}
      {screen.body}
    </>
  )
}

function useOnboardingScreen() {
  const navigate = useNavigate()
  // A one-off confirmation from the Intake wizard ("Intake complete — {name} is now in onboarding."), carried by navigation state.
  const completed = useIntakeCompleteNotice()
  const { canManageParticipantLifecycle, canAccessPage } = usePermissions()
  // The API scopes this query to the current tenant; this page does not add a client-side tenant filter.
  const worklist = useOnboardingWorklist()
  // A request that has not run (paused while the browser reports offline) is loading, not an empty worklist.
  const worklistLoading = queryPhase(worklist) === 'loading' || retryingAfterError(worklist)
  const [search, setSearch] = useState('')
  const allRows = useMemo(() => worklist.data ?? [], [worklist.data])
  // The onboarding worklist endpoint takes no query parameters, so search is client-side.
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return allRows
    return allRows.filter(row =>
      [row.fullName, row.firstMissing]
        .filter(Boolean)
        .some(field => String(field).toLowerCase().includes(term)))
  }, [allRows, search])
  // Column budget (md+; below md the mobile card layout lets everything wrap). DataTable cells never wrap and its box scrolls sideways, so the
  // participant name wraps rather than being cut, and every column keeps a floor so "Action" is never pushed off the right edge.
  const columns: Column<WorklistRow>[] = [
    {
      key: 'fullName', header: 'Participant', sortable: true, wrap: true, minWidth: '9rem',
      render: row => (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* A real link to the same place as the row and its Open button, so it can open in a new tab. */}
          <Link to={`/onboarding/${row.participantId}`} className="font-medium text-[var(--color-foreground)] group-hover/row:text-[var(--color-primary)] transition-colors hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-sm">{row.fullName}</Link>
          {row.servicesStartedAt && <StatusBadge tone="success" label="Services started" />}
        </span>
      ),
    },
    {
      key: 'completedSteps',
      header: 'Progress',
      minWidth: '10rem',
      render: row => <ProgressBar value={row.completedSteps} total={row.totalSteps} label={`${row.completedSteps} of ${row.totalSteps} done`} />,
    },
    {
      key: 'firstMissing',
      header: 'Still to do',
      wrap: true,
      minWidth: '10rem',
      render: row => row.firstMissing ?? <span className="text-[var(--color-muted-foreground)]">All done</span>,
    },
    {
      key: 'participantId',
      header: 'Action',
      type: 'custom',
      minWidth: '6rem',
      render: row => canManageParticipantLifecycle
        ? <Button size="sm" className="w-full sm:w-auto" aria-label={`Open onboarding for ${row.fullName}`} onClick={() => navigate(`/onboarding/${row.participantId}`)}>Open</Button>
        : <Button size="sm" variant="secondary" className="w-full sm:w-auto" onClick={() => navigate(`/onboarding/${row.participantId}`)}>View checklist</Button>,
    },
  ]

  const body = (
    <>
      {completed && (
        <Callout tone="success" className="mb-3">Intake complete — {completed.name} is now in onboarding.</Callout>
      )}
      {worklist.isError && (
        <Callout
          tone="error"
          actions={<button type="button" className="font-medium underline shrink-0" onClick={() => worklist.refetch()}>Retry</button>}
        >
          {extractErrorMessage(worklist.error, 'Could not load the onboarding worklist. Please try again.')}
        </Callout>
      )}
      {!worklist.isError && (!worklistLoading && rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No participants in onboarding"
          description="Participants appear here once their intake is completed. Capture and complete an enquiry's intake to start their onboarding checklist."
          action={canAccessPage('participants') ? { label: 'View enquiries', to: '/participants?tab=enquiries' } : undefined}
        />
      ) : (
        <DataTable data={rows} columns={columns} keyField="participantId" loading={worklistLoading} sortable emptyMessage="No incomplete onboarding work." onRowClick={row => navigate(`/onboarding/${row.participantId}`)} rowClassName={row => (completed && row.participantId === completed.participantId ? 'bg-[var(--color-primary)]/10 outline outline-2 -outline-offset-2 outline-[var(--color-primary)]/40' : '')} />
      ))}
    </>
  )

  const toolbar = allRows.length > 0
    ? <SearchInput value={search} onChange={setSearch} placeholder="Search participants or what is still to do..." />
    : null

  return { toolbar, body }
}
