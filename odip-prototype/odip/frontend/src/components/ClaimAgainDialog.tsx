import { useNavigate } from 'react-router-dom'
import { useClaimAgain, usePreviewClaimAgain } from '@/api/hooks'
import { plural } from '@/lib/format'
import { extractErrorMessage, formatCurrency, formatDateAu } from '@/lib/utils'
import { Callout } from './Callout'
import { ConfirmDialog } from './ConfirmDialog'
import { LeftOutCallout, SHIFT_LEFT_OUT_FOOTER } from './LeftOutCallout'
import { heldClaimLink } from './heldClaimLink'

const LINE = 'text-[13px] text-[var(--color-muted-foreground)]'

type ClaimAgainDialogProps = {
  open: boolean
  claimId: string
  claimReference: string
  claimStatus: 'Rejected' | 'Cancelled'
  onCancel: () => void
}

/**
 * "Claim again?" for a rejected (or cancelled) shift claim: the server's preview says what the new draft claim would hold and what it leaves out,
 * and Confirm deletes the old claim and makes the new one in one step. Confirm is held until the preview has a claim to make; a refusal is the server's own sentence.
 * On success the old page is replaced by the new claim, which says where it came from.
 */
export function ClaimAgainDialog({ open, claimId, claimReference, claimStatus, onCancel }: ClaimAgainDialogProps) {
  const navigate = useNavigate()
  const preview = usePreviewClaimAgain(claimId, open)
  const make = useClaimAgain()

  const data = preview.data
  const empty = !!data && data.lineItems.length === 0
  const previewFailed = !data && preview.isError
  const loading = !data && !previewFailed
  const held = loading || previewFailed || empty

  function confirm() {
    if (held || make.isPending) return
    make.mutate(claimId, {
      onSuccess: made => navigate(`/claims/${made.id}`, { replace: true, state: { claimedAgainFrom: claimReference } }),
    })
  }

  const leftOut = (data?.leftOut ?? []).map(row => ({
    key: row.shiftId,
    lead: formatDateAu(row.serviceDate),
    description: row.description,
    reason: row.reason,
    action: heldClaimLink(row),
  }))

  return (
    <ConfirmDialog
      open={open}
      onCancel={() => { if (!make.isPending) onCancel() }}
      onConfirm={confirm}
      title="Claim again?"
      variant="danger"
      focusCancel
      confirmLabel="Delete and claim again"
      confirmAriaLabel={`Delete ${claimReference} and claim again`}
      loading={make.isPending}
      confirmDisabled={held}
      message={
        <div className="flex flex-col gap-3">
          {loading && <p role="status" className={LINE}>Working out the new claim…</p>}
          {previewFailed && <Callout tone="danger">{extractErrorMessage(preview.error, "Couldn't work out the new claim. Please try again.")}</Callout>}
          {empty && <p>Nothing on <span className="whitespace-nowrap">{claimReference}</span> can be claimed again.</p>}
          {data && !empty && (
            <>
              <p>
                Bunya Support deletes {claimStatus.toLowerCase()} claim <span className="whitespace-nowrap font-medium">{claimReference}</span> and makes a new draft claim
                for its {data.lineItems.length === 1 ? 'shift' : plural(data.lineItems.length, 'shift')} ({formatCurrency(data.totalAmount)}).
              </p>
              <p className={LINE}>Changes made on {claimReference} aren't kept. You can check the new claim before you send it.</p>
            </>
          )}
          {leftOut.length > 0 && <LeftOutCallout items={leftOut} heading={plural(leftOut.length, 'shift') + ' left out'} footer={SHIFT_LEFT_OUT_FOOTER} />}
          {make.isError && <Callout tone="danger">{extractErrorMessage(make.error, "Couldn't claim again. Please try again.")}</Callout>}
        </div>
      }
    />
  )
}
