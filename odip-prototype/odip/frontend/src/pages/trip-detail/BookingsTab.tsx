import { useState, useEffect } from 'react'
import { useCreateBooking, usePatchBooking, useDeleteBooking, useCancelBooking, useDownloadClientOverviewPdf, PAYMENT_STATUS_ITEMS } from '@/api/hooks'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { DataTable } from '@/components/DataTable'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ReadinessNote } from '@/components/ReadinessNote'
import { BudgetWarnings } from '@/components/BudgetWarnings'
import { bookingBudgetNote, bookingBudgetNotice, mergeBookingBudgetNotices, type BookingBudgetNotice } from '@/lib/bookingBudget'
import { getStatusColor, extractErrorMessage } from '@/lib/utils'
import { formatRatio, plural } from '@/lib/format'
import { BOOKING_STATUSES, INSURANCE_STATUSES, type BookingStatus, type InsuranceStatus, type PaymentStatus, type SupportRatio, SUPPORT_RATIO_LABELS } from '@/api/types/enums'
import { BOOKING_STATUS_LABELS, statusItems } from '@/lib/tone'
import { Plus, AlertTriangle, Pencil, ExternalLink, Trash2, Download, Loader2 } from 'lucide-react'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'
import type { ParticipantListDto } from '@/api/types/participants'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { EditBookingModal } from './EditBookingModal'
import { Callout } from '@/components/Callout'
import { FormField } from '@/components/FormField'
import { modalGrid } from '@/lib/formGrid'

// Create-form subset of BOOKING_STATUSES — Cancelled/Completed/NoLongerAttending are reached via
// dedicated actions elsewhere, not offered when first adding a participant to a trip.
const NEW_BOOKING_STATUS_ITEMS: DropdownItem[] = ['Enquiry', 'Held', 'Confirmed', 'Waitlist'].map(s => ({ value: s, label: s }))

const SUPPORT_RATIO_ITEMS: DropdownItem[] = (['OneToOne', 'OneToTwo', 'OneToThree', 'OneToFour', 'OneToFive', 'TwoToOne', 'SharedSupport', 'Other'] as SupportRatio[])
  .map(v => ({ value: v, label: SUPPORT_RATIO_LABELS[v] }))

