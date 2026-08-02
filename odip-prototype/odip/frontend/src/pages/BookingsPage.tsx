import { useBookings } from '@/api/hooks'
import { Link } from 'react-router-dom'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'

export default function BookingsPage() {
  const { data: bookings = [], isLoading, isError } = useBookings()

  if (isError) return (
    <div className="p-8 text-center text-red-600">Failed to load bookings. Please refresh the page.</div>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Bookings"
        subtitle={`${bookings.length} booking${bookings.length !== 1 ? 's' : ''}`}
      />

      {isLoading ? <div className="text-center py-12 text-[var(--color-muted-foreground)]">Loading...</div> : (
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
            { key: 'bookingStatus', header: 'Status', type: 'badge', sortable: true },
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
