import { Modal } from '@/components/Modal'
import { DataTable, type Column } from '@/components/DataTable'
import { useServiceBooking } from '@/api/hooks'
import type { ServiceBookingLineDto } from '@/api/types'
import { formatDateAu, formatCurrency } from '@/lib/utils'
import { BalanceIndicator } from './BalanceIndicator'
import { TableSkeleton } from './TableSkeleton'

export type ServiceBookingDetailModalProps = {
  bookingId: string | null
  onClose: () => void
}

export default function ServiceBookingDetailModal({ bookingId, onClose }: ServiceBookingDetailModalProps) {
  const { data: booking, isLoading } = useServiceBooking(bookingId ?? undefined)

  const lineColumns: Column<ServiceBookingLineDto>[] = [
    { key: 'supportItemNumber', header: 'Support Item', className: 'font-mono text-xs' },
    { key: 'allocatedAmount', header: 'Allocated', type: 'currency', align: 'right' },
    { key: 'claimedAmount', header: 'Claimed', type: 'currency', align: 'right' },
    {
      key: 'remainingAmount',
      header: 'Remaining',
      align: 'right',
      render: (line) => <BalanceIndicator remaining={line.remainingAmount} allocated={line.allocatedAmount} compact />,
    },
  ]

  return (
    <Modal
      open={bookingId !== null}
      onClose={onClose}
      title={booking ? `Service Booking — ${booking.prodaBookingReference}` : 'Service Booking'}
      size="lg"
    >
      {isLoading || !booking ? (
        <div className="space-y-4">
          <div className="h-16 rounded-[var(--radius-md)] bg-[var(--color-accent)] animate-pulse" />
          <TableSkeleton columns={4} rows={3} />
        </div>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 bg-[var(--color-accent)] rounded-[var(--radius-md)] p-4 text-sm">
            <div>
              <dt className="text-xs text-[var(--color-muted-foreground)]">Participant</dt>
              <dd className="font-medium">{booking.participantName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted-foreground)]">Booking Period</dt>
              <dd className="font-medium">{formatDateAu(booking.startDate)} – {formatDateAu(booking.endDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted-foreground)]">Claim Deadline</dt>
              <dd className="font-medium">{formatDateAu(booking.claimDeadline)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted-foreground)]">Total Allocated</dt>
              <dd className="font-medium">{formatCurrency(booking.totalAllocated)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted-foreground)]">Total Claimed</dt>
              <dd className="font-medium">{formatCurrency(booking.totalClaimed)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted-foreground)]">Remaining</dt>
              <dd><BalanceIndicator remaining={booking.totalRemaining} allocated={booking.totalAllocated} compact /></dd>
            </div>
          </dl>

          <div>
            <h4 className="text-sm font-semibold text-[var(--color-foreground)] mb-2">Lines</h4>
            <DataTable
              data={booking.lines}
              columns={lineColumns}
              keyField="id"
              emptyMessage="This service booking has no lines."
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