const INSURANCE_STATUS_ITEMS: DropdownItem[] = INSURANCE_STATUSES.map(s => ({ value: s, label: s }))

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
  const [deletingBooking, setDeletingBooking] = useState<BookingListDto | null>(null)
  const [selectedBookingIds, setSelectedBookingIds] = useState<Set<string>>(new Set())
  const [bookingBulkLoading, setBookingBulkLoading] = useState(false)
  // Budget phase 3: what confirming a booking does to the participant's budget, as the server says it. A warning only; the booking is already confirmed.
  const [budgetNotice, setBudgetNotice] = useState<BookingBudgetNotice | null>(null)
  // `what` completes "Couldn't update …": one participant's booking, or a count after a bulk change. `ids` are the refused rows:
  // only a later success on one of them clears it, so another row's success never hides this refusal.
  const [patchError, setPatchError] = useState<{ ids: string[]; what: string; message: string } | null>(null)
  const clearPatchErrorFor = (ids: string[]) => setPatchError(e => (e && e.ids.every(id => ids.includes(id)) ? null : e))

  const createBooking = useCreateBooking()
  const patchBooking = usePatchBooking()
  const deleteBooking = useDeleteBooking()
  const cancelBooking = useCancelBooking()
  // PF-10.6 — primary Client Overview PDF surface: the trip context gives the header its
  // Trip/Date/Group fields, which the Participant-detail button cannot provide. One mutation
  // instance shared across every row; `downloadingBookingId` tracks which row's button should
  // show the pending/spinner state so a click on one row doesn't spin every row's button.
  const downloadClientOverview = useDownloadClientOverviewPdf()
  const [downloadingBookingId, setDownloadingBookingId] = useState<string | null>(null)

  // One row's pill change; a refusal shows above the roster until the next change goes through. Each call reads its own
  // promise: TanStack keeps only the latest mutate() call's callbacks, so a second row changing would drop the first one's answer.
  const patchRow = (b: BookingListDto, data: Partial<{ bookingStatus: BookingStatus; insuranceStatus: InsuranceStatus; paymentStatus: PaymentStatus }>, onSuccess?: (response: Parameters<typeof bookingBudgetNotice>[0]) => void) =>
    patchBooking.mutateAsync({ id: b.id, data }).then(
      response => { clearPatchErrorFor([b.id]); onSuccess?.(response) },
      err => setPatchError({ ids: [b.id], what: `${b.participantName || 'this participant'}'s booking`, message: extractErrorMessage(err, 'Please try again.') }),
    )

  const handleDownloadClientOverview = (b: BookingListDto) => {
    setDownloadingBookingId(b.id)
    downloadClientOverview.mutate(
      { id: b.participantId, tripId, fileName: `${b.participantName || 'Participant'} - Client Overview.pdf` },
      { onSettled: () => setDownloadingBookingId(null) },
    )
  }

  // Filter out participants already booked on this trip
  const bookedParticipantIds = new Set(bookings.map((b: BookingListDto) => b.participantId))
  const availableParticipants = participants.filter((p: ParticipantListDto) => !bookedParticipantIds.has(p.id) && p.isActive)
  // What is still missing for the picked participant: shown as a quiet line, never read by the Add Booking button.
  const selectedParticipantIssues = participants.find((p: ParticipantListDto) => p.id === selectedParticipantId)?.readinessIssues

  // Auto-populate support fields when participant changes
  useEffect(() => {
    if (!selectedParticipantId) return
    const p = participants.find((p: ParticipantListDto) => p.id === selectedParticipantId)
    if (p) {
      setWheelchairRequired(p.mobilityAidWheelchair ?? false)
      setHighSupportRequired(p.isHighSupport ?? false)
      setNightSupportRequired(p.overnightSupport != null && p.overnightSupport !== 'None')
      setHasRestrictivePracticeFlag(p.hasRestrictivePracticeFlag ?? false)
      setSupportRatioOverride(p.supportRatio ?? '')
    }
  }, [selectedParticipantId, participants])

  async function bulkPatchBookings(
    ids: string[],
    patch: Partial<{ bookingStatus: BookingStatus; insuranceStatus: InsuranceStatus; paymentStatus: PaymentStatus }>
  ) {
    setBookingBulkLoading(true)
    setBudgetNotice(null)
    const results = await Promise.allSettled(ids.map(id => patchBooking.mutateAsync({ id, data: patch })))
    const refusedIds = ids.filter((_, i) => results[i].status === 'rejected')
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    setBudgetNotice(mergeBookingBudgetNotices(results.map(r => (r.status === 'fulfilled' ? bookingBudgetNotice(r.value) : null))))
    if (refused.length) setPatchError({ ids: refusedIds, what: plural(refused.length, 'booking'), message: extractErrorMessage(refused[0].reason, 'Please try again.') })
    else clearPatchErrorFor(ids)
    setSelectedBookingIds(new Set())
    setBookingBulkLoading(false)
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
      onSuccess: response => {
        setShowAddBooking(false)
        resetForm()
        setBudgetNotice(bookingBudgetNotice(response))
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {bookings.length}{trip.maxParticipants ? `/${trip.maxParticipants}` : ''} spots filled
        </p>
        {canWrite && (
          <Button onClick={() => setShowAddBooking(true)}>
            <Plus className="w-4 h-4" /> Add Participant
          </Button>
        )}
      </div>

      {patchError && (
        <Callout tone="error">
          <strong>Couldn't update {patchError.what}.</strong> {patchError.message}
        </Callout>
      )}

      {budgetNotice && <BudgetWarnings warnings={budgetNotice.warnings} note={bookingBudgetNote(budgetNotice)} onDismiss={() => setBudgetNotice(null)} />}

      {/* Add Booking Modal */}
      {showAddBooking && (
        <Modal
          stickyFooter
          open
          onClose={() => { setShowAddBooking(false); resetForm() }}
          title="Add Participant to Trip"
          footer={
            <>
              <Button variant="secondary" onClick={() => { setShowAddBooking(false); resetForm() }}>
                Cancel
              </Button>
              <Button onClick={handleCreateBooking} disabled={!selectedParticipantId || createBooking.isPending}>
                {createBooking.isPending ? 'Adding...' : 'Add Booking'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Participant Select */}
            <div>
              <label id="addBookingParticipantLabel" className="block text-sm font-medium mb-1">Participant *</label>
              <SearchableSelect
                aria-labelledby="addBookingParticipantLabel"
                value={selectedParticipantId}
                onChange={setSelectedParticipantId}
                placeholder="Select a participant..."
                items={availableParticipants.map((p: ParticipantListDto) => ({ value: p.id, label: p.fullName }))}
              />
              {availableParticipants.length === 0 && (
                <p className="text-xs text-[var(--color-muted-foreground)] mt-1">All active participants are already booked on this trip.</p>
              )}
              <ReadinessNote issues={selectedParticipantIssues} className="mt-1.5" />
            </div>

            {/* Booking Status */}
            <FormField label="Booking Status"><Dropdown
                variant="form"
                value={bookingStatus}
                onChange={setBookingStatus}
                items={NEW_BOOKING_STATUS_ITEMS}
              /></FormField>

            {/* Support Overrides */}
            <div>
              <p className="block text-sm font-medium mb-2">Support Requirements</p>
              <div className={modalGrid}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={wheelchairRequired} onChange={e => setWheelchairRequired(e.target.checked)}
                    className="rounded border-[var(--color-border)]" />
                  Wheelchair
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={highSupportRequired} onChange={e => setHighSupportRequired(e.target.checked)}
                    className="rounded border-[var(--color-border)]" />
                  High Support
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={nightSupportRequired} onChange={e => setNightSupportRequired(e.target.checked)}
                    className="rounded border-[var(--color-border)]" />
                  Night Support
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={hasRestrictivePracticeFlag} onChange={e => setHasRestrictivePracticeFlag(e.target.checked)}
                    className="rounded border-[var(--color-border)]" />
                  Restrictive Practice
                </label>
              </div>
            </div>

            {/* Support Ratio Override */}
            <FormField label="Support Ratio Override"><Dropdown
                variant="form"
                label="No override"
                value={supportRatioOverride}
                onChange={setSupportRatioOverride}
                items={SUPPORT_RATIO_ITEMS}
              /></FormField>

            {/* Notes */}
            <FormField label="Booking Notes"><textarea value={bookingNotes} onChange={e => setBookingNotes(e.target.value)} rows={3} className="resize-none"
                placeholder="Optional notes..." /></FormField>

            {/* Insurance */}
            <div className="border-t border-[var(--color-border)]/15 pt-4 mt-2">
              <p className="block text-sm font-medium mb-3">Travel Insurance</p>
              <div className="space-y-3">
                <FormField label="Status"><Dropdown
                    variant="form"
                    value={insuranceStatus}
                    onChange={setInsuranceStatus}
                    items={INSURANCE_STATUS_ITEMS}
                  /></FormField>
                {insuranceStatus !== 'None' && (
                  <>
                    <div className={modalGrid}>
                      <FormField label="Provider"><input type="text" value={insuranceProvider} onChange={e => setInsuranceProvider(e.target.value)}
                          placeholder="e.g. Allianz" /></FormField>
                      <FormField label="Policy Number"><input type="text" value={insurancePolicyNumber} onChange={e => setInsurancePolicyNumber(e.target.value)}
                          placeholder="e.g. POL-12345" /></FormField>
                    </div>
                    <div className={modalGrid}>
                      <FormField label="Coverage Start"><input type="date" value={insuranceCoverageStart} onChange={e => setInsuranceCoverageStart(e.target.value)} /></FormField>
                      <FormField label="Coverage End"><input type="date" value={insuranceCoverageEnd} onChange={e => setInsuranceCoverageEnd(e.target.value)} /></FormField>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Error */}
            {createBooking.isError && (
              // The server's own words when it sent any (e.g. Enforce mode's "Participant is not ready for booking or rostering."),
              // the generic line only when it did not. The form above stays as the user left it.
              <p role="alert" className="text-sm text-[var(--color-destructive)]">
                {extractErrorMessage(createBooking.error, 'Failed to create booking. Please try again.')}
              </p>
            )}
          </div>
        </Modal>
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
              items: statusItems(BOOKING_STATUSES, BOOKING_STATUS_LABELS),
              onBulkChange: (ids: string[], value: string) =>
                bulkPatchBookings(ids, { bookingStatus: value as BookingStatus }),
            } } : {}),
            render: (b: BookingListDto) => (
              <Dropdown
                variant="pill"
                value={b.bookingStatus}
                onChange={val => {
                  setBudgetNotice(null)
                  patchRow(b, { bookingStatus: val as BookingStatus }, response => setBudgetNotice(bookingBudgetNotice(response)))
                }}
                colorClass={getStatusColor(b.bookingStatus)}
                items={statusItems(BOOKING_STATUSES, BOOKING_STATUS_LABELS)}
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
                onChange={val => patchRow(b, { insuranceStatus: val as InsuranceStatus })}
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
                onChange={val => patchRow(b, { paymentStatus: val as PaymentStatus })}
                colorClass={getStatusColor(b.paymentStatus || 'NotInvoiced')}
                items={PAYMENT_STATUS_ITEMS}
                disabled={isReadOnly || !canWrite}
              />
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'center',
            render: (b: BookingListDto) => {
              // Every row has the same four, so each name says whose booking it acts on.
              const who = b.participantName || 'this participant'
              return (
                <div className="flex items-center justify-center gap-2">
                  {b.actionRequired && <AlertTriangle className="w-4 h-4 text-[var(--color-warning)]" />}
                  {canWrite && (
                    <Button variant="ghost" size="sm" iconOnly onClick={() => setEditingBooking(b)} title="Edit booking" aria-label={`Edit booking: ${who}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    onClick={() => handleDownloadClientOverview(b)}
                    disabled={downloadingBookingId === b.id}
                    title="Client Overview PDF"
                    aria-label={`Client Overview PDF: ${who}`}
                  >
                    {downloadingBookingId === b.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Download className="w-3.5 h-3.5" />}
                  </Button>
                  <Button variant="ghost" size="sm" iconOnly to={`/participants/${b.participantId}`} title="View participant" aria-label={`View participant: ${who}`}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                  {canWrite && (
                    <Button variant="ghost-danger" size="sm" iconOnly onClick={() => setDeletingBooking(b)} title="Remove from trip" aria-label={`Remove from trip: ${who}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )
            },
          },
        ]}
      />

      {/* Staffing Summary */}
      {bookings.length > 0 && (() => {
        // How many staff the trip needs is the server's figure (trip.calculatedStaffRequired); this table only sizes the Capacity hint.
        const ratioToStaff: Record<string, number> = { OneToOne: 1, OneToTwo: 0.5, OneToThree: 1/3, OneToFour: 0.25, OneToFive: 0.2, TwoToOne: 2, SharedSupport: 0.25 }
        const ratioLabels: Record<string, string> = { OneToOne: '1:1', OneToTwo: '1:2', OneToThree: '1:3', OneToFour: '1:4', OneToFive: '1:5', TwoToOne: '2:1', SharedSupport: 'Shared' }
        const activeBookings = bookings.filter((b: BookingListDto) => !['Cancelled', 'NoLongerAttending'].includes(b.bookingStatus))
        const rawTotal = trip.calculatedStaffRequired
        const rounded = trip.staffRequired ?? 0
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
            <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-3">
              <p className="text-xs text-[var(--color-muted-foreground)]">Staff Required</p>
              <p className="text-xl font-bold mt-1">{trip.staffRequired ?? '?'} <span className="text-sm font-normal text-[var(--color-muted-foreground)]">({rawTotal.toFixed(2)})</span></p>
              {noRatioCount > 0 && <p className="text-xs text-[var(--color-warning)] mt-1">{plural(noRatioCount, 'participant')} without ratio</p>}
            </div>
            <div className={`rounded-[var(--radius-md)] p-3 ${isStaffed ? 'bg-[var(--color-primary-fixed)]/30' : 'bg-[var(--color-error-container)]/60'}`}>
              <p className="text-xs text-[var(--color-muted-foreground)]">Staff Assigned</p>
              <p className={`text-xl font-bold mt-1 ${isStaffed ? 'text-[var(--color-success)]' : 'text-[var(--color-destructive)]'}`}>
                {formatRatio(assigned, trip.staffRequired ?? '?')}
              </p>
              <p className={`text-xs mt-1 ${isStaffed ? 'text-[var(--color-success)]' : 'text-[var(--color-destructive)]'}`}>
                {isStaffed ? 'Fully staffed' : `Need ${rounded - assigned} more`}
              </p>
            </div>
            <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-3">
              <p className="text-xs text-[var(--color-muted-foreground)]">Capacity</p>
              {suggestion
                ? <p className="text-sm mt-1">{suggestion}</p>
                : <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{gap === 0 ? 'At exact capacity — next participant adds a staff' : 'No spare capacity'}</p>
              }
            </div>
          </div>
        )
      })()}

      {/* Edit Booking Modal */}
      {editingBooking && (
        <EditBookingModal
          booking={editingBooking}
          onClose={() => setEditingBooking(null)}
          onSaved={response => {
            setEditingBooking(null)
            setBudgetNotice(bookingBudgetNotice(response))
          }}
        />
      )}

      {/* Delete/Cancel Booking Confirmation */}
      <ConfirmDialog
        open={deletingBooking !== null}
        onCancel={() => setDeletingBooking(null)}
        title="Remove Participant"
        message={
          <>
            <p>
              What would you like to do with <span className="font-medium text-[var(--color-foreground)]">{deletingBooking?.participantName}</span>'s booking?
            </p>
            {(deleteBooking.isError || cancelBooking.isError) && (
              <p className="text-[var(--color-destructive)]">Something went wrong. Please try again.</p>
            )}
          </>
        }
        footer={
          <div className="flex flex-col gap-2 w-full">
            <button
              onClick={() => {
                if (!deletingBooking) return
                cancelBooking.mutate(deletingBooking.id, { onSuccess: () => setDeletingBooking(null) })
              }}
              disabled={cancelBooking.isPending || deleteBooking.isPending}
              className="w-full px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-warning-container)]/60 text-sm font-medium hover:bg-[var(--color-warning-container)] transition-colors disabled:opacity-50 text-left">
              <span className="font-semibold">Cancel booking</span>
              <span className="block text-xs text-[var(--color-muted-foreground)] mt-0.5">Mark as cancelled — keeps the record for history</span>
            </button>
            <button
              onClick={() => deletingBooking && deleteBooking.mutate(deletingBooking.id, { onSuccess: () => setDeletingBooking(null) })}
              disabled={deleteBooking.isPending || cancelBooking.isPending}
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
