import { useEffect, useState } from 'react'
import { Plus, X, AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import {
  useUpdateStaffAssignment,
  useDeleteStaffAssignment,
  useCreateStaffAssignment,
  useCheckStaffAssignment,
  getRosterFindings,
  useStaff,
  useAvailableStaff,
} from '@/api/hooks'
import { DataTable } from '@/components/DataTable'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SearchableSelect } from '@/components/SearchableSelect'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { RosterGateFields } from '@/pages/rostering/components/RosterGateFields'
import { getRosterGate } from '@/pages/rostering/lib/rosterGate'
import { formatDateAu } from '@/lib/utils'
import { ASSIGNMENT_STATUSES, SLEEPOVER_TYPES, type SleepoverType, type AssignmentStatus } from '@/api/types/enums'
import type { TripDetailDto } from '@/api/types/trips'
import type { StaffAssignmentDto, StaffListDto, UpdateStaffAssignmentDto } from '@/api/types/staff'
import type { BookingListDto } from '@/api/types/bookings'
import type { RosterFindingDto } from '@/api/types'

const ASSIGNMENT_STATUS_ITEMS: DropdownItem[] = ASSIGNMENT_STATUSES.map(s => ({ value: s, label: s }))

const SLEEPOVER_TYPE_LABELS: Record<SleepoverType, string> = {
  None: 'None',
  ActiveNight: 'Active Night',
  PassiveNight: 'Passive Night',
  Sleepover: 'Sleepover',
}
const SLEEPOVER_TYPE_ITEMS: DropdownItem[] = SLEEPOVER_TYPES.map(v => ({ value: v, label: SLEEPOVER_TYPE_LABELS[v] }))

interface StaffEditForm {
  tripInstanceId: string
  staffId: string
  assignmentRole: string
  assignmentStart: string
  assignmentEnd: string
  isDriver: boolean
  sleepoverType: SleepoverType
  shiftNotes: string
  status: AssignmentStatus
}

interface StaffTabProps {
  tripId: string
  trip: TripDetailDto
  staff: StaffAssignmentDto[]
  bookings: BookingListDto[]
  canWrite: boolean
}

