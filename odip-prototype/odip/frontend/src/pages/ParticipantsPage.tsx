import { useParticipants, useDeleteParticipant, useUpdateParticipant } from '@/api/hooks'
import { maskNdisNumber } from '@/lib/utils'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { StatusBadge } from '@/components/StatusBadge'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { usePermissions } from '@/lib/permissions'

export default function ParticipantsPage() {
  const { canWrite } = usePermissions()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const deleteParticipant = useDeleteParticipant()
  const updateParticipant = useUpdateParticipant()

  const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<any>({
    deleteMutation: deleteParticipant,
    restoreMutation: updateParticipant,
    entityName: (p) => p.fullName,
    entityId: (p) => p.id,
    editPath: (p) => `/participants/${p.id}/edit`,
  })

  const queryParams = { ...params }
  if (search) queryParams.search = search

  const { data: participants = [], isLoading } = useParticipants(queryParams)

  const participantColumns: Column<any>[] = [
    { key: 'fullName', header: 'Name', sortable: true, className: 'font-medium' },
    { key: 'ndisNumber', header: 'NDIS Number', render: (p) => <span className="font-mono text-xs text-[var(--color-muted-foreground)]">{maskNdisNumber(p.maskedNdisNumber || p.ndisNumber)}</span> },
    { key: 'planType', header: 'Plan Type' },
    { key: 'region', header: 'Region', sortable: true },
    { key: 'wheelchairRequired', header: '\u{1F9BD}', type: 'boolean', align: 'center' },
    { key: 'isHighSupport', header: 'High', type: 'boolean', align: 'center' },
    { key: 'supportRatio', header: 'Support Ratio' },
    { key: 'isRepeatClient', header: 'Repeat', type: 'boolean', align: 'center' },
    { key: 'status', header: 'Status', sortable: true, render: (p) => <StatusBadge status={p.isActive ? 'Active' : 'Inactive'} /> },
    { key: 'actions', header: '', render: (p) => canWrite ? actionButtons(p) : null },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Participants"
        subtitle={`${participants.length} participant${participants.length !== 1 ? 's' : ''}`}
        action={!showArchived && canWrite && (
          <Link to="/participants/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 shadow-md shadow-blue-500/20 transition-all">
            <Plus className="w-4 h-4" /> New Participant
          </Link>
        )}
      >
        {toggleButtons}
        <SearchInput value={search} onChange={setSearch} placeholder="Search participants..." />
      </PageHeader>

      <DataTable
        data={participants}
        columns={participantColumns}
        keyField="id"
        sortable
        onRowClick={(p: any) => navigate(`/participants/${p.id}`)}
        loading={isLoading}
        emptyMessage="No participants found"
      />
      {confirmDialog}
    </div>
  )
}
