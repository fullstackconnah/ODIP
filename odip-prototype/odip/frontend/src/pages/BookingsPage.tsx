import { useBookings, usePatchBooking } from '@/api/hooks'
import type { TruncatableList } from '@/api/hooks/pagedList'
import { Link } from 'react-router-dom'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { BudgetWarnings } from '@/components/BudgetWarnings'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { getStatusColor } from '@/lib/utils'
import { CalendarCheck } from 'lucide-react'
import { useState } from 'react'
import type { BookingStatus } from '@/api/types/enums'
import type { BookingListDto } from '@/api/types/bookings'
import { plural } from '@/lib/format'
import { bookingBudgetNote, bookingBudgetNotice, type BookingBudgetNotice } from '@/lib/bookingBudget'

// Statuses that end a participant's involvement in a trip — confirmed before applying, same
// pattern as AccommodationPage's/VehiclesPage's archive confirms.
const CONFIRM_STATUSES: BookingStatus[] = ['Cancelled', 'NoLongerAttending']

// Matches BookingsController.GetAll's own PagingParams.DefaultPageSize (backend house
// convention: default 50, ceiling 200) — kept in sync manually since paging params cross the API
// boundary as plain query strings, not a shared type.
const BOOKINGS_PAGE_SIZE = 50

export default function BookingsPage() {
  const [page, setPage] = useState(1)
  const { data: bookings = [], isLoading, isError } = useBookings({ page: String(page), pageSize: String(BOOKINGS_PAGE_SIZE) })
  // `bookings` is normally a TruncatableList (see pagedList.ts), but the `= []` default used
  // while loading is a plain array without that extra field — read it as optional, same pattern
  // as IncidentsPage/RegisterTab.
  const { totalCount = bookings.length } = bookings as Partial<TruncatableList<BookingListDto>>
  const patchBooking = usePatchBooking()
  const [confirmTarget, setConfirmTarget] = useState<{ booking: BookingListDto; status: BookingStatus } | null>(null)
  // Budget phase 3: what confirming a booking does to the participant's budget, as the server says it. A warning only; the status change has already gone through.
  const [budgetNotice, setBudgetNotice] = useState<BookingBudgetNotice | null>(null)

  if (isError) return (
    <div className="p-[var(--card-pad)] text-center text-[var(--color-destructive)]">Failed to load bookings. Please refresh the page.</div>
  )

  function handleStatusChange(booking: BookingListDto, status: BookingStatus) {
    setBudgetNotice(null)
    if (CONFIRM_STATUSES.includes(status)) {
      setConfirmTarget({ booking, status })
    } else {
      patchBooking.mutate({ id: booking.id, data: { bookingStatus: status } }, { onSuccess: response => setBudgetNotice(bookingBudgetNotice(response)) })
    }
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Bookings"
        subtitle={plural(totalCount, 'booking')}
      />

      {budgetNotice && <BudgetWarnings warnings={budgetNotice.warnings} note={bookingBudgetNote(budgetNotice)} onDismiss={() => setBudgetNotice(null)} />}

      {isLoading ? <div className="text-center py-12 text-[var(--color-muted-foreground)]">Loading...</div> : bookings.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No bookings yet"
          description="Bookings link a participant to a trip. They're created from a trip's participant list, so head to Trips to book someone onto one."
          action={{ label: 'View trips', to: '/trips' }}
        />
      ) : (
        <DataTable
          data={bookings}
          keyField="id"
          columns={[
            {
              key: 'participantName',
              header: 'Participant',
              render: (b: any) => (
                <Link to={`/participants/${b.participantId}`} className="font-medium hover:text-[var(--color-primary)]">
                  {b.participantName || '\u2014'}
                </Link>
              ),
            },
            {
              key: 'tripName',
              header: 'Trip',
              render: (b: any) => (
                <Link to={`/trips/${b.tripInstanceId}`} className="hover:text-[var(--color-primary)]">
                  {b.tripName || '\u2014'}
                </Link>
              ),
            },
            {
              key: 'bookingStatus',
              header: 'Status',
              render: (b) => (
                <Dropdown
                  variant="pill"
                  value={b.bookingStatus}
                  onChange={val => handleStatusChange(b, val as BookingStatus)}
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
                />
              ),
            },
            { key: 'bookingDate', header: 'Booking Date', type: 'date' },
            {
              key: 'wheelchairRequired',
              header: 'WC',
              type: 'boolean',
              align: 'center' as const,
            },
            { key: 'highSupportRequired', header: 'High', type: 'boolean', align: 'center' as const },
            { key: 'nightSupportRequired', header: 'Night', type: 'boolean', align: 'center' as const },
          ]}
          pagination={{
            page,
            pageSize: BOOKINGS_PAGE_SIZE,
            totalCount,
            onPageChange: setPage,
          }}
        />
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          if (!confirmTarget) return
          patchBooking.mutate(
            { id: confirmTarget.booking.id, data: { bookingStatus: confirmTarget.status } },
            { onSuccess: () => setConfirmTarget(null) }
          )
        }}
        variant="danger"
        loading={patchBooking.isPending}
        title={confirmTarget?.status === 'Cancelled' ? 'Cancel booking?' : 'Mark as no longer attending?'}
        confirmLabel={confirmTarget?.status === 'Cancelled' ? 'Cancel booking' : 'Mark as no longer attending'}
        message={
          <p>
            {confirmTarget?.status === 'Cancelled'
              ? <>Cancel <strong>{confirmTarget?.booking.participantName || 'this participant'}</strong>'s booking on <strong>{confirmTarget?.booking.tripName || 'this trip'}</strong>?</>
              : <>Mark <strong>{confirmTarget?.booking.participantName || 'this participant'}</strong> as no longer attending <strong>{confirmTarget?.booking.tripName || 'this trip'}</strong>?</>}
            {' '}This cannot be undone.
          </p>
        }
      />
    </div>
  )
}
