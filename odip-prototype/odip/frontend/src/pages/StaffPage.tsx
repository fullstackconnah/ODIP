import { useStaff, useDeleteStaff, useUpdateStaff } from '@/api/hooks'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link } from 'react-router-dom'
import { Plus, UserCog, Check } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'

function isExpired(date: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(date + 'T00:00:00').getTime() < today.getTime()
}

const ACTIVE_STATUS_ITEMS = [
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
]

const ACTIVE_STATUS_COLORS: Record<string, string> = {
  Active: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  Inactive: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
}

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
    {
      key: 'workerScreening',
      header: 'Worker Screening',
      align: 'center',
      render: (s) => {
        if (!s.workerScreeningExpiryDate) return null
        return isExpired(s.workerScreeningExpiryDate)
          ? <StatusBadge status="expired" label="Expired" />
          : <Check className="w-4 h-4 text-[var(--color-primary)] mx-auto" />
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (s) => {
        const current = s.isActive ? 'Active' : 'Inactive'
        return (
          <Dropdown
            variant="pill"
            value={current}
            onChange={val => updateStaff.mutate({ id: s.id, data: { ...s, isActive: val === 'Active' } })}
            colorClass={ACTIVE_STATUS_COLORS[current]}
            items={ACTIVE_STATUS_ITEMS}
            disabled={!canWrite}
          />
        )
      },
    },
    { key: 'actions', header: '', render: (s) => actionButtons(s) },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Staff"
        subtitle={`${staff.length} staff member${staff.length !== 1 ? 's' : ''}`}
        action={!showArchived && canWrite && (
          <Link to="/staff/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20">
            <Plus className="w-4 h-4" /> New Staff
          </Link>
        )}
      >
        {toggleButtons}
      </PageHeader>

      {!isLoading && staff.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="No staff members yet"
          description="Staff are the support workers and coordinators you assign to trips, tasks, and incidents. Add one to start rostering them."
          action={!showArchived && canWrite ? { label: 'Add staff member', to: '/staff/new' } : undefined}
        />
      ) : (
        <DataTable
          data={staff}
          columns={staffColumns}
          keyField="id"
          sortable
          loading={isLoading}
          emptyMessage="No staff found"
        />
      )}
      {confirmDialog}
    </div>
  )
}
