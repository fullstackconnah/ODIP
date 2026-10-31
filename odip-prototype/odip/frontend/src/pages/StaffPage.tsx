import { useStaff, useDeleteStaff, useUpdateStaff, useProviderSettings } from '@/api/hooks'
import { DataTable, RowMenu, type Column, type RowMenuItem } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState, type EmptyStateAction } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { statusClass } from '@/lib/tone'
import { SearchInput } from '@/components/SearchInput'
import { Tabs } from '@/components/Tabs'
import { CHIP_CLASS } from '@/components/ServiceStreamBadges'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { extractErrorMessage } from '@/lib/utils'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link } from 'react-router-dom'
import { Plus, UserCog, CalendarOff, Pencil, Archive, ArchiveRestore } from 'lucide-react'
import { useState } from 'react'
import { useTabParam } from '@/hooks/useTabParam'
import { usePermissions } from '@/lib/permissions'
import { deadlineState } from '@/lib/deadline'
import { toUpdateStaffDto, type StaffListDto, type UpdateStaffDto } from '@/api/types/staff'
import { POSITION_LABELS } from '@/api/types/enums'
import { plural } from '@/lib/format'
import { retryingAfterError } from '@/lib/queryPhase'

const positionLabel = (s: StaffListDto) => POSITION_LABELS[s.position] ?? s.position ?? ''

// A worker screening is expired once its expiry day has passed (expiring today is not yet expired): lib/deadline.ts, a calendar-day compare.
const isExpired = (date: string) => deadlineState(date, { warnDays: 0 }).status === 'overdue'

const ACTIVE_STATUS_ITEMS = [
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
]

// What a staff member holds, as chips, and nothing for what they do not: the eight caps-labelled flag columns this replaces made a phone
// card ten labels long and a desktop row a run of ticks and blanks. An expired worker screening is the one flag shown as a problem.
const QUALIFICATIONS: Array<[keyof StaffListDto, string]> = [
  ['isDriverEligible', 'Driver'],
  ['isFirstAidQualified', 'First aid'],
  ['isMedicationCompetent', 'Medication'],
  ['isManualHandlingCompetent', 'Manual handling'],
  ['isOvernightEligible', 'Overnight'],
]

// No screening date on an active person: the same case the roster warns on (WSC_MISSING) and Today counts as a credential issue.
const isScreeningMissing = (s: StaffListDto) => s.isActive && !s.workerScreeningExpiryDate

function Qualifications({ staff }: { staff: StaffListDto }) {
  const held = QUALIFICATIONS.filter(([flag]) => staff[flag]).map(([, label]) => label)
  const screening = staff.workerScreeningExpiryDate
  const missing = isScreeningMissing(staff)
  if (held.length === 0 && !screening && !missing) return null
  return (
    <ul aria-label="Qualifications" className="inline-flex flex-wrap items-center gap-1">
      {held.map(label => <li key={label} className={CHIP_CLASS}>{label}</li>)}
      {missing && <li><StatusBadge tone="warning" label="Screening missing" /></li>}
      {screening && (isExpired(screening)
        ? <li><StatusBadge status="expired" label="Screening expired" /></li>
        : <li className={CHIP_CLASS}>Worker screening</li>)}
    </ul>
  )
}

