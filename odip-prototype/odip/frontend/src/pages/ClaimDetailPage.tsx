import { useParams, Link } from 'react-router-dom'
import { useClaim, useUpdateClaim, useUpdateClaimLineItem } from '@/api/hooks'
import type { TripClaimStatus, ClaimLineItemDto } from '@/api/types'
import { Download, Check, DollarSign, XCircle } from 'lucide-react'
import { useState } from 'react'
import { apiClient } from '@/api/client'
import { NoShowModal } from '@/components/NoShowModal'
import { DataTable } from '@/components/DataTable'
import { formatCurrency } from '@/lib/utils'
import { StatusBadge } from '@/components/StatusBadge'

const inputClass = 'w-full px-3 py-2 rounded-2xl bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)]/30 transition-all'


function planTypeLabel(planType: string) {
  switch (planType) {
    case 'NdiaManaged': return 'NDIA Managed'
    case 'PlanManaged': return 'Plan Managed'
    case 'SelfManaged': return 'Self Managed'
    default: return planType
  }
}

async function downloadFile(url: string, filename: string) {
  const response = await apiClient.get(url, { responseType: 'blob' })
  const blob = new Blob([response.data])
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: claim, isLoading } = useClaim(id)
  const updateClaim = useUpdateClaim()
  const updateLineItem = useUpdateClaimLineItem()
  const [noShowTarget, setNoShowTarget] = useState<ClaimLineItemDto | null>(null)
  const [notes, setNotes] = useState('')
  const [notesInit, setNotesInit] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!notesInit && claim) {
    setNotes(claim.notes || '')
    setNotesInit(true)
  }

  if (isLoading) return <div className="p-8 text-[var(--color-muted-foreground)]">Loading...</div>
  if (!claim) return <div className="p-8 text-[var(--color-muted-foreground)]">Claim not found</div>

  const totalAmount = (claim.lineItems ?? []).reduce((sum: number, l: ClaimLineItemDto) => sum + (l.totalAmount ?? 0), 0)

  function handleSaveNotes() {
    if (!id) return
    updateClaim.mutate({ claimId: id, data: { notes } }, {
      onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }
    })
  }

  function handleStatusChange(status: string) {
    if (!id) return
    updateClaim.mutate({ claimId: id, data: { status: status as TripClaimStatus } })
  }

  function handleRevertToConfirmed(item: ClaimLineItemDto) {
    if (!id) return
    updateLineItem.mutate({ claimId: id, itemId: item.id, data: { claimType: 'Standard' } })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        <Link to="/trips" className="hover:text-[var(--color-primary)]">Trips</Link>
        <span>/</span>
        {claim.tripInstanceId && (
          <>
            <Link to={`/trips/${claim.tripInstanceId}`} className="hover:text-[var(--color-primary)]">{claim.tripName || 'Trip'}</Link>
            <span>/</span>
          </>
        )}
        <span className="font-medium">Claim {claim.claimReference}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Claim {claim.claimReference}</h1>
          <StatusBadge status={claim.status} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadFile(`/claims/${id}/bpr-csv`, `${claim.claimReference}-bpr.csv`)}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-[#c3c9b6] text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface-container-low)] transition-all"
          >
            <Download className="w-4 h-4" />
            BPR CSV
          </button>
          {claim.status === 'Draft' && (
            <button
              onClick={() => handleStatusChange('Submitted')}
              disabled={updateClaim.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[#294800] transition-all disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              Mark as Submitted
            </button>
          )}
          {claim.status === 'Submitted' && (
            <>
              <button
                onClick={() => handleStatusChange('Paid')}
                disabled={updateClaim.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[#294800] transition-all disabled:opacity-50"
              >
                <DollarSign className="w-4 h-4" />
                Mark as Paid
              </button>
              <button
                onClick={() => handleStatusChange('Rejected')}
                disabled={updateClaim.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-all disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                Mark as Rejected
              </button>
            </>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Amount', value: `$${totalAmount.toFixed(2)}` },
          { label: 'Trip', value: claim.tripName || '—' },
          { label: 'Created', value: claim.createdAt ? new Date(claim.createdAt).toLocaleDateString('en-AU') : '—' },
          { label: 'Submitted', value: claim.submittedDate ? new Date(claim.submittedDate).toLocaleDateString('en-AU') : '—' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-2xl p-4">
            <p className="text-xs text-[var(--color-muted-foreground)] font-medium mb-1">{card.label}</p>
            <p className="text-lg font-semibold text-[var(--color-foreground)]">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Notes */}
      <div className="bg-white rounded-2xl p-4 space-y-2">
        <label className="block text-xs font-medium text-[var(--color-muted-foreground)]">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Add claim notes..."
          className={inputClass + ' resize-none'}
        />
        <div className="flex justify-end">
          <button
            onClick={handleSaveNotes}
            disabled={updateClaim.isPending}
            className="px-4 py-1.5 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[#294800] transition-all disabled:opacity-50"
          >
            {saved ? 'Saved!' : 'Save Notes'}
          </button>
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-2xl overflow-hidden">
        <div className="px-4 py-3 bg-[var(--color-surface-container-low)] flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[var(--color-muted-foreground)]">Line Items</h2>
          <span className="text-xs text-[var(--color-muted-foreground)]">{(claim.lineItems ?? []).length} items</span>
        </div>
        <DataTable
          data={claim.lineItems ?? []}
          keyField="id"
          sortable
          columns={[
            {
              key: 'participantName',
              header: 'Participant',
              sortable: true,
              render: (item: ClaimLineItemDto) => (
                <div>
                  <p className="font-medium text-[var(--color-foreground)]">{item.participantName}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)] font-mono">{item.ndisNumber}</p>
                  <StatusBadge status={item.planType} label={planTypeLabel(item.planType)} />
                </div>
              ),
            },
            {
              key: 'supportItemCode',
              header: 'Support Item',
              sortable: true,
              className: 'font-mono text-xs text-[var(--color-muted-foreground)]',
            },
            {
              key: 'dayType',
              header: 'Day Type',
              sortable: true,
              render: (item: ClaimLineItemDto) => (
                <span className="text-[var(--color-muted-foreground)]">{item.dayType}</span>
              ),
            },
            {
              key: 'supportsDeliveredFrom',
              header: 'Dates',
              sortable: true,
              render: (item: ClaimLineItemDto) => (
                <span className="text-xs text-[var(--color-muted-foreground)] whitespace-nowrap">
                  {item.supportsDeliveredFrom} – {item.supportsDeliveredTo}
                </span>
              ),
            },
            {
              key: 'hours',
              header: 'Hours',
              align: 'right' as const,
              render: (item: ClaimLineItemDto) => (
                <span className="text-[var(--color-muted-foreground)]">{item.hours}h</span>
              ),
            },
            {
              key: 'unitPrice',
              header: 'Unit Price',
              type: 'currency' as const,
              align: 'right' as const,
            },
            {
              key: 'totalAmount',
              header: 'Total',
              type: 'currency' as const,
              align: 'right' as const,
              sortable: true,
              className: 'font-medium',
            },
            {
              key: 'status',
              header: 'Status',
              render: (item: ClaimLineItemDto) => (
                <StatusBadge status={item.status} />
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (item: ClaimLineItemDto) => (
                <div className="flex flex-col gap-1.5 items-start">
                  {item.claimType === 'Cancellation' ? (
                    <div className="flex flex-col gap-1 items-start">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium whitespace-nowrap">
                        No Show · {item.cancellationReason}
                      </span>
                      <button
                        onClick={() => handleRevertToConfirmed(item as ClaimLineItemDto)}
                        disabled={updateLineItem.isPending}
                        className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] hover:underline disabled:opacity-50"
                      >
                        Mark Confirmed
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setNoShowTarget(item as ClaimLineItemDto)}
                      className="text-xs text-[var(--color-muted-foreground)] hover:text-amber-600 hover:underline"
                    >
                      No Show
                    </button>
                  )}
                  {(item.planType === 'PlanManaged' || item.planType === 'SelfManaged') && (
                    <button
                      onClick={() => downloadFile(`/claims/${id}/invoices/${item.participantBookingId}`, `invoice-${item.participantName.replace(/\s+/g, '-')}.pdf`)}
                      className="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
                    >
                      <Download className="w-3 h-3" />
                      Invoice
                    </button>
                  )}
                </div>
              ),
            },
          ]}
          footer={
            <tr>
              <td colSpan={6} className="p-3 text-right font-semibold text-[var(--color-foreground)]">Total</td>
              <td className="p-3 font-bold text-[var(--color-foreground)]">{formatCurrency(totalAmount)}</td>
              <td colSpan={2} />
            </tr>
          }
          className="overflow-x-auto"
        />
      </div>
      {noShowTarget && id && (
        <NoShowModal
          claimId={id}
          lineItem={noShowTarget}
          onClose={() => setNoShowTarget(null)}
          onSuccess={() => setNoShowTarget(null)}
        />
      )}
    </div>
  )
}
