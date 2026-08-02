import { useStaff, useDeleteStaff, useUpdateStaff } from '@/api/hooks'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'

export default function StaffPage() {
  const { canWrite } = usePermissions()
  const deleteStaff = useDeleteStaff()
  const updateStaff = useUpdateStaff()

  const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<any>({
    deleteMutation: deleteStaff,
    restoreMutation: updateStaff,
    entityName: (s) => s.fullName,
    entityId: (s) => s.id,
    editPath: (s) => `/staff/${s.id}/edit`,
  })

  const { data: staff = [], isLoading } = useStaff(params)

  const staffColumns: Column<any>[] = [
    { key: 'fullName', header: 'Name', sortable: true, className: 'font-medium' },
    { key: 'role', header: 'Role', sortable: true },
    { key: 'region', header: 'Region', sortable: true },
    { key: 'isDriverEligible', header: 'Driver', type: 'boolean', align: 'center' },
    { key: 'isFirstAidQualified', header: 'First Aid', type: 'boolean', align: 'center' },
    { key: 'isMedicationCompetent', header: 'Meds', type: 'boolean', align: 'center' },
    { key: 'isManualHandlingCompetent', header: 'Manual', type: 'boolean', align: 'center' },
    { key: 'isOvernightEligible', header: 'Overnight', type: 'boolean', align: 'center' },
    { key: 'status', header: 'Status', sortable: true, render: (s) => <StatusBadge status={s.isActive ? 'Active' : 'Inactive'} /> },
    { key: 'actions', header: '', render: (s) => actionButtons(s) },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Staff"
        subtitle={`${staff.length} staff member${staff.length !== 1 ? 's' : ''}`}
        action={!showArchived && canWrite && (
          <Link to="/staff/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-blue-500/20">
            <Plus className="w-4 h-4" /> New Staff
          </Link>
        )}
      >
        {toggleButtons}
      </PageHeader>

      <DataTable
        data={staff}
        columns={staffColumns}
        keyField="id"
        sortable
        loading={isLoading}
        emptyMessage="No staff found"
      />
      {confirmDialog}
    </div>
  )
}