export default function StaffPage() {
  const { canWrite, canAccessPage, canImportData, canManageIntegrations } = usePermissions()
  // Staff come from Employment Hero for a connected organisation: ODIP's own create and import are hidden, and the server refuses them.
  const staffFromPayroll = useProviderSettings(canWrite).data?.employmentHeroConnected === true
  const canAccessLeaveApprovals = canAccessPage('leave-approvals')
  const deleteStaff = useDeleteStaff()
  const updateStaff = useUpdateStaff()
  const [search, setSearch] = useState('')
  // PP-46 — Active -> Inactive is staged behind a confirm, same pattern as BookingsPage's
  // CONFIRM_STATUSES; Active (re-activation) stays immediate.
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ id: string; name: string; data: UpdateStaffDto } | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const { showArchived, params, toggleButtons, confirmDialog, errorNotice, requestArchive, requestRestore } = useArchiveRestore<any>({
    deleteMutation: deleteStaff,
    restoreMutation: updateStaff,
    restoreData: (s: StaffListDto) => toUpdateStaffDto(s, { isActive: true }),
    entityName: (s) => s.fullName,
    entityId: (s) => s.id,
    editPath: (s) => `/staff/${s.id}/edit`,
  })

  const pageQuery = useStaff(params)
  const { data: staffData = [], isLoading, isError, refetch } = pageQuery
  // PP-45 — StaffController's GetAll only supports `isActive`, no server-side text search, so the
  // filter is applied client-side (same approach CompatibilityPage takes for its matrix filters).
  const [screeningTab, setScreeningTab] = useTabParam(['all', 'missing'] as const, 'all')
  const searched = search
    ? staffData.filter((s: StaffListDto) => {
        const q = search.toLowerCase()
        return s.fullName?.toLowerCase().includes(q) || positionLabel(s).toLowerCase().includes(q) || s.region?.toLowerCase().includes(q)
      })
    : staffData
  const missingCount = searched.filter(isScreeningMissing).length
  // The tabs are hidden on the archived list, so a shared ?tab=missing link must not filter it.
  const missingOnly = screeningTab === 'missing' && !showArchived
  const staff = missingOnly ? searched.filter(isScreeningMissing) : searched

  // The confirm (if any) closes either way; a refusal is said above the table.
  function saveStatus(id: string, name: string, data: UpdateStaffDto) {
    updateStaff.mutate({ id, data }, {
      onSuccess: () => setStatusError(null),
      onError: err => setStatusError(extractErrorMessage(err, `Could not update "${name}". Please try again.`)),
      onSettled: () => setConfirmDeactivate(null),
    })
  }

  function handleStatusChange(s: StaffListDto, val: string) {
    const data = toUpdateStaffDto(s, { isActive: val === 'Active' })
    if (val === 'Inactive') {
      setConfirmDeactivate({ id: s.id, name: s.fullName, data })
    } else {
      saveStatus(s.id, s.fullName, data)
    }
  }

  // The row's actions, once: icon buttons on a mouse (revealed on hover), one ⋯ menu on the phone card. Archive is undoable (a confirm, then Inactive), so it is never red.
  const rowItems = (s: StaffListDto): RowMenuItem[] => [
    ...(canAccessLeaveApprovals ? [{ label: 'Leave & availability', icon: <CalendarOff className="w-4 h-4" />, to: `/rostering/leave?userId=${s.id}` }] : []),
    ...(canWrite ? [
      { label: 'Edit', icon: <Pencil className="w-4 h-4" />, to: `/staff/${s.id}/edit` },
      showArchived
        ? { label: 'Restore', icon: <ArchiveRestore className="w-4 h-4" />, onSelect: () => requestRestore(s) }
        : { label: 'Archive', icon: <Archive className="w-4 h-4" />, onSelect: () => requestArchive(s) },
    ] : []),
  ]

  // Order: who, status, what they hold, then Position and Region; the whole table fits a 1280 window. Position leaves while nobody has one. On the
  // phone card the name and status make the title line, the meta line is Position, Region, Qualifications, and the row menu ends the card.
  const staffColumns: Column<any>[] = [
    {
      key: 'fullName',
      header: 'Name',
      sortable: true,
      mobile: 'primary',
      className: 'font-medium',
      render: (s: StaffListDto) => (
        // Truncation on the link itself (not a wrapper): a wrapper's overflow: hidden would clip the link's focus ring.
        <Link to={`/staff/${s.id}`} title={s.fullName} className="block truncate hover:text-[var(--color-primary)] hover:underline md:max-w-[11rem]">
          {s.fullName}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      mobile: 'status',
      render: (s) => {
        const current = s.isActive ? 'Active' : 'Inactive'
        // A role that cannot write reads the status: no pill it cannot change.
        return canWrite ? (
          <Dropdown
            variant="pill"
            value={current}
            onChange={val => handleStatusChange(s, val)}
            colorClass={`${statusClass(current)} h-[var(--control-h-sm)]`}
            items={ACTIVE_STATUS_ITEMS}
          />
        ) : <StatusBadge status={current} />
      },
    },
    // Every flag is on the row (Manual and Overnight were once deleted below 1536, L3-04), as chips; on the card it follows Position and Region.
    { key: 'qualifications', header: 'Qualifications', mobile: 'meta', className: 'max-md:basis-full max-md:order-0!', render: (s: StaffListDto) => <Qualifications staff={s} /> },
    { key: 'position', header: 'Position', sortable: true, mobile: 'meta', hideWhenEmpty: true, render: positionLabel },
    { key: 'region', header: 'Region', sortable: true, maxWidth: '7rem', mobile: 'meta' },
    { key: 'actions', header: '', overlay: true, mobile: 'trail', render: (s) => <RowMenu name={s.fullName} items={rowItems(s)} /> },
  ]

  // The header buttons' gates, so the empty state never offers what the header would not (and never repeats "New staff member", which the header owns). Archived has nothing to import into.
  const emptyStaffActions: EmptyStateAction[] = showArchived ? [] : staffFromPayroll
    ? canManageIntegrations ? [{ label: 'Open integrations', to: '/settings?section=integrations' }] : []
    : canImportData ? [{ label: 'Import staff', to: '/settings/import/staff' }] : []
  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* Plain wrapper keeps PageHeader's title and filter rows in block flow (32 + 8 + 32 = 72px)
          instead of the flex column's section gap opening between them. */}
      <div>
        <PageHeader
          title="Staff"
          subtitle={plural(staff.length, 'staff member')}
          action={!showArchived && !staffFromPayroll && (canWrite || canImportData) && (
            // One cluster, as on the Participants hub: PageHeader dissolves its wrapper from md, and loose buttons would be spread apart.
            <div className="flex shrink-0 items-center gap-2">
              {canImportData && <Button to="/settings/import/staff" variant="secondary" size="md">Import</Button>}
              {canWrite && (
                <Button to="/staff/new" size="md">
                  <Plus className="w-4 h-4" /> New staff member
                </Button>
              )}
            </div>
          )}
        >
          {toggleButtons}
          <SearchInput value={search} onChange={setSearch} placeholder="Search staff..." />
        </PageHeader>
      </div>

      {errorNotice}
      {statusError && <Callout tone="error">{statusError}</Callout>}

      {!isLoading && !isError && !showArchived && staffData.length > 0 && (
        <Tabs
          tabs={[{ id: 'all', label: 'All' }, { id: 'missing', label: 'Screening missing', badge: missingCount }]}
          active={screeningTab}
          onChange={setScreeningTab}
          ariaLabel="Staff filters"
        />
      )}

      {!isLoading && !isError && staff.length === 0 && !(missingOnly && searched.length > 0) ? (
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
            description={!showArchived ? (staffFromPayroll
              ? 'Your staff come from Employment Hero. Bunya Support checks for them every 30 minutes, so they appear here soon after you connect.'
              : 'Staff are the support workers and coordinators you roster. Import your staff list from a spreadsheet, or add people one at a time.')
              : 'Staff are the support workers and coordinators you assign to trips, tasks, and incidents. Add one to start rostering them.'}
            action={emptyStaffActions[0]}
          />
        )
      ) : (
        <DataTable
          data={staff}
          columns={staffColumns}
          keyField="id"
          sortable
          loading={isLoading}
          error={isError || retryingAfterError(pageQuery)}
          onRetry={() => refetch()}
          emptyMessage={missingOnly ? 'Everyone here has a screening date' : 'No staff found'}
        />
      )}
      {confirmDialog}
      <ConfirmDialog
        open={confirmDeactivate !== null}
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() => {
          if (confirmDeactivate) saveStatus(confirmDeactivate.id, confirmDeactivate.name, confirmDeactivate.data)
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
