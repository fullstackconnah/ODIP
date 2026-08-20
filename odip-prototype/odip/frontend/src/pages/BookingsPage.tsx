import { useBookings, usePatchBooking } from '@/api/hooks'
import { Link } from 'react-router-dom'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { getStatusColor } from '@/lib/utils'
import { CalendarCheck } from 'lucide-react'
import type { BookingStatus } from '@/api/types/enums'

export default function BookingsPage() {
  const { data: bookings = [], isLoading, isError } = useBookings()
  const patchBooking = usePatchBooking()

  if (isError) return (
    <div className="p-8 text-center text-red-600">Failed to load bookings. Please refresh the page.</div>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Bookings"
        subtitle={`${bookings.length} booking${bookings.length !== 1 ? 's' : ''}`}
      />

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
          sortable
          columns={[
            {
              key: 'participantName',
              header: 'Participant',
              sortable: true,
              render: (b: any) => (
                <Link to={`/participants/${b.participantId}`} className="font-medium hover:text-[var(--color-primary)]">
                  {b.participantName || '\u2014'}
                </Link>
              ),
            },
            {
              key: 'tripName',
              header: 'Trip',
              sortable: true,
              render: (b: any) => (
                <Link to={`/trips/${b.tripInstanceId}`} className="hover:text-[var(--color-primary)]">
                  {b.tripName || '\u2014'}
                </Link>
              ),
            },
            {
              key: 'bookingStatus',
              header: 'Status',
              sortable: true,
              render: (b) => (
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
                />
              ),
            },
            { key: 'bookingDate', header: 'Booking Date', type: 'date', sortable: true },
            {
              key: 'wheelchairRequired',
              header: <span className="material-symbols-outlined text-base leading-none">accessible</span>,
              type: 'boolean',
              align: 'center' as const,
            },
            { key: 'highSupportRequired', header: 'High', type: 'boolean', align: 'center' as const },
            { key: 'nightSupportRequired', header: 'Night', type: 'boolean', align: 'center' as const },
          ]}
        />
      )}
    </div>
  )
}
