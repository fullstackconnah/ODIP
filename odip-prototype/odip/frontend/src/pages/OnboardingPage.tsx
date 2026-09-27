import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/api/client'
import { DataTable, type Column } from '@/components/DataTable'

type WorklistRow = { participantId: string; fullName: string; stage: string; nextAction: string; completedSteps: number; totalSteps: number }

export default function OnboardingPage() {
  const navigate = useNavigate()
  const worklist = useQuery({ queryKey: ['participant-onboarding-worklist'], queryFn: () => apiGet<WorklistRow[]>('/inquiries/onboarding-worklist') })
  const columns: Column<WorklistRow>[] = [
    { key: 'fullName', header: 'Participant', sortable: true },
    { key: 'stage', header: 'Stage', sortable: true },
    { key: 'completedSteps', header: 'Progress', render: row => `${row.completedSteps} of ${row.totalSteps} steps` },
    { key: 'nextAction', header: 'Next action' },
    { key: 'participantId', header: 'Action', type: 'custom', render: row => <button type="button" className="rounded bg-[var(--color-primary)] px-3 py-1 text-white" onClick={() => navigate(`/onboarding/${row.participantId}`)}>{row.nextAction}</button> },
  ]
  return <div className="space-y-6"><div><h1 className="text-2xl font-semibold">Onboarding</h1><p className="text-sm text-[var(--color-muted-foreground)]">Tenant-scoped draft work only. Progress is calculated by the server and does not activate, book, roster, invoice, or claim.</p></div><DataTable data={worklist.data ?? []} columns={columns} keyField="participantId" loading={worklist.isLoading} sortable emptyMessage="No incomplete onboarding work." /></div>
}
