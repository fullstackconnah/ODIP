import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDeleteClaim, useUpdateClaim } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { DataTable } from '@/components/DataTable'
import GenerateClaimModal from '@/components/GenerateClaimModal'
import type { TripClaimStatus } from '@/api/types/enums'
import type { TripClaimListDto } from '@/api/types/claims'
import type { TripDetailDto } from '@/api/types/trips'

const CLAIM_STATUS_ITEMS = [
  { value: 'Draft', label: 'Draft' },
  { value: 'Submitted', label: 'Submitted' },
  { value: 'Paid', label: 'Paid' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'PartiallyPaid', label: 'Partially Paid' },
]

const CLAIM_STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  Submitted: 'bg-blue-100 text-blue-700',
  Paid: 'bg-[#bff285] text-[#294800]',
  Rejected: 'bg-red-100 text-red-700',
  PartiallyPaid: 'bg-amber-100 text-amber-700',
}

export default function ClaimsTab({ tripId, claims, trip, canWrite }: { tripId: string; claims: TripClaimListDto[]; trip: TripDetailDto; canWrite: boolean }) {
  const deleteClaim = useDeleteClaim()
  const updateClaim = useUpdateClaim()
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)

  async function bulkUpdateClaimStatus(ids: string[], status: string) {
    setBulkLoading(true)
    try {
      await Promise.all(
        ids.map(
          id =>
            new Promise<void>((resolve, reject) => {
              updateClaim.mutate(
                { claimId: id, data: { status: status as TripClaimStatus } },
                { onSuccess: () => resolve(), onError: err => reject(err) }
              )
            })
        )
      )
      setSelectedClaimIds(new Set())
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { errors?: string[]; message?: string } } }
      setError(
        axiosErr?.response?.data?.errors?.[0] ??
        axiosErr?.response?.data?.message ??
        'Failed to update claims.'
      )
    } finally {
      setBulkLoading(false)
    }
  }

  function handleDelete(claimId: string) {
    if (!confirm('Delete this claim? This cannot be undone.')) return
    deleteClaim.mutate(claimId, {
      onError: (err: unknown) => {
        const axiosErr = err as { response?: { data?: { errors?: string[]; message?: string } } }
        setError(axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || 'Failed to delete claim.')
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[#1b1c1a]">NDIS Claims</h2>
        {canWrite && (
          <button
            onClick={() => setShowGenerateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#396200] text-white text-sm font-medium hover:bg-[#294800] transition-all"
          >
            + Generate Claim
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <span className="mt-0.5">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {claims.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center text-[#43493a]">
          No claims yet. Generate a claim once the trip is complete.
        </div>
      ) : (
        <DataTable
          data={claims}
          keyField="id"
          sortable
          loading={bulkLoading}
          selectable
          selectedRows={selectedClaimIds}
          onSelectionChange={setSelectedClaimIds}
          emptyMessage="No claims yet"
          columns={[
            { key: 'claimReference', header: 'Reference', sortable: true, className: 'font-medium font-mono text-sm' },
            {
              key: 'status',
              header: 'Status',
              sortable: true,
              ...(canWrite ? { bulkEditable: {
                items: CLAIM_STATUS_ITEMS,
                onBulkChange: (ids: string[], value: string) => bulkUpdateClaimStatus(ids, value),
              } } : {}),
              render: (c: TripClaimListDto) => (
                <Dropdown
                  variant="pill"
                  value={c.status}
                  onChange={val => updateClaim.mutate({ claimId: c.id, data: { status: val as TripClaimStatus } })}
                  colorClass={CLAIM_STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-600'}
                  items={CLAIM_STATUS_ITEMS}
                  disabled={!canWrite}
                />
              ),
            },
            { key: 'totalAmount', header: 'Total Amount', type: 'currency', sortable: true },
            { key: 'createdAt', header: 'Created', type: 'date', sortable: true },
            { key: 'submittedDate', header: 'Submitted', type: 'date', sortable: true },
            {
              key: 'actions',
              header: '',
              render: (c: TripClaimListDto) => (
                <div className="flex items-center gap-3">
                  <Link to={`/claims/${c.id}`} className="text-xs text-[#396200] hover:underline">View</Link>
                  {canWrite && c.status !== 'Submitted' && c.status !== 'Paid' && (
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-xs text-red-500 hover:underline"
                    >Delete</button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      {showGenerateModal && (
        <GenerateClaimModal
          tripId={tripId}
          trip={trip}
          onClose={() => setShowGenerateModal(false)}
          onSuccess={() => setShowGenerateModal(false)}
        />
      )}
    </div>
  )
}