export default function StaffTab({ tripId, trip, staff, bookings, canWrite }: StaffTabProps) {
  const updateStaffAssignment = useUpdateStaffAssignment()
  const deleteStaffAssignment = useDeleteStaffAssignment()
  const createStaffAssignment = useCreateStaffAssignment()
  const checkStaffAssignment = useCheckStaffAssignment()
  const [editingStaff, setEditingStaff] = useState<StaffAssignmentDto | null>(null)
  const [editStaffForm, setEditStaffForm] = useState<StaffEditForm>({} as StaffEditForm)
  const [editFindings, setEditFindings] = useState<RosterFindingDto[]>([])
  const [editOverrideReason, setEditOverrideReason] = useState('')
  const [editReasonRequired, setEditReasonRequired] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deletingStaff, setDeletingStaff] = useState<StaffAssignmentDto | null>(null)

  // Add Staff state
  const [showAddStaff, setShowAddStaff] = useState(false)
  const { data: allStaff = [] } = useStaff()
  const { data: availableStaff = [] } = useAvailableStaff(trip?.startDate, trip?.endDate)
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [staffAssignmentRole, setStaffAssignmentRole] = useState('')
  const [staffAssignmentStart, setStaffAssignmentStart] = useState('')
  const [staffAssignmentEnd, setStaffAssignmentEnd] = useState('')
  const [staffIsDriver, setStaffIsDriver] = useState(false)
  const [staffSleepoverType, setStaffSleepoverType] = useState('None')
  const [staffShiftNotes, setStaffShiftNotes] = useState('')
  const [addFindings, setAddFindings] = useState<RosterFindingDto[]>([])
  const [addOverrideReason, setAddOverrideReason] = useState('')
  const [addReasonRequired, setAddReasonRequired] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const addGate = getRosterGate(addFindings)
  const editGate = getRosterGate(editFindings)

  // Compute availability set and already-assigned set
  const availableStaffIds = new Set(availableStaff.map((s: StaffListDto) => s.id))
  const assignedStaffIds = new Set(staff.map((s: StaffAssignmentDto) => s.staffId))

  const resetStaffForm = () => {
    setSelectedStaffId('')
    setStaffAssignmentRole('')
    setStaffAssignmentStart(trip?.startDate?.split('T')[0] ?? '')
    setStaffAssignmentEnd(trip?.endDate?.split('T')[0] ?? '')
    setStaffIsDriver(false)
    setStaffSleepoverType('None')
    setStaffShiftNotes('')
    setAddFindings([])
    setAddOverrideReason('')
    setAddReasonRequired(false)
    setAddError(null)
  }

  // Live dry-run: re-checks findings whenever the selected staff/dates change, debounced 400ms,
  // mirroring the edit-modal effect above — no excludeAssignmentId (this is always a new
  // assignment). Never writes.
  useEffect(() => {
    if (!showAddStaff || !selectedStaffId || !staffAssignmentStart || !staffAssignmentEnd) {
      return
    }
    const handle = setTimeout(() => {
      checkStaffAssignment.mutate(
        {
          staffId: selectedStaffId,
          tripInstanceId: tripId,
          assignmentStart: staffAssignmentStart,
          assignmentEnd: staffAssignmentEnd,
        },
        { onSuccess: setAddFindings },
      )
    }, 400)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddStaff, selectedStaffId, staffAssignmentStart, staffAssignmentEnd])

  const handleCreateStaffAssignment = () => {
    if (!selectedStaffId || !tripId) return
    if (addGate.isBlocked) return
    if (addGate.needsReason && !addOverrideReason.trim()) {
      setAddReasonRequired(true)
      return
    }
    setAddReasonRequired(false)
    setAddError(null)

    createStaffAssignment.mutate({
      tripInstanceId: tripId,
      staffId: selectedStaffId,
      assignmentRole: staffAssignmentRole || undefined,
      assignmentStart: staffAssignmentStart || '',
      assignmentEnd: staffAssignmentEnd || '',
      isDriver: staffIsDriver,
      sleepoverType: (staffSleepoverType || undefined) as SleepoverType | undefined,
      shiftNotes: staffShiftNotes || undefined,
      overrideReason: addOverrideReason.trim() || undefined,
      acknowledgedFindingCodes: addFindings.map(f => f.code),
    }, {
      onSuccess: () => {
        setShowAddStaff(false)
        resetStaffForm()
      },
      onError: (err: unknown) => {
        const serverFindings = getRosterFindings(err)
        if (serverFindings) {
          setAddFindings(serverFindings)
          if (getRosterGate(serverFindings).needsReason && !addOverrideReason.trim()) setAddReasonRequired(true)
        } else {
          setAddError('Failed to add staff. Please try again.')
        }
      },
    })
  }

  const openEditStaffModal = (s: StaffAssignmentDto) => {
    setEditingStaff(s)
    setEditStaffForm({
      tripInstanceId: s.tripInstanceId,
      staffId: s.staffId,
      assignmentRole: s.assignmentRole ?? '',
      assignmentStart: s.assignmentStart ?? '',
      assignmentEnd: s.assignmentEnd ?? '',
      isDriver: s.isDriver ?? false,
      sleepoverType: s.sleepoverType ?? 'None',
      shiftNotes: s.shiftNotes ?? '',
      status: s.status ?? 'Proposed',
    })
    setEditFindings([])
    // Preload the assignment's stored override reason (if any) so a coordinator can see/amend
    // why an override was originally made, rather than it silently resetting to blank — matches
    // ShiftSlideOver's existing/forceVisible pattern below.
    setEditOverrideReason(s.overrideReason ?? '')
    setEditReasonRequired(false)
    setEditError(null)
  }

  // Live dry-run: re-checks findings whenever the edited window changes, debounced 400ms like
  // ShiftSlideOver (dates ARE editable here, unlike StaffAssignModal) — excludeAssignmentId keeps
  // the assignment's own row from double-booking against itself. Never writes.
  useEffect(() => {
    if (!editingStaff || !editStaffForm.assignmentStart || !editStaffForm.assignmentEnd) return
    const handle = setTimeout(() => {
      checkStaffAssignment.mutate(
        {
          staffId: editingStaff.staffId,
          tripInstanceId: editingStaff.tripInstanceId,
          assignmentStart: editStaffForm.assignmentStart,
          assignmentEnd: editStaffForm.assignmentEnd,
          excludeAssignmentId: editingStaff.id,
        },
        { onSuccess: setEditFindings },
      )
    }, 400)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingStaff?.id, editStaffForm.assignmentStart, editStaffForm.assignmentEnd])

  const handleUpdateStaffAssignment = () => {
    if (!editingStaff) return
    if (editGate.isBlocked) return
    if (editGate.needsReason && !editOverrideReason.trim()) {
      setEditReasonRequired(true)
      return
    }
    setEditReasonRequired(false)
    setEditError(null)

    const data: UpdateStaffAssignmentDto = {
      tripInstanceId: editStaffForm.tripInstanceId,
      staffId: editStaffForm.staffId,
      assignmentRole: editStaffForm.assignmentRole || undefined,
      assignmentStart: editStaffForm.assignmentStart,
      assignmentEnd: editStaffForm.assignmentEnd,
      isDriver: editStaffForm.isDriver,
      sleepoverType: editStaffForm.sleepoverType || undefined,
      shiftNotes: editStaffForm.shiftNotes || undefined,
      status: editStaffForm.status,
      overrideReason: editOverrideReason.trim() || undefined,
      acknowledgedFindingCodes: editFindings.map(f => f.code),
    }
    updateStaffAssignment.mutate({ id: editingStaff.id, data }, {
      onSuccess: () => setEditingStaff(null),
      onError: (err: unknown) => {
        const serverFindings = getRosterFindings(err)
        if (serverFindings) {
          setEditFindings(serverFindings)
          if (getRosterGate(serverFindings).needsReason && !editOverrideReason.trim()) setEditReasonRequired(true)
        } else {
          setEditError('Failed to update assignment. Please try again.')
        }
      },
    })
  }

  return (
    <div className="space-y-4">
      {/* Staffing summary */}
      {(() => {
        const ratioToStaff: Record<string, number> = { OneToOne: 1, OneToTwo: 0.5, OneToThree: 1/3, OneToFour: 0.25, OneToFive: 0.2, TwoToOne: 2, SharedSupport: 0.25 }
        const activeBookings = bookings.filter((b: BookingListDto) => !['Cancelled', 'NoLongerAttending'].includes(b.bookingStatus))
        const rawTotal = activeBookings.reduce((sum: number, b: BookingListDto) => sum + (ratioToStaff[b.supportRatioOverride ?? ''] ?? 0), 0)
        const required = Math.ceil(rawTotal)
        const assigned = staff.filter((s: StaffAssignmentDto) => s.status !== 'Cancelled').length
        const isStaffed = assigned >= required
        return (
          <div className="flex items-center justify-between gap-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${isStaffed
              ? 'bg-[var(--color-primary-fixed)]/30 text-[var(--color-success)]'
              : 'bg-[var(--color-error-container)]/60 text-[var(--color-destructive)]'}`}>
              <span>{assigned}/{required} staff</span>
              <span className="text-xs font-normal">({rawTotal.toFixed(2)} required from ratios)</span>
              {!isStaffed && <span className="text-xs">— need {required - assigned} more</span>}
            </div>
            {canWrite && (
              <button onClick={() => { resetStaffForm(); setShowAddStaff(true) }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
                <Plus className="w-4 h-4" /> Add Staff
              </button>
            )}
          </div>
        )
      })()}

      <DataTable
        data={staff}
        keyField="id"
        emptyMessage="No staff assigned yet"
        sortable
        columns={[
          {
            key: 'staffName',
            header: 'Staff',
            className: 'font-medium',
            sortable: true,
          },
          {
            key: 'assignmentRole',
            header: 'Role',
            sortable: true,
            render: (s: StaffAssignmentDto) => s.assignmentRole || '—',
          },
          {
            key: 'assignmentStart',
            header: 'Dates',
            type: 'date',
            sortable: true,
            render: (s: StaffAssignmentDto) => `${formatDateAu(s.assignmentStart)} — ${formatDateAu(s.assignmentEnd)}`,
          },
          {
            key: 'status',
            header: 'Status',
            type: 'badge',
            sortable: true,
          },
          {
            key: 'isDriver',
            header: 'Driver',
            type: 'boolean',
            align: 'center',
          },
          {
            key: 'sleepoverType',
            header: 'Sleepover',
            align: 'center',
            render: (s: StaffAssignmentDto) => s.sleepoverType !== 'None' ? <span className="text-xs">{s.sleepoverType}</span> : null,
          },
          {
            key: 'actions',
            header: '',
            align: 'center',
            render: (s: StaffAssignmentDto) => (
              <div className="flex items-center justify-center gap-2">
                {s.hasConflict && (
                  <span
                    title={s.overrideReason ? `Overridden: ${s.overrideReason}` : 'Conflict acknowledged'}
                    tabIndex={0}
                    role="img"
                    aria-label={s.overrideReason ? `Overridden: ${s.overrideReason}` : 'Conflict acknowledged'}
                  >
                    <AlertTriangle aria-hidden className="w-4 h-4 text-[var(--color-warning)]" />
                  </span>
                )}
                {canWrite && (
                  <button onClick={() => openEditStaffModal(s)} className="p-1 rounded hover:bg-[var(--color-surface-container)] transition-colors" title="Edit assignment">
                    <Pencil className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
                  </button>
                )}
                {canWrite && (
                  <button onClick={() => setDeletingStaff(s)} className="p-1 rounded hover:bg-[var(--color-error-container)]/60 transition-colors" title="Remove from trip">
                    <Trash2 className="w-3.5 h-3.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Edit Staff Assignment Modal */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingStaff(null)}>
          <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)] mx-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit Assignment — {editingStaff.staffName}</h3>
              <button onClick={() => setEditingStaff(null)} className="p-1 rounded hover:bg-[var(--color-surface-container)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Assignment Role */}
              <div>
                <label className="block text-sm font-medium mb-1">Assignment Role</label>
                <input type="text" value={editStaffForm.assignmentRole} onChange={e => setEditStaffForm({ ...editStaffForm, assignmentRole: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm"
                  placeholder="e.g. Support Worker" />
              </div>

              {/* Status */}
              <div>
                <label id="editStaffStatusLabel" className="block text-sm font-medium mb-1">Status</label>
                <Dropdown
                  variant="form"
                  aria-labelledby="editStaffStatusLabel"
                  value={editStaffForm.status}
                  onChange={val => setEditStaffForm({ ...editStaffForm, status: val as AssignmentStatus })}
                  items={ASSIGNMENT_STATUS_ITEMS}
                />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Assignment Start</label>
                  <input type="date" value={editStaffForm.assignmentStart} onChange={e => setEditStaffForm({ ...editStaffForm, assignmentStart: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Assignment End</label>
                  <input type="date" value={editStaffForm.assignmentEnd} onChange={e => setEditStaffForm({ ...editStaffForm, assignmentEnd: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
              </div>

              {/* Is Driver */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={editStaffForm.isDriver} onChange={e => setEditStaffForm({ ...editStaffForm, isDriver: e.target.checked })}
                    className="rounded border-[rgba(195,201,181,0.15)]" />
                  Is Driver
                </label>
              </div>

              {/* Sleepover Type */}
              <div>
                <label id="editStaffSleepoverTypeLabel" className="block text-sm font-medium mb-1">Sleepover Type</label>
                <Dropdown
                  variant="form"
                  aria-labelledby="editStaffSleepoverTypeLabel"
                  value={editStaffForm.sleepoverType}
                  onChange={val => setEditStaffForm({ ...editStaffForm, sleepoverType: val as SleepoverType })}
                  items={SLEEPOVER_TYPE_ITEMS}
                />
              </div>

              {/* Shift Notes */}
              <div>
                <label className="block text-sm font-medium mb-1">Shift Notes</label>
                <textarea value={editStaffForm.shiftNotes} onChange={e => setEditStaffForm({ ...editStaffForm, shiftNotes: e.target.value })} rows={3}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm resize-none focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Conflict findings — same gate as StaffAssignModal, via the shared RosterGateFields */}
              <RosterGateFields
                findings={editFindings}
                overrideReason={editOverrideReason}
                onOverrideReasonChange={setEditOverrideReason}
                reasonRequired={editReasonRequired}
                forceVisible={!!editingStaff?.overrideReason}
              />

              {/* Error */}
              {editError && (
                <p className="text-sm text-[var(--color-destructive)]">{editError}</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditingStaff(null)}
                  className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm hover:bg-[var(--color-surface-container)] transition-colors">
                  Cancel
                </button>
                <button onClick={handleUpdateStaffAssignment} disabled={updateStaffAssignment.isPending || editGate.isBlocked}
                  className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {updateStaffAssignment.isPending ? 'Saving...' : editGate.needsReason ? 'Save with override' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Staff Modal */}
      {showAddStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAddStaff(false)}>
          <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)] mx-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Staff to Trip</h3>
              <button onClick={() => setShowAddStaff(false)} className="p-1 rounded hover:bg-[var(--color-surface-container)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Staff Select — UX-01: staff-scale list, SearchableSelect not a bounded native
                  select. This file doesn't wrap fields in FormField, so the label/control
                  association is wired by hand (id + aria-labelledby) the same way FormField does
                  it for a custom component child. */}
              <div>
                <label id="addStaffMemberLabel" className="block text-sm font-medium mb-1">Staff Member</label>
                <SearchableSelect
                  aria-labelledby="addStaffMemberLabel"
                  value={selectedStaffId}
                  onChange={setSelectedStaffId}
                  placeholder="Select staff..."
                  items={allStaff
                    .filter((s: StaffListDto) => !assignedStaffIds.has(s.id))
                    .map((s: StaffListDto) => {
                      const isAvailable = availableStaffIds.has(s.id)
                      return { value: s.id, label: `${s.fullName}${!isAvailable ? ' (Unavailable)' : ''}` }
                    })}
                />
                {selectedStaffId && !availableStaffIds.has(selectedStaffId) && (
                  <p className="text-xs text-[var(--color-warning)] mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> This staff member has a scheduling conflict for the trip dates
                  </p>
                )}
              </div>

              {/* Assignment Role */}
              <div>
                <label className="block text-sm font-medium mb-1">Assignment Role</label>
                <input type="text" value={staffAssignmentRole} onChange={e => setStaffAssignmentRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm"
                  placeholder="e.g. Support Worker" />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Start Date</label>
                  <input type="date" value={staffAssignmentStart} onChange={e => setStaffAssignmentStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">End Date</label>
                  <input type="date" value={staffAssignmentEnd} onChange={e => setStaffAssignmentEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
              </div>

              {/* Is Driver */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={staffIsDriver} onChange={e => setStaffIsDriver(e.target.checked)}
                    className="rounded border-[rgba(195,201,181,0.15)]" />
                  Is Driver
                </label>
              </div>

              {/* Sleepover Type */}
              <div>
                <label id="addStaffSleepoverTypeLabel" className="block text-sm font-medium mb-1">Sleepover Type</label>
                <Dropdown
                  variant="form"
                  aria-labelledby="addStaffSleepoverTypeLabel"
                  value={staffSleepoverType}
                  onChange={setStaffSleepoverType}
                  items={SLEEPOVER_TYPE_ITEMS}
                />
              </div>

              {/* Shift Notes */}
              <div>
                <label className="block text-sm font-medium mb-1">Shift Notes</label>
                <textarea value={staffShiftNotes} onChange={e => setStaffShiftNotes(e.target.value)} rows={3}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm resize-none focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Conflict findings — same gate as the edit modal, via the shared RosterGateFields */}
              <RosterGateFields
                findings={addFindings}
                overrideReason={addOverrideReason}
                onOverrideReasonChange={setAddOverrideReason}
                reasonRequired={addReasonRequired}
              />

              {/* Error */}
              {addError && (
                <p className="text-sm text-[var(--color-destructive)]">{addError}</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAddStaff(false)}
                  className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm hover:bg-[var(--color-surface-container)] transition-colors">
                  Cancel
                </button>
                <button onClick={handleCreateStaffAssignment}
                  disabled={!selectedStaffId || createStaffAssignment.isPending || addGate.isBlocked}
                  className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {createStaffAssignment.isPending ? 'Adding...' : addGate.needsReason ? 'Add with override' : 'Add Staff'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete/Cancel Staff Assignment Confirmation */}
      <ConfirmDialog
        open={deletingStaff !== null}
        onCancel={() => setDeletingStaff(null)}
        title="Remove Staff"
        message={
          <>
            <p>
              What would you like to do with <span className="font-medium text-[var(--color-foreground)]">{deletingStaff?.staffName}</span>'s assignment?
            </p>
            {(updateStaffAssignment.isError || deleteStaffAssignment.isError) && (
              <p className="text-[var(--color-destructive)]">Something went wrong. Please try again.</p>
            )}
          </>
        }
        footer={
          <div className="flex flex-col gap-2 w-full">
            <button
              onClick={() => {
                if (!deletingStaff) return
                const data: UpdateStaffAssignmentDto = {
                  tripInstanceId: deletingStaff.tripInstanceId,
                  staffId: deletingStaff.staffId,
                  assignmentRole: deletingStaff.assignmentRole ?? undefined,
                  assignmentStart: deletingStaff.assignmentStart,
                  assignmentEnd: deletingStaff.assignmentEnd,
                  isDriver: deletingStaff.isDriver,
                  sleepoverType: deletingStaff.sleepoverType,
                  shiftNotes: deletingStaff.shiftNotes ?? undefined,
                  status: 'Cancelled',
                }
                updateStaffAssignment.mutate({ id: deletingStaff.id, data }, { onSuccess: () => setDeletingStaff(null) })
              }}
              disabled={updateStaffAssignment.isPending || deleteStaffAssignment.isPending}
              className="w-full px-4 py-2 rounded-[var(--radius-md)] bg-[#fef3c7]/60 text-sm font-medium hover:bg-[#fef3c7] transition-colors disabled:opacity-50 text-left">
              <span className="font-semibold">Cancel assignment</span>
              <span className="block text-xs text-[var(--color-muted-foreground)] mt-0.5">Mark as cancelled — keeps the record for history</span>
            </button>
            <button
              onClick={() => deletingStaff && deleteStaffAssignment.mutate(deletingStaff.id, { onSuccess: () => setDeletingStaff(null) })}
              disabled={deleteStaffAssignment.isPending || updateStaffAssignment.isPending}
              className="w-full px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm font-medium hover:bg-[var(--color-destructive)]/20 transition-colors disabled:opacity-50 text-left">
              <span className="font-semibold">Delete permanently</span>
              <span className="block text-xs mt-0.5 opacity-80">Remove completely from the trip — cannot be undone</span>
            </button>
          </div>
        }
      />
    </div>
  )
}
