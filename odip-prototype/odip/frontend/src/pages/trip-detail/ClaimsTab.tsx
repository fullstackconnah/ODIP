import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDeleteClaim, useUpdateClaim } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { DataTable } from '@/components/DataTable'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import GenerateClaimModal from '@/components/GenerateClaimModal'
import { RejectClaimDialog } from '@/components/RejectClaimDialog'
import type { TripClaimStatus } from '@/api/types/enums'
import type { TripClaimListDto, UpdateClaimDto } from '@/api/types/claims'
import type { TripDetailDto } from '@/api/types/trips'
import { extractErrorMessage } from '@/lib/utils'
import { Button } from '@/components/Button'

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
  const [deletingClaim, setDeletingClaim] = useState<TripClaimListDto | null>(null)
  // The claims being marked Rejected, while the NDIA's code is asked for: whichever way a claim gets there (its status pill, or the bulk control), a rejection asks, as the claim page's does.
  const [rejecting, setRejecting] = useState<string[] | null>(null)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const [rejectLoading, setRejectLoading] = useState(false)

  /**
   * Writes the same change to each claim; settles when every one has been written, and refuses with the first refusal. Each claim is its own `mutateAsync` promise: `mutate` with callbacks reports
   * only the LAST call made on a mutation, so with two or more claims the others never settled and the bulk change waited for ever.
   */
  function writeClaims(ids: string[], data: UpdateClaimDto) {
    return Promise.all(ids.map(id => updateClaim.mutateAsync({ claimId: id, data })))
  }

  async function bulkUpdateClaimStatus(ids: string[], status: string) {
    setBulkLoading(true)
    try {
      await writeClaims(ids, { status: status as TripClaimStatus })
      setSelectedClaimIds(new Set())
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to update claims.'))
    } finally {
      setBulkLoading(false)
    }
  }

  function askForNdiaCode(ids: string[]) {
    setRejectError(null)
    setRejecting(ids)
  }

  async function rejectClaims(ids: string[], code: string | null) {
    setRejectLoading(true)
    setRejectError(null)
    try {
      // The code goes with the Rejected status in the one request, and only when somebody gave one.
      await writeClaims(ids, code ? { status: 'Rejected', rejectionCode: code } : { status: 'Rejected' })
      setRejecting(null)
      setSelectedClaimIds(new Set())
    } catch (err: unknown) {
      setRejectError(extractErrorMessage(err, 'Failed to reject the claim.'))
    } finally {
      setRejectLoading(false)
    }
  }

  function handleDelete(claim: TripClaimListDto) {
    setDeletingClaim(claim)
  }

  function confirmDeleteClaim() {
    if (!deletingClaim) return
    deleteClaim.mutate(deletingClaim.id, {
      onSuccess: () => setDeletingClaim(null),
      onError: (err: unknown) => {
        setError(extractErrorMessage(err, 'Failed to delete claim.'))
        setDeletingClaim(null)
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[var(--color-foreground)]">NDIS Claims</h2>
        {canWrite && (
          <Button onClick={() => setShowGenerateModal(true)}>
            + Generate Claim
          </Button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-[var(--radius-md)] px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <span className="mt-0.5">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {claims.length === 0 ? (
        <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] p-8 text-center text-[var(--color-muted-foreground)]">
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
                onBulkChange: (ids: string[], value: string) => (value === 'Rejected' ? askForNdiaCode(ids) : bulkUpdateClaimStatus(ids, value)),
              } } : {}),
              render: (c: TripClaimListDto) => (
                <Dropdown
                  variant="pill"
                  value={c.status}
                  onChange={val => (val === 'Rejected' ? askForNdiaCode([c.id]) : updateClaim.mutate({ claimId: c.id, data: { status: val as TripClaimStatus } }))}
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
                  <Link to={`/claims/${c.id}`} className="text-xs text-[var(--color-primary)] hover:underline">View</Link>
                  {canWrite && c.status !== 'Submitted' && c.status !== 'Paid' && (
                    <button
                      onClick={() => handleDelete(c)}
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

      {rejecting && (
        <RejectClaimDialog
          count={rejecting.length}
          error={rejectError}
          loading={rejectLoading}
          onCancel={() => { if (!rejectLoading) setRejecting(null) }}
          onConfirm={code => { void rejectClaims(rejecting, code) }}
        />
      )}

      <ConfirmDialog
        open={deletingClaim !== null}
        onCancel={() => setDeletingClaim(null)}
        onConfirm={confirmDeleteClaim}
        title="Delete Claim"
        message={
          deletingClaim
            ? `Delete claim ${deletingClaim.claimReference}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteClaim.isPending}
      />
    </div>
  )
}
