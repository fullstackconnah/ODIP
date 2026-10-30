import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDeleteClaim, useUpdateClaim } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { DataTable } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { BulkSubmitDialog, SubmitClaimDialog } from '@/components/SubmitClaimDialog'
import GenerateClaimModal from '@/components/GenerateClaimModal'
import { RejectClaimDialog } from '@/components/RejectClaimDialog'
import type { TripClaimStatus } from '@/api/types/enums'
import type { TripClaimListDto, UpdateClaimDto } from '@/api/types/claims'
import type { TripDetailDto } from '@/api/types/trips'
import { extractErrorMessage, getStatusColor } from '@/lib/utils'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { TAP_FLOOR } from '@/components/tapArea'

const CLAIM_STATUS_ITEMS = [
  { value: 'Draft', label: 'Draft' },
  { value: 'Submitted', label: 'Submitted' },
  { value: 'Paid', label: 'Paid' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'PartiallyPaid', label: 'Partially Paid' },
]

// A status in words (every status a claim can hold, so a pill never shows a bare dash).
const STATUS_LABEL: Record<TripClaimStatus, string> = {
  Draft: 'Draft', Ready: 'Ready', Submitted: 'Submitted', Approved: 'Approved', Paid: 'Paid', PartiallyPaid: 'Partially Paid', Rejected: 'Rejected', Cancelled: 'Cancelled',
}

// Where a claim's status may go next; mirrors ClaimsController.CanMove (the server's refusal stays as the backstop). Paid, Cancelled: nowhere.
const LEGAL_NEXT: Partial<Record<TripClaimStatus, TripClaimStatus[]>> = {
  Draft: ['Submitted'],
  Ready: ['Submitted'],
  Submitted: ['Paid', 'PartiallyPaid', 'Rejected'],
  Approved: ['Paid', 'PartiallyPaid', 'Rejected'],
  PartiallyPaid: ['Paid'],
  Rejected: ['Submitted'],
}

// Same set as the server's DeleteClaim guard: a Rejected claim stays deletable because delete-and-regenerate is the only way to correct an NDIA rejection.
const DELETABLE = new Set<TripClaimStatus>(['Draft', 'Ready', 'Rejected', 'Cancelled'])

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
  // The claims being marked Submitted, while the confirm says what that issues (Xero PR1): nothing is written until Confirm.
  const [submitting, setSubmitting] = useState<string[] | null>(null)
  const [announcement, setAnnouncement] = useState('')

  /**
   * Writes the same change to each claim; settles when every one has been written, and refuses with the first refusal. Each claim is its own `mutateAsync` promise: `mutate` with callbacks reports
   * only the LAST call made on a mutation, so with two or more claims the others never settled and the bulk change waited for ever.
   */
  function writeClaims(ids: string[], data: UpdateClaimDto) {
    return Promise.all(ids.map(id => updateClaim.mutateAsync({ claimId: id, data })))
  }

  // Each claim is judged on its own, so a mixed selection changes the claims it can and says which it could not; those stay selected.
  async function bulkUpdateClaimStatus(ids: string[], status: string) {
    setError(null)
    setBulkLoading(true)
    const results = await Promise.allSettled(ids.map(id => updateClaim.mutateAsync({ claimId: id, data: { status: status as TripClaimStatus } })))
    const refused = results.flatMap((r, i) => (r.status === 'rejected' ? [{ id: ids[i], reason: r.reason as unknown }] : []))
    setSelectedClaimIds(new Set(refused.map(r => r.id)))
    if (refused.length > 0) {
      const why = extractErrorMessage(refused[0].reason, 'Failed to update claims.')
      setError(ids.length > 1 ? `${ids.length - refused.length} of ${ids.length} claims changed. ${why}` : why)
    }
    setBulkLoading(false)
  }

  // A refused move (the server allows only real ones, e.g. not Submitted back to Draft) says why, as the bulk change does.
  function changeStatus(claimId: string, status: TripClaimStatus) {
    setError(null)
    updateClaim.mutate({ claimId, data: { status } }, { onError: err => setError(extractErrorMessage(err, 'Failed to update the claim.')) })
  }

  function askForNdiaCode(ids: string[]) {
    setRejectError(null)
    setRejecting(ids)
  }

  function askToSubmit(ids: string[]) {
    setError(null)
    setSubmitting(ids)
  }

  async function rejectClaims(ids: string[], code: string | null) {
    setError(null)
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
    setError(null)
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
      <AnnouncementRegion message={announcement} />
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[var(--color-foreground)]">NDIS Claims</h2>
        {canWrite && (
          <Button onClick={() => setShowGenerateModal(true)}>
            <Plus className="w-4 h-4" /> Generate Claim
          </Button>
        )}
      </div>
      <p className="text-[13px] text-[var(--color-muted-foreground)]">NDIA-managed claims are sent from Claims. <Link to="/claims" className={`${TAP_FLOOR} font-medium text-[var(--color-primary)] hover:underline`}>Go to Claims</Link></p>

      {error && (
        <Callout tone="error">{error}</Callout>
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
                onBulkChange: (ids: string[], value: string) => (value === 'Rejected' ? askForNdiaCode(ids) : value === 'Submitted' ? askToSubmit(ids) : bulkUpdateClaimStatus(ids, value)),
              } } : {}),
              // No legal move (Paid, Cancelled): the status is just a word, so it is a badge at full strength rather than a disabled pill dimmed to 60%.
              render: (c: TripClaimListDto) => !LEGAL_NEXT[c.status] ? (
                <StatusBadge status={c.status} label={STATUS_LABEL[c.status]} />
              ) : (
                <Dropdown
                  variant="pill"
                  value={c.status}
                  onChange={val => (val === 'Rejected' ? askForNdiaCode([c.id]) : val === 'Submitted' ? askToSubmit([c.id]) : changeStatus(c.id, val as TripClaimStatus))}
                  colorClass={getStatusColor(c.status)}
                  items={[c.status, ...(LEGAL_NEXT[c.status] ?? [])].map(value => ({ value, label: STATUS_LABEL[value] }))}
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
                  <Link to={`/claims/${c.id}`} className="text-xs text-[var(--color-primary)] hover:underline" aria-label={`View: ${c.claimReference}`}>View</Link>
                  {canWrite && DELETABLE.has(c.status) && (
                    <Button variant="ghost-danger" size="sm" onClick={() => handleDelete(c)} aria-label={`Delete: ${c.claimReference}`}>
                      Delete
                    </Button>
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

      {submitting && (submitting.length === 1 ? (
        <SubmitClaimDialog
          claimId={submitting[0]}
          onCancel={() => setSubmitting(null)}
          onSubmitted={message => { setSubmitting(null); setSelectedClaimIds(new Set()); setAnnouncement(message) }}
        />
      ) : (
        <BulkSubmitDialog
          claimIds={submitting}
          onCancel={() => setSubmitting(null)}
          onConfirm={() => { setSubmitting(null); void bulkUpdateClaimStatus(submitting, 'Submitted') }}
        />
      ))}

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
