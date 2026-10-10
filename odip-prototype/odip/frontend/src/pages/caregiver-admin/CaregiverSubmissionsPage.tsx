import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { PageHeader } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { queryPhase } from '@/lib/queryPhase'
import { useCaregiverSubmissions } from '@/api/hooks/caregiver'
import type { CaregiverSubmissionListItemDto, CaregiverSubmissionStatus } from '@/api/types/caregiver'

/**
 * cg04 Task 10 (design §5) — the caregiver submissions list, a `DataTable` filtered to Submitted
 * by default, with a status-pill filter (matching the DOC/incident-page pill idiom) and a Review
 * action that navigates to the diff page (Task 11).
 */

const STATUS_ITEMS = (['Submitted', 'Draft', 'Accepted', 'Rejected', 'Revoked'] as CaregiverSubmissionStatus[]).map((s) => ({
  value: s,
  label: s,
}))

export default function CaregiverSubmissionsPage() {
  const [status, setStatus] = useState<CaregiverSubmissionStatus>('Submitted')
  const submissions = useCaregiverSubmissions(status)
  // A failed or paused request is not an empty list: "No submitted caregiver forms" is only for one that succeeded and came back empty.
  const phase = queryPhase(submissions)
  const navigate = useNavigate()

  const columns: Column<CaregiverSubmissionListItemDto>[] = [
    { key: 'participantName', header: 'Participant', sortable: true },
    { key: 'caregiverName', header: 'Caregiver', render: (r) => r.caregiverName ?? '—' },
    { key: 'status', header: 'Status', type: 'badge' },
    { key: 'submittedAt', header: 'Submitted', type: 'date', sortable: true },
    { key: 'expiresAt', header: 'Expires', type: 'date' },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <button type="button" className="underline text-sm" onClick={() => navigate(`/caregiver-submissions/${r.id}`)}>
          Review
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Caregiver forms"
        action={<Dropdown variant="pill" items={STATUS_ITEMS} value={status} onChange={(v) => setStatus(v as CaregiverSubmissionStatus)} label="Status" />}
      />
      {phase === 'loading' ? (
        <PageState kind="loading" noun="caregiver form list" />
      ) : phase === 'error' ? (
        <PageState kind="error" noun="caregiver form list" onRetry={() => submissions.refetch()} />
      ) : (
        <DataTable
          data={submissions.data ?? []}
          columns={columns}
          keyField="id"
          sortable
          emptyMessage={`No ${status.toLowerCase()} caregiver forms.`}
        />
      )}
    </div>
  )
}
