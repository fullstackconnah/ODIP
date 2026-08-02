import { useState } from 'react'
import { Plus, X, AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import {
  useUpdateStaffAssignment,
  useDeleteStaffAssignment,
  useCreateStaffAssignment,
  useStaff,
  useAvailableStaff,
} from '@/api/hooks'
import { DataTable } from '@/components/DataTable'
import { formatDateAu } from '@/lib/utils'
import type { SleepoverType, AssignmentStatus } from '@/api/types/enums'
import type { TripDetailDto } from '@/api/types/trips'
import type { StaffAssignmentDto, StaffListDto, UpdateStaffAssignmentDto } from '@/api/types/staff'
import type { BookingListDto } from '@/api/types/bookings'

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
  const [editingStaff, setEditingStaff] = useState<StaffAssignmentDto | null>(null)
  const [editStaffForm, setEditStaffForm] = useState<StaffEditForm>({} as StaffEditForm)
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
  }

  const handleCreateStaffAssignment = () => {
    if (!selectedStaffId || !tripId) return
    createStaffAssignment.mutate({
      tripInstanceId: tripId,
      staffId: selectedStaffId,
      assignmentRole: staffAssignmentRole || undefined,
      assignmentStart: staffAssignmentStart || '',
      assignmentEnd: staffAssignmentEnd || '',
      isDriver: staffIsDriver,
      sleepoverType: (staffSleepoverType || undefined) as SleepoverType | undefined,
      shiftNotes: staffShiftNotes || undefined,
    }, {
      onSuccess: () => {
        setShowAddStaff(false)
        resetStaffForm()
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
  }

  const handleUpdateStaffAssignment = () => {
    if (!editingStaff) return
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
    }
    updateStaffAssignment.mutate({ id: editingStaff.id, data }, {
      onSuccess: () => setEditingStaff(null),
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
              ? 'bg-[#bbf37c]/30 text-[#396200]'
              : 'bg-[#ffdad6]/60 text-[#ba1a1a]'}`}>
              <span>{assigned}/{required} staff</span>
              <span className="text-xs font-normal">({rawTotal.toFixed(2)} required from ratios)</span>
              {!isStaffed && <span className="text-xs">— need {required - assigned} more</span>}
            </div>
            {canWrite && (
              <button onClick={() => { resetStaffForm(); setShowAddStaff(true) }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#396200] text-white text-sm font-medium hover:opacity-90 transition-opacity">
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
                {s.hasConflict && <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />}
                {canWrite && (
                  <button onClick={() => openEditStaffModal(s)} className="p-1 rounded hover:bg-[#efeeea] transition-colors" title="Edit assignment">
                    <Pencil className="w-3.5 h-3.5 text-[#43493a]" />
                  </button>
                )}
                {canWrite && (
                  <button onClick={() => setDeletingStaff(s)} className="p-1 rounded hover:bg-[#ffdad6]/60 transition-colors" title="Remove from trip">
                    <Trash2 className="w-3.5 h-3.5 text-[#43493a] hover:text-[#ba1a1a]" />
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
          <div className="bg-white rounded-2xl p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)] mx-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit Assignment — {editingStaff.staffName}</h3>
              <button onClick={() => setEditingStaff(null)} className="p-1 rounded hover:bg-[#efeeea] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Assignment Role */}
              <div>
                <label className="block text-sm font-medium mb-1">Assignment Role</label>
                <input type="text" value={editStaffForm.assignmentRole} onChange={e => setEditStaffForm({ ...editStaffForm, assignmentRole: e.target.value })}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                  placeholder="e.g. Support Worker" />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select value={editStaffForm.status} onChange={e => setEditStaffForm({ ...editStaffForm, status: e.target.value as AssignmentStatus })}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                  {['Proposed', 'Confirmed', 'Completed', 'Cancelled'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Assignment Start</label>
                  <input type="date" value={editStaffForm.assignmentStart} onChange={e => setEditStaffForm({ ...editStaffForm, assignmentStart: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Assignment End</label>
                  <input type="date" value={editStaffForm.assignmentEnd} onChange={e => setEditStaffForm({ ...editStaffForm, assignmentEnd: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
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
                <label className="block text-sm font-medium mb-1">Sleepover Type</label>
                <select value={editStaffForm.sleepoverType} onChange={e => setEditStaffForm({ ...editStaffForm, sleepoverType: e.target.value as SleepoverType })}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                  <option value="None">None</option>
                  <option value="ActiveNight">Active Night</option>
                  <option value="PassiveNight">Passive Night</option>
                  <option value="Sleepover">Sleepover</option>
                </select>
              </div>

              {/* Shift Notes */}
              <div>
                <label className="block text-sm font-medium mb-1">Shift Notes</label>
                <textarea value={editStaffForm.shiftNotes} onChange={e => setEditStaffForm({ ...editStaffForm, shiftNotes: e.target.value })} rows={3}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm resize-none focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Error */}
              {updateStaffAssignment.isError && (
                <p className="text-sm text-[#ba1a1a]">Failed to update assignment. Please try again.</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditingStaff(null)}
                  className="px-4 py-2 rounded-2xl bg-[#f5f3ef] text-sm hover:bg-[#efeeea] transition-colors">
                  Cancel
                </button>
                <button onClick={handleUpdateStaffAssignment} disabled={updateStaffAssignment.isPending}
                  className="px-4 py-2 rounded-lg bg-[#396200] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {updateStaffAssignment.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Staff Modal */}
      {showAddStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAddStaff(false)}>
          <div className="bg-white rounded-2xl p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)] mx-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Staff to Trip</h3>
              <button onClick={() => setShowAddStaff(false)} className="p-1 rounded hover:bg-[#efeeea] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Staff Select */}
              <div>
                <label className="block text-sm font-medium mb-1">Staff Member</label>
                <select value={selectedStaffId} onChange={e => setSelectedStaffId(e.target.value)}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                  <option value="">Select staff...</option>
                  {allStaff
                    .filter((s: StaffListDto) => !assignedStaffIds.has(s.id))
                    .map((s: StaffListDto) => {
                      const isAvailable = availableStaffIds.has(s.id)
                      return (
                        <option key={s.id} value={s.id}>
                          {s.fullName}{!isAvailable ? ' (Unavailable)' : ''}
                        </option>
                      )
                    })}
                </select>
                {selectedStaffId && !availableStaffIds.has(selectedStaffId) && (
                  <p className="text-xs text-[#f59e0b] mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> This staff member has a scheduling conflict for the trip dates
                  </p>
                )}
              </div>

              {/* Assignment Role */}
              <div>
                <label className="block text-sm font-medium mb-1">Assignment Role</label>
                <input type="text" value={staffAssignmentRole} onChange={e => setStaffAssignmentRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                  placeholder="e.g. Support Worker" />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Start Date</label>
                  <input type="date" value={staffAssignmentStart} onChange={e => setStaffAssignmentStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">End Date</label>
                  <input type="date" value={staffAssignmentEnd} onChange={e => setStaffAssignmentEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
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
                <label className="block text-sm font-medium mb-1">Sleepover Type</label>
                <select value={staffSleepoverType} onChange={e => setStaffSleepoverType(e.target.value)}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                  <option value="None">None</option>
                  <option value="ActiveNight">Active Night</option>
                  <option value="PassiveNight">Passive Night</option>
                  <option value="Sleepover">Sleepover</option>
                </select>
              </div>

              {/* Shift Notes */}
              <div>
                <label className="block text-sm font-medium mb-1">Shift Notes</label>
                <textarea value={staffShiftNotes} onChange={e => setStaffShiftNotes(e.target.value)} rows={3}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm resize-none focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Error */}
              {createStaffAssignment.isError && (
                <p className="text-sm text-[#ba1a1a]">Failed to add staff. Please try again.</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAddStaff(false)}
                  className="px-4 py-2 rounded-2xl bg-[#f5f3ef] text-sm hover:bg-[#efeeea] transition-colors">
                  Cancel
                </button>
                <button onClick={handleCreateStaffAssignment} disabled={!selectedStaffId || createStaffAssignment.isPending}
                  className="px-4 py-2 rounded-lg bg-[#396200] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {createStaffAssignment.isPending ? 'Adding...' : 'Add Staff'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete/Cancel Staff Assignment Confirmation */}
      {deletingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeletingStaff(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Remove Staff</h3>
              <button onClick={() => setDeletingStaff(null)} className="p-1 rounded hover:bg-[#efeeea] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[#43493a]">
              What would you like to do with <span className="font-medium text-[#1b1c1a]">{deletingStaff.staffName}</span>'s assignment?
            </p>
            {(updateStaffAssignment.isError || deleteStaffAssignment.isError) && (
              <p className="text-sm text-[#ba1a1a] mt-3">Something went wrong. Please try again.</p>
            )}
            <div className="flex flex-col gap-2 mt-4">
              <button
                onClick={() => {
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
                className="w-full px-4 py-2 rounded-2xl bg-[#fef3c7]/60 text-sm font-medium hover:bg-[#fef3c7] transition-colors disabled:opacity-50 text-left">
                <span className="font-semibold">Cancel assignment</span>
                <span className="block text-xs text-[#43493a] mt-0.5">Mark as cancelled — keeps the record for history</span>
              </button>
              <button
                onClick={() => deleteStaffAssignment.mutate(deletingStaff.id, { onSuccess: () => setDeletingStaff(null) })}
                disabled={deleteStaffAssignment.isPending || updateStaffAssignment.isPending}
                className="w-full px-4 py-2 rounded-2xl bg-[#ffdad6]/60 text-sm font-medium hover:bg-[#ffdad6] transition-colors disabled:opacity-50 text-left">
                <span className="font-semibold">Delete permanently</span>
                <span className="block text-xs text-[#43493a] mt-0.5">Remove completely from the trip — cannot be undone</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
