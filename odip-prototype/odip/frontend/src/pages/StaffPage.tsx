import { useStaff, useDeleteStaff, useUpdateStaff } from '@/api/hooks'
import { DataTable, RowActions, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { SearchInput } from '@/components/SearchInput'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/Button'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link } from 'react-router-dom'
import { Plus, UserCog, Check, CalendarOff } from 'lucide-react'
import { useState } from 'react'
import { usePermissions } from '@/lib/permissions'
import { deadlineState } from '@/lib/deadline'
import type { StaffListDto, UpdateStaffDto } from '@/api/types/staff'

// A worker screening is expired once its expiry day has passed (expiring today is not yet expired): lib/deadline.ts, a calendar-day compare.
const isExpired = (date: string) => deadlineState(date, { warnDays: 0 }).status === 'overdue'

const ACTIVE_STATUS_ITEMS = [
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
]

const ACTIVE_STATUS_COLORS: Record<string, string> = {
  Active: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  Inactive: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
}

export default function StaffPage() {
  const { canWrite, canAccessPage } = usePermissions()
  const canAccessLeaveApprovals = canAccessPage('leave-approvals')
  const deleteStaff = useDeleteStaff()
  const updateStaff = useUpdateStaff()
  const [search, setSearch] = useState('')
  // PP-46 — Active -> Inactive is staged behind a confirm, same pattern as BookingsPage's
  // CONFIRM_STATUSES; Active (re-activation) stays immediate.
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ id: string; name: string; data: UpdateStaffDto } | null>(null)

  const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<any>({
    deleteMutation: deleteStaff,
    restoreMutation: updateStaff,
    entityName: (s) => s.fullName,
    entityId: (s) => s.id,
    editPath: (s) => `/staff/${s.id}/edit`,
  })

  const { data: staffData = [], isLoading } = useStaff(params)
  // PP-45 — StaffController's GetAll only supports `isActive`, no server-side text search, so the
  // filter is applied client-side (same approach CompatibilityPage takes for its matrix filters).
  const staff = search
    ? staffData.filter((s: StaffListDto) => {
        const q = search.toLowerCase()
        return s.fullName?.toLowerCase().includes(q) || s.position?.toLowerCase().includes(q) || s.region?.toLowerCase().includes(q)
      })
    : staffData

  function handleStatusChange(s: StaffListDto, val: string) {
    const data: UpdateStaffDto = {
      ...s,
      email: s.email ?? '',
      mobile: s.mobile ?? undefined,
      region: s.region ?? undefined,
      notes: s.notes ?? undefined,
      firstAidExpiryDate: s.firstAidExpiryDate ?? undefined,
      driverLicenceExpiryDate: s.driverLicenceExpiryDate ?? undefined,
      manualHandlingExpiryDate: s.manualHandlingExpiryDate ?? undefined,
      medicationCompetencyExpiryDate: s.medicationCompetencyExpiryDate ?? undefined,
      workerScreeningNumber: s.workerScreeningNumber ?? undefined,
      workerScreeningExpiryDate: s.workerScreeningExpiryDate ?? undefined,
      isActive: val === 'Active',
    }
    if (val === 'Inactive') {
      setConfirmDeactivate({ id: s.id, name: s.fullName, data })
    } else {
      updateStaff.mutate({ id: s.id, data })
    }
  }

  const staffColumns: Column<any>[] = [
    {
      key: 'fullName',
      header: 'Name',
      sortable: true,
      className: 'font-medium',
      render: (s: StaffListDto) => (
        // Truncation on the link itself (not a wrapper): a wrapper's overflow: hidden would clip the link's focus ring.
        <Link to={`/staff/${s.id}`} title={s.fullName} className="block truncate hover:text-[var(--color-primary)] hover:underline md:max-w-[11rem]">
          {s.fullName}
        </Link>
      ),
    },
    // Column budget (density §4): eleven columns need ~1140px, the box at 1280 is ~1006. The text columns are capped (ellipsis, full
    // text in the tooltip) and the two least-asked qualification flags give way below 2xl (1536), so Status and the row actions
    // stay on screen at 1280-1535 whatever the names and regions are.
    { key: 'position', header: 'Position', sortable: true, maxWidth: '7rem' },
    { key: 'region', header: 'Region', sortable: true, maxWidth: '7rem' },
    { key: 'isDriverEligible', header: 'Driver', type: 'boolean', align: 'center' },
    { key: 'isFirstAidQualified', header: 'First Aid', type: 'boolean', align: 'center' },
    { key: 'isMedicationCompetent', header: 'Meds', type: 'boolean', align: 'center' },
    { key: 'isManualHandlingCompetent', header: 'Manual', type: 'boolean', align: 'center', priority: 'low' },
    { key: 'isOvernightEligible', header: 'Overnight', type: 'boolean', align: 'center', priority: 'low' },
    {
      key: 'workerScreening',
      header: 'Worker Screening',
      align: 'center',
      render: (s) => {
        if (!s.workerScreeningExpiryDate) return null
        return isExpired(s.workerScreeningExpiryDate)
          ? <StatusBadge status="expired" label="Expired" />
          : <Check className="w-4 h-4 text-[var(--color-primary)] mx-auto" aria-label="Worker screening current" />
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
            onChange={val => handleStatusChange(s, val)}
            colorClass={`${ACTIVE_STATUS_COLORS[current]} h-[var(--control-h-sm)]`}
            items={ACTIVE_STATUS_ITEMS}
            disabled={!canWrite}
          />
        )
      },
    },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        // Row actions (24px) appear on row hover / focus and are always shown on touch.
        <RowActions>
          {canAccessLeaveApprovals && (
            <Button
              to={`/rostering/leave?userId=${s.id}`}
              onClick={e => e.stopPropagation()}
              variant="ghost"
              size="sm"
              iconOnly
              title="Leave & availability"
              aria-label="Leave & availability"
            >
              <CalendarOff className="w-4 h-4" />
            </Button>
          )}
          {actionButtons(s)}
        </RowActions>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* Plain wrapper keeps PageHeader's title and filter rows in block flow (32 + 8 + 32 = 72px)
          instead of the flex column's section gap opening between them. */}
      <div>
        <PageHeader
          title="Staff"
          subtitle={`${staff.length} staff member${staff.length !== 1 ? 's' : ''}`}
          action={!showArchived && canWrite && (
            <Button to="/staff/new" size="md">
              <Plus className="w-4 h-4" /> New Staff
            </Button>
          )}
        >
          {toggleButtons}
          <SearchInput value={search} onChange={setSearch} placeholder="Search staff..." />
        </PageHeader>
      </div>

      {!isLoading && staff.length === 0 ? (
        search ? (
          <EmptyState
            icon={UserCog}
            title="No staff match your search"
            description="Try a different search term, or clear your search to see all staff."
            action={{ label: 'Clear search', onClick: () => setSearch('') }}
          />
        ) : (
          <EmptyState
            icon={UserCog}
            title="No staff members yet"
            description="Staff are the support workers and coordinators you assign to trips, tasks, and incidents. Add one to start rostering them."
            action={!showArchived && canWrite ? { label: 'Add staff member', to: '/staff/new' } : undefined}
          />
        )
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
      <ConfirmDialog
        open={confirmDeactivate !== null}
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() => {
          if (!confirmDeactivate) return
          updateStaff.mutate(
            { id: confirmDeactivate.id, data: confirmDeactivate.data },
            { onSuccess: () => setConfirmDeactivate(null) }
          )
        }}
        variant="danger"
        loading={updateStaff.isPending}
        title="Mark staff member as inactive?"
        confirmLabel="Mark inactive"
        message={<p>Mark <strong>{confirmDeactivate?.name || 'this staff member'}</strong> as inactive?</p>}
      />
    </div>
  )
}
