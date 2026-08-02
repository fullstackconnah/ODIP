import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useCreateBooking, useUpdateBooking, usePatchBooking, useDeleteBooking, useCancelBooking, PAYMENT_STATUS_ITEMS, PAYMENT_STATUS_COLORS } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { DataTable } from '@/components/DataTable'
import { getStatusColor } from '@/lib/utils'
import type { BookingStatus, InsuranceStatus, PaymentStatus, SupportRatio } from '@/api/types/enums'
import { Plus, X, AlertTriangle, Pencil, ExternalLink, Trash2 } from 'lucide-react'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'
import type { ParticipantListDto } from '@/api/types/participants'

interface BookingsTabProps {
  tripId: string
  trip: TripDetailDto
  bookings: BookingListDto[]
  participants: ParticipantListDto[]
  canWrite: boolean
  isReadOnly: boolean
}

export default function BookingsTab({ tripId, trip, bookings, participants, canWrite, isReadOnly }: BookingsTabProps) {
  const [showAddBooking, setShowAddBooking] = useState(false)
  const [selectedParticipantId, setSelectedParticipantId] = useState('')
  const [bookingStatus, setBookingStatus] = useState('Enquiry')
  const [wheelchairRequired, setWheelchairRequired] = useState(false)
  const [highSupportRequired, setHighSupportRequired] = useState(false)
  const [nightSupportRequired, setNightSupportRequired] = useState(false)
  const [hasRestrictivePracticeFlag, setHasRestrictivePracticeFlag] = useState(false)
  const [supportRatioOverride, setSupportRatioOverride] = useState('')
  const [bookingNotes, setBookingNotes] = useState('')
  const [insuranceProvider, setInsuranceProvider] = useState('')
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState('')
  const [insuranceCoverageStart, setInsuranceCoverageStart] = useState('')
  const [insuranceCoverageEnd, setInsuranceCoverageEnd] = useState('')
  const [insuranceStatus, setInsuranceStatus] = useState('None')

  const [editingBooking, setEditingBooking] = useState<BookingListDto | null>(null)
  const [editForm, setEditForm] = useState<{
    bookingStatus: string
    supportRatioOverride: string
    wheelchairRequired: boolean
    highSupportRequired: boolean
    nightSupportRequired: boolean
    hasRestrictivePracticeFlag: boolean
    bookingNotes: string
    insuranceStatus: string
    insuranceProvider: string
    insurancePolicyNumber: string
    insuranceCoverageStart: string
    insuranceCoverageEnd: string
    [key: string]: unknown
  }>({
    bookingStatus: '',
    supportRatioOverride: '',
    wheelchairRequired: false,
    highSupportRequired: false,
    nightSupportRequired: false,
    hasRestrictivePracticeFlag: false,
    bookingNotes: '',
    insuranceStatus: 'None',
    insuranceProvider: '',
    insurancePolicyNumber: '',
    insuranceCoverageStart: '',
    insuranceCoverageEnd: '',
  })

  const [deletingBooking, setDeletingBooking] = useState<BookingListDto | null>(null)
  const [selectedBookingIds, setSelectedBookingIds] = useState<Set<string>>(new Set())
  const [bookingBulkLoading, setBookingBulkLoading] = useState(false)

  const createBooking = useCreateBooking()
  const updateBooking = useUpdateBooking()
  const patchBooking = usePatchBooking()
  const deleteBooking = useDeleteBooking()
  const cancelBooking = useCancelBooking()

  // Filter out participants already booked on this trip
  const bookedParticipantIds = new Set(bookings.map((b: BookingListDto) => b.participantId))
  const availableParticipants = participants.filter((p: ParticipantListDto) => !bookedParticipantIds.has(p.id) && p.isActive)

  // Auto-populate support fields when participant changes
  useEffect(() => {
    if (!selectedParticipantId) return
    const p = participants.find((p: ParticipantListDto) => p.id === selectedParticipantId)
    if (p) {
      setWheelchairRequired(p.wheelchairRequired ?? false)
      setHighSupportRequired(p.isHighSupport ?? false)
      setNightSupportRequired(p.requiresOvernightSupport ?? false)
      setHasRestrictivePracticeFlag(p.hasRestrictivePracticeFlag ?? false)
      setSupportRatioOverride(p.supportRatio ?? '')
    }
  }, [selectedParticipantId, participants])

  async function bulkPatchBookings(
    ids: string[],
    patch: Partial<{ bookingStatus: BookingStatus; insuranceStatus: InsuranceStatus; paymentStatus: PaymentStatus }>
  ) {
    setBookingBulkLoading(true)
    try {
      await Promise.all(
        ids.map(
          id =>
            new Promise<void>((resolve, reject) => {
              patchBooking.mutate(
                { id, data: patch },
                { onSuccess: () => resolve(), onError: err => reject(err) }
              )
            })
        )
      )
      setSelectedBookingIds(new Set())
    } catch {
      // individual mutation errors surface through TanStack Query
    } finally {
      setBookingBulkLoading(false)
    }
  }

  const resetForm = () => {
    setSelectedParticipantId('')
    setBookingStatus('Enquiry')
    setWheelchairRequired(false)
    setHighSupportRequired(false)
    setNightSupportRequired(false)
    setHasRestrictivePracticeFlag(false)
    setSupportRatioOverride('')
    setBookingNotes('')
    setInsuranceProvider('')
    setInsurancePolicyNumber('')
    setInsuranceCoverageStart('')
    setInsuranceCoverageEnd('')
    setInsuranceStatus('None')
  }

  const handleCreateBooking = () => {
    if (!selectedParticipantId || !tripId) return
    createBooking.mutate({
      tripInstanceId: tripId,
      participantId: selectedParticipantId,
      bookingStatus: bookingStatus as BookingStatus,
      wheelchairRequired,
      highSupportRequired,
      nightSupportRequired,
      hasRestrictivePracticeFlag,
      ...(supportRatioOverride ? { supportRatioOverride: supportRatioOverride as SupportRatio } : {}),
      ...(bookingNotes ? { bookingNotes } : {}),
      insuranceStatus: insuranceStatus as InsuranceStatus,
      ...(insuranceProvider ? { insuranceProvider } : {}),
      ...(insurancePolicyNumber ? { insurancePolicyNumber } : {}),
      ...(insuranceCoverageStart ? { insuranceCoverageStart } : {}),
      ...(insuranceCoverageEnd ? { insuranceCoverageEnd } : {}),
    }, {
      onSuccess: () => {
        setShowAddBooking(false)
        resetForm()
      },
    })
  }

  const openEditModal = (booking: BookingListDto) => {
    setEditingBooking(booking)
    const detail = booking as BookingListDto & Partial<import('@/api/types').BookingDetailDto>
    setEditForm({
      tripInstanceId: booking.tripInstanceId,
      participantId: booking.participantId,
      bookingStatus: booking.bookingStatus ?? 'Enquiry',
      wheelchairRequired: booking.wheelchairRequired ?? false,
      highSupportRequired: booking.highSupportRequired ?? false,
      nightSupportRequired: booking.nightSupportRequired ?? false,
      hasRestrictivePracticeFlag: booking.hasRestrictivePracticeFlag ?? false,
      supportRatioOverride: booking.supportRatioOverride ?? '',
      bookingNotes: detail.bookingNotes ?? '',
      insuranceProvider: detail.insuranceProvider || '',
      insurancePolicyNumber: detail.insurancePolicyNumber || '',
      insuranceCoverageStart: detail.insuranceCoverageStart || '',
      insuranceCoverageEnd: detail.insuranceCoverageEnd || '',
      insuranceStatus: booking.insuranceStatus || 'None',
    })
  }

  const handleUpdateBooking = () => {
    if (!editingBooking) return
    updateBooking.mutate({ id: editingBooking.id, data: {
      ...editForm,
      tripInstanceId: editingBooking.tripInstanceId as string,
      participantId: editingBooking.participantId as string,
      paymentStatus: editingBooking.paymentStatus as PaymentStatus,
      actionRequired: editingBooking.actionRequired as boolean,
      bookingStatus: (editForm.bookingStatus || undefined) as BookingStatus | undefined,
      supportRatioOverride: (editForm.supportRatioOverride || undefined) as SupportRatio | undefined,
      insuranceStatus: editForm.insuranceStatus as InsuranceStatus,
      insuranceProvider: editForm.insuranceProvider ?? undefined,
      insurancePolicyNumber: editForm.insurancePolicyNumber ?? undefined,
      insuranceCoverageStart: editForm.insuranceCoverageStart || undefined,
      insuranceCoverageEnd: editForm.insuranceCoverageEnd || undefined,
    }}, {
      onSuccess: () => setEditingBooking(null),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#43493a]">
          {bookings.length}{trip.maxParticipants ? `/${trip.maxParticipants}` : ''} spots filled
        </p>
        {canWrite && (
          <button onClick={() => setShowAddBooking(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#396200] text-white rounded-lg hover:opacity-90 transition-opacity text-sm font-medium">
            <Plus className="w-4 h-4" /> Add Participant
          </button>
        )}
      </div>

      {/* Add Booking Modal */}
      {showAddBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setShowAddBooking(false); resetForm() }}>
          <div className="bg-white rounded-2xl p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)] mx-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Participant to Trip</h3>
              <button onClick={() => { setShowAddBooking(false); resetForm() }} className="p-1 rounded hover:bg-[#efeeea] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Participant Select */}
              <div>
                <label className="block text-sm font-medium mb-1">Participant *</label>
                <select value={selectedParticipantId} onChange={e => setSelectedParticipantId(e.target.value)}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                  <option value="">Select a participant...</option>
                  {availableParticipants.map((p: ParticipantListDto) => (
                    <option key={p.id} value={p.id}>{p.fullName}</option>
                  ))}
                </select>
                {availableParticipants.length === 0 && (
                  <p className="text-xs text-[#43493a] mt-1">All active participants are already booked on this trip.</p>
                )}
              </div>

              {/* Booking Status */}
              <div>
                <label className="block text-sm font-medium mb-1">Booking Status</label>
                <select value={bookingStatus} onChange={e => setBookingStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                  {['Enquiry', 'Held', 'Confirmed', 'Waitlist'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Support Overrides */}
              <div>
                <label className="block text-sm font-medium mb-2">Support Requirements</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={wheelchairRequired} onChange={e => setWheelchairRequired(e.target.checked)}
                      className="rounded border-[rgba(195,201,181,0.15)]" />
                    Wheelchair
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={highSupportRequired} onChange={e => setHighSupportRequired(e.target.checked)}
                      className="rounded border-[rgba(195,201,181,0.15)]" />
                    High Support
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={nightSupportRequired} onChange={e => setNightSupportRequired(e.target.checked)}
                      className="rounded border-[rgba(195,201,181,0.15)]" />
                    Night Support
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={hasRestrictivePracticeFlag} onChange={e => setHasRestrictivePracticeFlag(e.target.checked)}
                      className="rounded border-[rgba(195,201,181,0.15)]" />
                    Restrictive Practice
                  </label>
                </div>
              </div>

              {/* Support Ratio Override */}
              <div>
                <label className="block text-sm font-medium mb-1">Support Ratio Override</label>
                <select value={supportRatioOverride} onChange={e => setSupportRatioOverride(e.target.value)}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                  <option value="">No override</option>
                  {[['OneToOne','1:1'],['OneToTwo','1:2'],['OneToThree','1:3'],['OneToFour','1:4'],['OneToFive','1:5'],['TwoToOne','2:1'],['SharedSupport','Shared'],['Other','Other']].map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium mb-1">Booking Notes</label>
                <textarea value={bookingNotes} onChange={e => setBookingNotes(e.target.value)} rows={3}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm resize-none focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Insurance */}
              <div className="border-t border-[rgba(195,201,181,0.15)] pt-4 mt-2">
                <label className="block text-sm font-medium mb-3">Travel Insurance</label>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-[#43493a] mb-1">Status</label>
                    <select value={insuranceStatus} onChange={e => setInsuranceStatus(e.target.value)}
                      className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                      {['None', 'Pending', 'Confirmed', 'Expired', 'Cancelled'].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  {insuranceStatus !== 'None' && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#43493a] mb-1">Provider</label>
                          <input type="text" value={insuranceProvider} onChange={e => setInsuranceProvider(e.target.value)}
                            className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                            placeholder="e.g. Allianz" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#43493a] mb-1">Policy Number</label>
                          <input type="text" value={insurancePolicyNumber} onChange={e => setInsurancePolicyNumber(e.target.value)}
                            className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                            placeholder="e.g. POL-12345" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#43493a] mb-1">Coverage Start</label>
                          <input type="date" value={insuranceCoverageStart} onChange={e => setInsuranceCoverageStart(e.target.value)}
                            className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#43493a] mb-1">Coverage End</label>
                          <input type="date" value={insuranceCoverageEnd} onChange={e => setInsuranceCoverageEnd(e.target.value)}
                            className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Error */}
              {createBooking.isError && (
                <p className="text-sm text-[#ba1a1a]">Failed to create booking. Please try again.</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => { setShowAddBooking(false); resetForm() }}
                  className="px-4 py-2 rounded-2xl bg-[#f5f3ef] text-sm hover:bg-[#efeeea] transition-colors">
                  Cancel
                </button>
                <button onClick={handleCreateBooking} disabled={!selectedParticipantId || createBooking.isPending}
                  className="px-4 py-2 rounded-lg bg-[#396200] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {createBooking.isPending ? 'Adding...' : 'Add Booking'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DataTable
        data={bookings}
        keyField="id"
        emptyMessage="No bookings yet"
        sortable
        loading={bookingBulkLoading}
        selectable
        selectedRows={selectedBookingIds}
        onSelectionChange={setSelectedBookingIds}
        columns={[
          {
            key: 'participantName',
            header: 'Participant',
            className: 'font-medium',
            sortable: true,
            render: (b: BookingListDto) => b.participantName || '—',
          },
          {
            key: 'bookingStatus',
            header: 'Status',
            sortable: true,
            ...(canWrite ? { bulkEditable: {
              items: [
                { value: 'Enquiry', label: 'Enquiry' },
                { value: 'Held', label: 'Held' },
                { value: 'Confirmed', label: 'Confirmed' },
                { value: 'Waitlist', label: 'Waitlist' },
                { value: 'Cancelled', label: 'Cancelled' },
                { value: 'Completed', label: 'Completed' },
                { value: 'NoLongerAttending', label: 'No Longer Attending' },
              ],
              onBulkChange: (ids: string[], value: string) =>
                bulkPatchBookings(ids, { bookingStatus: value as BookingStatus }),
            } } : {}),
            render: (b: BookingListDto) => (
              <Dropdown
                variant="pill"
                value={b.bookingStatus}
                onChange={val => patchBooking.mutate({ id: b.id, data: { bookingStatus: val as BookingStatus } })}
                colorClass={getStatusColor(b.bookingStatus)}
                items={[
                  { value: 'Enquiry', label: 'Enquiry' },
                  { value: 'Held', label: 'Held' },
                  { value: 'Confirmed', label: 'Confirmed' },
                  { value: 'Waitlist', label: 'Waitlist' },
                  { value: 'Cancelled', label: 'Cancelled' },
                  { value: 'Completed', label: 'Completed' },
                  { value: 'NoLongerAttending', label: 'No Longer Attending' },
                ]}
                disabled={!canWrite}
              />
            ),
          },
          {
            key: 'bookingDate',
            header: 'Date',
            type: 'date',
            sortable: true,
          },
          {
            key: 'supportRatioOverride',
            header: 'Ratio',
            render: (b: BookingListDto) => (({ OneToOne: '1:1', OneToTwo: '1:2', OneToThree: '1:3', OneToFour: '1:4', OneToFive: '1:5', TwoToOne: '2:1', SharedSupport: 'Shared', Other: 'Other' } as Record<string, string>)[b.supportRatioOverride as string]) || '—',
          },
          {
            key: 'wheelchairRequired',
            header: <span className="material-symbols-outlined text-base leading-none">accessible</span>,
            type: 'boolean',
            align: 'center',
          },
          {
            key: 'highSupportRequired',
            header: 'High',
            type: 'boolean',
            align: 'center',
          },
          {
            key: 'nightSupportRequired',
            header: 'Night',
            type: 'boolean',
            align: 'center',
          },
          {
            key: 'insuranceStatus',
            header: 'Insurance',
            align: 'center',
            sortable: true,
            ...(canWrite ? { bulkEditable: {
              items: [
                { value: 'None', label: 'None' },
                { value: 'Pending', label: 'Pending' },
                { value: 'Confirmed', label: 'Confirmed' },
                { value: 'Expired', label: 'Expired' },
                { value: 'Cancelled', label: 'Cancelled' },
              ],
              onBulkChange: (ids: string[], value: string) =>
                bulkPatchBookings(ids, { insuranceStatus: value as InsuranceStatus }),
            } } : {}),
            render: (b: BookingListDto) => (
              <Dropdown
                variant="pill"
                value={b.insuranceStatus || 'None'}
                onChange={val => patchBooking.mutate({ id: b.id, data: { insuranceStatus: val as InsuranceStatus } })}
                colorClass={getStatusColor(b.insuranceStatus || 'none')}
                items={[
                  { value: 'None', label: 'None' },
                  { value: 'Pending', label: 'Pending' },
                  { value: 'Confirmed', label: 'Confirmed' },
                  { value: 'Expired', label: 'Expired' },
                  { value: 'Cancelled', label: 'Cancelled' },
                ]}
                disabled={!canWrite}
              />
            ),
          },
          {
            key: 'paymentStatus',
            header: 'Payment',
            align: 'center',
            sortable: true,
            ...(canWrite ? { bulkEditable: {
              items: PAYMENT_STATUS_ITEMS,
              onBulkChange: (ids: string[], value: string) =>
                bulkPatchBookings(ids, { paymentStatus: value as PaymentStatus }),
            } } : {}),
            render: (b: BookingListDto) => (
              <Dropdown
                variant="pill"
                value={b.paymentStatus || 'NotInvoiced'}
                onChange={val => patchBooking.mutate({ id: b.id, data: { paymentStatus: val as PaymentStatus } })}
                colorClass={PAYMENT_STATUS_COLORS[b.paymentStatus || 'NotInvoiced'] ?? 'bg-neutral-100 text-neutral-600'}
                items={PAYMENT_STATUS_ITEMS}
                disabled={isReadOnly || !canWrite}
              />
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'center',
            render: (b: BookingListDto) => (
              <div className="flex items-center justify-center gap-2">
                {b.actionRequired && <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />}
                {canWrite && (
                  <button onClick={() => openEditModal(b)} className="p-1 rounded hover:bg-[#efeeea] transition-colors" title="Edit booking">
                    <Pencil className="w-3.5 h-3.5 text-[#43493a]" />
                  </button>
                )}
                <Link to={`/participants/${b.participantId}`} className="p-1 rounded hover:bg-[#efeeea] transition-colors" title="View participant">
                  <ExternalLink className="w-3.5 h-3.5 text-[#43493a]" />
                </Link>
                {canWrite && (
                  <button onClick={() => setDeletingBooking(b)} className="p-1 rounded hover:bg-[#ffdad6]/60 transition-colors" title="Remove from trip">
                    <Trash2 className="w-3.5 h-3.5 text-[#43493a] hover:text-[#ba1a1a]" />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Staffing Summary */}
      {bookings.length > 0 && (() => {
        const ratioToStaff: Record<string, number> = { OneToOne: 1, OneToTwo: 0.5, OneToThree: 1/3, OneToFour: 0.25, OneToFive: 0.2, TwoToOne: 2, SharedSupport: 0.25 }
        const ratioLabels: Record<string, string> = { OneToOne: '1:1', OneToTwo: '1:2', OneToThree: '1:3', OneToFour: '1:4', OneToFive: '1:5', TwoToOne: '2:1', SharedSupport: 'Shared' }
        const activeBookings = bookings.filter((b: BookingListDto) => !['Cancelled', 'NoLongerAttending'].includes(b.bookingStatus))
        const rawTotal = activeBookings.reduce((sum: number, b: BookingListDto) => sum + (ratioToStaff[b.supportRatioOverride ?? ''] ?? 0), 0)
        const rounded = Math.ceil(rawTotal)
        const noRatioCount = activeBookings.filter((b: BookingListDto) => !b.supportRatioOverride || !(b.supportRatioOverride in ratioToStaff)).length
        const assigned = trip.staffAssignedCount ?? 0
        const isStaffed = assigned >= rounded
        const gap = rounded - rawTotal
        let suggestion = ''
        if (gap > 0 && gap < 1) {
          const under = Object.entries(ratioToStaff).filter(([, v]) => v <= gap + 0.01).sort(([, a], [, b]) => b - a)
          if (under.length > 0) {
            const exact = Math.abs(under[0][1] - gap) < 0.01
            suggestion = exact
              ? `Add a ${ratioLabels[under[0][0]]} participant to fill staff capacity`
              : `Capacity for up to a ${ratioLabels[under[0][0]]} participant before needing another staff`
          }
        }
        return (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#f5f3ef] rounded-2xl p-3">
              <p className="text-xs text-[#43493a]">Staff Required</p>
              <p className="text-xl font-bold mt-1">{rounded} <span className="text-sm font-normal text-[#43493a]">({rawTotal.toFixed(2)})</span></p>
              {noRatioCount > 0 && <p className="text-xs text-[#f59e0b] mt-1">{noRatioCount} participant{noRatioCount > 1 ? 's' : ''} without ratio</p>}
            </div>
            <div className={`rounded-2xl p-3 ${isStaffed ? 'bg-[#bbf37c]/30' : 'bg-[#ffdad6]/60'}`}>
              <p className="text-xs text-[#43493a]">Staff Assigned</p>
              <p className={`text-xl font-bold mt-1 ${isStaffed ? 'text-[#396200]' : 'text-[#ba1a1a]'}`}>
                {assigned}/{rounded}
              </p>
              <p className={`text-xs mt-1 ${isStaffed ? 'text-[#396200]' : 'text-[#ba1a1a]'}`}>
                {isStaffed ? 'Fully staffed' : `Need ${rounded - assigned} more`}
              </p>
            </div>
            <div className="bg-[#f5f3ef] rounded-2xl p-3">
              <p className="text-xs text-[#43493a]">Capacity</p>
              {suggestion
                ? <p className="text-sm mt-1">{suggestion}</p>
                : <p className="text-sm text-[#43493a] mt-1">{gap === 0 ? 'At exact capacity — next participant adds a staff' : 'No spare capacity'}</p>
              }
            </div>
          </div>
        )
      })()}

      {/* Edit Booking Modal */}
      {editingBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingBooking(null)}>
          <div className="bg-white rounded-2xl p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)] mx-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit Booking — {editingBooking.participantName}</h3>
              <button onClick={() => setEditingBooking(null)} className="p-1 rounded hover:bg-[#efeeea] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Booking Status */}
              <div>
                <label className="block text-sm font-medium mb-1">Booking Status</label>
                <Dropdown
                  variant="form"
                  value={editForm.bookingStatus}
                  onChange={val => setEditForm({ ...editForm, bookingStatus: val })}
                  items={[
                    { value: 'Enquiry', label: 'Enquiry' },
                    { value: 'Held', label: 'Held' },
                    { value: 'Confirmed', label: 'Confirmed' },
                    { value: 'Waitlist', label: 'Waitlist' },
                    { value: 'Cancelled', label: 'Cancelled' },
                    { value: 'Completed', label: 'Completed' },
                    { value: 'NoLongerAttending', label: 'No Longer Attending' },
                  ]}
                />
              </div>

              {/* Support Requirements */}
              <div>
                <label className="block text-sm font-medium mb-2">Support Requirements</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editForm.wheelchairRequired} onChange={e => setEditForm({ ...editForm, wheelchairRequired: e.target.checked })}
                      className="rounded border-[rgba(195,201,181,0.15)]" />
                    Wheelchair
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editForm.highSupportRequired} onChange={e => setEditForm({ ...editForm, highSupportRequired: e.target.checked })}
                      className="rounded border-[rgba(195,201,181,0.15)]" />
                    High Support
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editForm.nightSupportRequired} onChange={e => setEditForm({ ...editForm, nightSupportRequired: e.target.checked })}
                      className="rounded border-[rgba(195,201,181,0.15)]" />
                    Night Support
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editForm.hasRestrictivePracticeFlag} onChange={e => setEditForm({ ...editForm, hasRestrictivePracticeFlag: e.target.checked })}
                      className="rounded border-[rgba(195,201,181,0.15)]" />
                    Restrictive Practice
                  </label>
                </div>
              </div>

              {/* Support Ratio Override */}
              <div>
                <label className="block text-sm font-medium mb-1">Support Ratio Override</label>
                <Dropdown
                  variant="form"
                  value={editForm.supportRatioOverride}
                  onChange={val => setEditForm({ ...editForm, supportRatioOverride: val })}
                  label="No override"
                  items={[
                    { value: '', label: 'No override' },
                    { value: 'OneToOne', label: '1:1' },
                    { value: 'OneToTwo', label: '1:2' },
                    { value: 'OneToThree', label: '1:3' },
                    { value: 'OneToFour', label: '1:4' },
                    { value: 'OneToFive', label: '1:5' },
                    { value: 'TwoToOne', label: '2:1' },
                    { value: 'SharedSupport', label: 'Shared' },
                    { value: 'Other', label: 'Other' },
                  ]}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium mb-1">Booking Notes</label>
                <textarea value={editForm.bookingNotes} onChange={e => setEditForm({ ...editForm, bookingNotes: e.target.value })} rows={3}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm resize-none focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Insurance */}
              <div className="border-t border-[rgba(195,201,181,0.15)] pt-4 mt-2">
                <label className="block text-sm font-medium mb-3">Travel Insurance</label>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-[#43493a] mb-1">Status</label>
                    <Dropdown
                      variant="form"
                      value={editForm.insuranceStatus}
                      onChange={val => setEditForm({ ...editForm, insuranceStatus: val })}
                      items={[
                        { value: 'None', label: 'None' },
                        { value: 'Pending', label: 'Pending' },
                        { value: 'Confirmed', label: 'Confirmed' },
                        { value: 'Expired', label: 'Expired' },
                        { value: 'Cancelled', label: 'Cancelled' },
                      ]}
                    />
                  </div>
                  {editForm.insuranceStatus !== 'None' && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#43493a] mb-1">Provider</label>
                          <input type="text" value={editForm.insuranceProvider} onChange={e => setEditForm({ ...editForm, insuranceProvider: e.target.value })}
                            className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                            placeholder="e.g. Allianz" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#43493a] mb-1">Policy Number</label>
                          <input type="text" value={editForm.insurancePolicyNumber} onChange={e => setEditForm({ ...editForm, insurancePolicyNumber: e.target.value })}
                            className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                            placeholder="e.g. POL-12345" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#43493a] mb-1">Coverage Start</label>
                          <input type="date" value={editForm.insuranceCoverageStart} onChange={e => setEditForm({ ...editForm, insuranceCoverageStart: e.target.value })}
                            className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                        </div>
                        <div>
                          <label className="block text-xs text-[#43493a] mb-1">Coverage End</label>
                          <input type="date" value={editForm.insuranceCoverageEnd} onChange={e => setEditForm({ ...editForm, insuranceCoverageEnd: e.target.value })}
                            className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Error */}
              {updateBooking.isError && (
                <p className="text-sm text-[#ba1a1a]">Failed to update booking. Please try again.</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditingBooking(null)}
                  className="px-4 py-2 rounded-2xl bg-[#f5f3ef] text-sm hover:bg-[#efeeea] transition-colors">
                  Cancel
                </button>
                <button onClick={handleUpdateBooking} disabled={updateBooking.isPending}
                  className="px-4 py-2 rounded-lg bg-[#396200] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {updateBooking.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete/Cancel Booking Confirmation */}
      {deletingBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeletingBooking(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Remove Participant</h3>
              <button onClick={() => setDeletingBooking(null)} className="p-1 rounded hover:bg-[#efeeea] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[#43493a]">
              What would you like to do with <span className="font-medium text-[#1b1c1a]">{deletingBooking.participantName}</span>'s booking?
            </p>
            {(deleteBooking.isError || cancelBooking.isError) && (
              <p className="text-sm text-[#ba1a1a] mt-3">Something went wrong. Please try again.</p>
            )}
            <div className="flex flex-col gap-2 mt-4">
              <button
                onClick={() => {
                  const data: import('@/api/types/bookings').UpdateBookingDto = {
                    tripInstanceId: deletingBooking.tripInstanceId,
                    participantId: deletingBooking.participantId,
                    bookingStatus: 'Cancelled',
                    nightSupportRequired: deletingBooking.nightSupportRequired,
                    wheelchairRequired: deletingBooking.wheelchairRequired,
                    highSupportRequired: deletingBooking.highSupportRequired,
                    hasRestrictivePracticeFlag: deletingBooking.hasRestrictivePracticeFlag,
                    supportRatioOverride: deletingBooking.supportRatioOverride ?? undefined,
                    paymentStatus: deletingBooking.paymentStatus,
                    actionRequired: deletingBooking.actionRequired,
                    insuranceStatus: deletingBooking.insuranceStatus,
                  }
                  cancelBooking.mutate({ id: deletingBooking.id, data }, { onSuccess: () => setDeletingBooking(null) })
                }}
                disabled={cancelBooking.isPending || deleteBooking.isPending}
                className="w-full px-4 py-2 rounded-2xl bg-[#fef3c7]/60 text-sm font-medium hover:bg-[#fef3c7] transition-colors disabled:opacity-50 text-left">
                <span className="font-semibold">Cancel booking</span>
                <span className="block text-xs text-[#43493a] mt-0.5">Mark as cancelled — keeps the record for history</span>
              </button>
              <button
                onClick={() => deleteBooking.mutate(deletingBooking.id, { onSuccess: () => setDeletingBooking(null) })}
                disabled={deleteBooking.isPending || cancelBooking.isPending}
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
