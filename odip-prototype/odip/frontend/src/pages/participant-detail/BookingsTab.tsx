import { Link } from 'react-router-dom'
import { useParticipantBookings } from '@/api/hooks'
import { DataTable } from '@/components/DataTable'
import { PageState } from '@/components/PageState'
import { queryPhase } from '@/lib/queryPhase'
import type { BookingListDto } from '@/api/types/bookings'

/** A table-cell link is the row's tap target: no height change on a mouse (--tap-min is 0 there), a
 * 44px floor under a coarse pointer (fits the 48px coarse row). */
const ROW_LINK = 'inline-flex min-h-[var(--tap-min)] items-center font-medium hover:text-[var(--color-primary)]'

export default function BookingsTab({ participantId }: { participantId: string | undefined }) {
  const bookingsQuery = useParticipantBookings(participantId)
  // A failed or paused request is not an empty list: "No bookings" is only for one that succeeded and came back empty.
  const phase = queryPhase(bookingsQuery)
  if (phase === 'loading') return <PageState kind="loading" noun="booking list" />
  if (phase === 'error') return <PageState kind="error" noun="booking list" onRetry={() => bookingsQuery.refetch()} />

  return (
    <DataTable
      data={bookingsQuery.data ?? []}
      keyField="id"
      columns={[
        {
          key: 'tripName',
          header: 'Trip',
          render: (b: BookingListDto) => (
            <Link to={`/trips/${b.tripInstanceId}`} className={ROW_LINK}>
              {b.tripName || 'Trip'}
            </Link>
          ),
        },
        { key: 'bookingStatus', header: 'Status', type: 'badge' },
        { key: 'bookingDate', header: 'Date', type: 'date' },
      ]}
      emptyMessage="No bookings"
    />
  )
}
