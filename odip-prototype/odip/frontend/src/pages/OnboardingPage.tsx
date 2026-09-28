import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { apiGet } from '@/api/client'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
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

export default function OnboardingPage() {
  const navigate = useNavigate()
  const { canManageParticipantLifecycle, canAccessPage } = usePermissions()
  // The API scopes this query to the current tenant; this page does not add a client-side tenant filter.
  const worklist = useQuery({ queryKey: ['participant-onboarding-worklist'], queryFn: () => apiGet<WorklistRow[]>('/inquiries/onboarding-worklist') })
  const rows = worklist.data ?? []
  const columns: Column<WorklistRow>[] = [
    { key: 'fullName', header: 'Participant', sortable: true },
    { key: 'stage', header: 'Current stage', sortable: true },
    { key: 'completedSteps', header: 'Progress', render: row => `${row.completedSteps} of ${row.totalSteps} gates` },
    { key: 'nextAction', header: 'Recommended next action', render: row => <span className="font-medium">{row.nextAction}</span> },
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
      subtitle={`${rows.length} participant${rows.length !== 1 ? 's' : ''} in progress. Onboarding doesn't activate a participant or allow bookings, rostering, invoicing or claims.`}
    />
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
