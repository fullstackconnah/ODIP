import { useEffect, useState } from 'react'
import { Plus, AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import {
  useUpdateStaffAssignment,
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
import { extractErrorMessage, formatDateAu } from '@/lib/utils'
import { formatRatio } from '@/lib/format'
import { ASSIGNMENT_STATUSES, SLEEPOVER_TYPES, type SleepoverType, type AssignmentStatus } from '@/api/types/enums'
import type { TripDetailDto } from '@/api/types/trips'
import type { StaffAssignmentDto, StaffListDto, UpdateStaffAssignmentDto } from '@/api/types/staff'
import type { RosterFindingDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { FormField } from '@/components/FormField'
import { modalGrid } from '@/lib/formGrid'

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
  canWrite: boolean
}

export default function StaffTab({ tripId, trip, staff, canWrite }: StaffTabProps) {
  const updateStaffAssignment = useUpdateStaffAssignment()
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
          setAddError(extractErrorMessage(err, "Couldn't add this staff member. Check your connection and try again."))
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
          setEditError(extractErrorMessage(err, "Couldn't update this assignment. Check your connection and try again."))
        }
      },
    })
  }

  return (
    <div className="space-y-4">
      {/* Staffing summary */}
      {(() => {
        const required = trip.staffRequired ?? 0
        const assigned = staff.filter((s: StaffAssignmentDto) => s.status !== 'Cancelled').length
        const isStaffed = assigned >= required
        return (
          <div className="flex items-center justify-between gap-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${isStaffed
              ? 'bg-[var(--color-primary-fixed)]/30 text-[var(--color-success)]'
              : 'bg-[var(--color-error-container)]/60 text-[var(--color-destructive)]'}`}>
              <span>{formatRatio(assigned, trip.staffRequired ?? '?')} staff</span>
              <span className="text-xs font-normal">({trip.calculatedStaffRequired.toFixed(2)} required from ratios)</span>
              {!isStaffed && <span className="text-xs">— need {required - assigned} more</span>}
            </div>
            {canWrite && (
              <Button onClick={() => { resetStaffForm(); setShowAddStaff(true) }}>
                <Plus className="w-4 h-4" /> Add Staff
              </Button>
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
                  <Button variant="ghost" size="sm" iconOnly onClick={() => openEditStaffModal(s)} title="Edit assignment" aria-label={`Edit assignment: ${s.staffName || 'this staff member'}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                )}
                {canWrite && (
                  <Button variant="ghost-danger" size="sm" iconOnly onClick={() => setDeletingStaff(s)} title="Remove from trip" aria-label={`Remove from trip: ${s.staffName || 'this staff member'}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Edit Staff Assignment Modal */}
      {editingStaff && (
        <Modal
          open
          onClose={() => setEditingStaff(null)}
          title={`Edit Assignment — ${editingStaff.staffName}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditingStaff(null)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateStaffAssignment} disabled={updateStaffAssignment.isPending || editGate.isBlocked}>
                {updateStaffAssignment.isPending ? 'Saving…' : editGate.needsReason ? 'Save with override' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Assignment Role */}
            <FormField label="Assignment Role"><input type="text" value={editStaffForm.assignmentRole} onChange={e => setEditStaffForm({ ...editStaffForm, assignmentRole: e.target.value })}
                placeholder="e.g. Support Worker" /></FormField>

            {/* Status */}
            <FormField label="Status"><Dropdown
                variant="form"
                value={editStaffForm.status}
                onChange={val => setEditStaffForm({ ...editStaffForm, status: val as AssignmentStatus })}
                items={ASSIGNMENT_STATUS_ITEMS}
              /></FormField>

            {/* Dates */}
            <div className={modalGrid}>
              <FormField label="Assignment Start"><input type="date" value={editStaffForm.assignmentStart} onChange={e => setEditStaffForm({ ...editStaffForm, assignmentStart: e.target.value })} /></FormField>
              <FormField label="Assignment End"><input type="date" value={editStaffForm.assignmentEnd} onChange={e => setEditStaffForm({ ...editStaffForm, assignmentEnd: e.target.value })} /></FormField>
            </div>

            {/* Is Driver */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={editStaffForm.isDriver} onChange={e => setEditStaffForm({ ...editStaffForm, isDriver: e.target.checked })}
                  className="rounded border-[var(--color-border)]" />
                Is Driver
              </label>
            </div>

            {/* Sleepover Type */}
            <FormField label="Sleepover Type"><Dropdown
                variant="form"
                value={editStaffForm.sleepoverType}
                onChange={val => setEditStaffForm({ ...editStaffForm, sleepoverType: val as SleepoverType })}
                items={SLEEPOVER_TYPE_ITEMS}
              /></FormField>

            {/* Shift Notes */}
            <FormField label="Shift Notes"><textarea value={editStaffForm.shiftNotes} onChange={e => setEditStaffForm({ ...editStaffForm, shiftNotes: e.target.value })} rows={3} className="resize-none"
                placeholder="Optional notes..." /></FormField>

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
          </div>
        </Modal>
      )}

      {/* Add Staff Modal */}
      {showAddStaff && (
        <Modal
          open
          onClose={() => setShowAddStaff(false)}
          title="Add Staff to Trip"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowAddStaff(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateStaffAssignment}
                disabled={!selectedStaffId || createStaffAssignment.isPending || addGate.isBlocked}>
                {createStaffAssignment.isPending ? 'Adding...' : addGate.needsReason ? 'Add with override' : 'Add Staff'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Staff Select — UX-01: staff-scale list, SearchableSelect not a bounded native select. */}
            <div>
              <FormField label="Staff Member"><SearchableSelect
                value={selectedStaffId}
                onChange={setSelectedStaffId}
                placeholder="Select staff..."
                items={allStaff
                  .filter((s: StaffListDto) => !assignedStaffIds.has(s.id))
                  .map((s: StaffListDto) => {
                    const isAvailable = availableStaffIds.has(s.id)
                    return { value: s.id, label: `${s.fullName}${!isAvailable ? ' (Unavailable)' : ''}` }
                  })}
              /></FormField>
              {selectedStaffId && !availableStaffIds.has(selectedStaffId) && (
                <p className="text-xs text-[var(--color-warning)] mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> This staff member has a scheduling conflict for the trip dates
                </p>
              )}
            </div>

            {/* Assignment Role */}
            <FormField label="Assignment Role"><input type="text" value={staffAssignmentRole} onChange={e => setStaffAssignmentRole(e.target.value)}
                placeholder="e.g. Support Worker" /></FormField>

            {/* Dates */}
            <div className={modalGrid}>
              <FormField label="Start Date"><input type="date" value={staffAssignmentStart} onChange={e => setStaffAssignmentStart(e.target.value)} /></FormField>
              <FormField label="End Date"><input type="date" value={staffAssignmentEnd} onChange={e => setStaffAssignmentEnd(e.target.value)} /></FormField>
            </div>

            {/* Is Driver */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={staffIsDriver} onChange={e => setStaffIsDriver(e.target.checked)}
                  className="rounded border-[var(--color-border)]" />
                Is Driver
              </label>
            </div>

            {/* Sleepover Type */}
            <FormField label="Sleepover Type"><Dropdown
                variant="form"
                value={staffSleepoverType}
                onChange={setStaffSleepoverType}
                items={SLEEPOVER_TYPE_ITEMS}
              /></FormField>

            {/* Shift Notes */}
            <FormField label="Shift Notes"><textarea value={staffShiftNotes} onChange={e => setStaffShiftNotes(e.target.value)} rows={3} className="resize-none"
                placeholder="Optional notes..." /></FormField>

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
          </div>
        </Modal>
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
            {updateStaffAssignment.isError && (
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
              disabled={updateStaffAssignment.isPending}
              className="w-full px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-warning-container)]/60 text-sm font-medium hover:bg-[var(--color-warning-container)] transition-colors disabled:opacity-50 text-left">
              <span className="font-semibold">Cancel assignment</span>
              <span className="block text-xs text-[var(--color-muted-foreground)] mt-0.5">Mark as cancelled — keeps the record for history</span>
            </button>
          </div>
        }
      />
    </div>
  )
}
