import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { apiGet } from '@/api/client'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { ProgressBar } from '@/components/ProgressBar'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { usePermissions } from '@/lib/permissions'
import { readIntakeCompleteNotice } from './intake/intakeComplete'
import { plural } from '@/lib/format'

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
  const screen = useOnboardingScreen()
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader
        title="Onboarding"
        subtitle={`${plural(screen.allRowsCount, 'participant')} in progress. Onboarding doesn't activate a participant or allow bookings, rostering, invoicing or claims.`}
      >
        {screen.allRowsCount > 0 && <SearchInput value={screen.search} onChange={screen.setSearch} placeholder="Search participants, stages or gates..." />}
      </PageHeader>
      {screen.body}
    </div>
  )
}

/**
 * Body export — rendered by the ParticipantsHubPage tabbed container so the hub owns
 * one PageHeader. The standalone /onboarding route is now redirected to
 * /participants?tab=onboarding, so this default page component is only retained for the
 * dedicated OnboardingPage test that mounts it under its own MemoryRouter.
 */
export function OnboardingTable() {
  const screen = useOnboardingScreen()
  return <>{screen.body}</>
}

function useOnboardingScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  // A one-off confirmation from the Intake wizard ("Intake complete — {name} is now in onboarding."), carried by
  // navigation state. Held in state so it survives the history-state clear below, and cleared from history so a
  // reload or coming back to this URL later does not replay it.
  const [completed] = useState(() => readIntakeCompleteNotice(location.state))
  useEffect(() => {
    if (completed) navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    // Only the arrival matters: run once for the notice this screen mounted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
  // Column budget (md+; below md the mobile card layout lets everything wrap). DataTable cells never wrap and its box
  // scrolls sideways, and two of these columns hold free text of any length: the stage chip (the first blocking
  // reason, a full sentence) and the reasons list under the next action. Left alone they set the column widths, so a
  // worklist with one long reason was about 2000px wide at 1280 and pushed "Action" off the right edge, and the
  // Complete Intake hand-off lands here. So the two free-text columns wrap inside a cap and may shrink, the
  // participant name wraps rather than being cut, and Progress and Action (fixed-size content) keep a floor.
  const columns: Column<WorklistRow>[] = [
    { key: 'fullName', header: 'Participant', sortable: true, wrap: true, minWidth: '9rem' },
    {
      key: 'stage',
      header: 'Current stage',
      sortable: true,
      minWidth: '11rem',
      render: row => {
        const badge = stageBadge(row)
        return (
          <StatusBadge
            status={badge.status}
            label={badge.label}
            className="md:inline-block md:my-1.5 md:max-w-[18rem] md:whitespace-normal md:rounded-xl md:leading-snug"
          />
        )
      },
    },
    {
      key: 'completedSteps',
      header: 'Progress',
      minWidth: '10rem',
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
      wrap: true,
      minWidth: '16rem',
      render: row => (
        <div className="md:max-w-[32rem] md:py-1.5">
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
          Could not load the onboarding worklist. Please try again.
        </Callout>
      )}
      {!worklist.isError && (!worklist.isLoading && rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No participants in onboarding"
          description="Participants appear here once their intake is completed. Capture and complete an enquiry's intake to start their onboarding checklist."
          action={canAccessPage('participants') ? { label: 'View enquiries', to: '/participants?tab=enquiries' } : undefined}
        />
      ) : (
        <DataTable data={rows} columns={columns} keyField="participantId" loading={worklist.isLoading} sortable emptyMessage="No incomplete onboarding work." rowClassName={row => (completed && row.participantId === completed.participantId ? 'bg-[var(--color-primary)]/10 outline outline-2 -outline-offset-2 outline-[var(--color-primary)]/40' : '')} />
      ))}
    </>
  )

  return {
    allRowsCount: allRows.length,
    search,
    setSearch,
    body,
  }
}
