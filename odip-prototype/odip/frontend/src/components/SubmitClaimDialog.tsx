import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useClaimInvoices, useSubmitPreview, useUpdateClaim } from '@/api/hooks'
import type { ClaimSubmitPreviewDto } from '@/api/types'
import { joinList, plural } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { TAP_FLOOR } from './tapArea'

const COULDNT_CHECK = "Couldn't check which invoices this issues."
const LINE = 'text-[13px] text-[var(--color-muted-foreground)]'

/** Paragraph 2 of the submit confirm (SHAPE section 3): what this submit issues, by the server's predicted numbers. */
function issuesLine({ toIssue, alreadyIssued }: ClaimSubmitPreviewDto) {
  const numbers = toIssue.map(i => i.predictedNumber ?? '')
  const n = numbers.length
  if (n === 0 && alreadyIssued === 0) return 'No invoices are issued: everyone on this claim is agency managed.'
  if (n === 0) return alreadyIssued === 1 ? 'Its invoice is already issued and stays as it is.' : `Its ${alreadyIssued} invoices are already issued and stay as they are.`
  if (alreadyIssued > 0) {
    const stay = alreadyIssued === 1 ? 'The 1 already issued stays as it is.' : `The ${alreadyIssued} already issued stay as they are.`
    return `This issues ${plural(n, 'invoice')} (${n > 2 ? `${numbers[0]} to ${numbers[n - 1]}` : joinList(numbers)}). ${stay}`
  }
  if (n === 1) return `This issues invoice ${numbers[0]}.`
  if (n === 2) return `This issues 2 invoices: ${numbers[0]} and ${numbers[1]}.`
  return `This issues ${n} invoices, ${numbers[0]} to ${numbers[n - 1]}.`
}

/** The answer slot keeps two lines of height, so the dialog does not jump when the preview answers. */
function AnswerSlot({ children }: { children: ReactNode }) {
  return <div className="min-h-[2lh]">{children}</div>
}

function CouldntCheck({ busy, onRetry, text = COULDNT_CHECK }: { busy: boolean; onRetry: () => void; text?: string }) {
  return (
    <p className={`${LINE} flex flex-wrap items-center gap-x-3 gap-y-1`}>
      <span>{text}</span>
      <Button variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={() => { if (!busy) onRetry() }}>Try again</Button>
    </p>
  )
}

type SubmitClaimDialogProps = {
  claimId: string
  onCancel: () => void
  /** Called once the claim is submitted, with the sentence to announce: the numbers really issued, read back from the server. */
  onSubmitted: (announcement: string) => void
}

/**
 * "Mark as submitted?" for one claim, on every path that submits one (the claim page, the trip's Claims tab). It asks the server what the
 * submit would issue as it opens, and holds Confirm until it knows, and until the claim's invoices are read, so the announcement afterwards
 * can tell which numbers are new.
 */
export function SubmitClaimDialog({ claimId, onCancel, onSubmitted }: SubmitClaimDialogProps) {
  const preview = useSubmitPreview([claimId], true)
  const invoices = useClaimInvoices(claimId)
  const updateClaim = useUpdateClaim()
  const { canEditProviderSettings } = usePermissions()
  const [error, setError] = useState<string | null>(null)

  const answer = preview.data?.claims.find(c => c.claimId === claimId)
  const failed = (!preview.data && preview.isError) || (!invoices.data && invoices.isError)
  const loading = !failed && (!answer || !invoices.data)
  const held = loading || failed || !!answer?.missingSettings

  function retry() {
    if (!preview.data) void preview.refetch()
    if (!invoices.data) void invoices.refetch()
  }

  function confirm() {
    if (held || updateClaim.isPending) return
    // N5: the invoices already there, captured when Confirm is pressed, so the announcement names only the ones this submit issued.
    const before = new Set((invoices.data?.invoices ?? []).map(i => i.id))
    setError(null)
    updateClaim.mutate({ claimId, data: { status: 'Submitted' } }, {
      onSuccess: async () => {
        const after = (await invoices.refetch()).data?.invoices ?? []
        const issued = after.filter(i => i.kind === 'Invoice' && i.status === 'Issued' && !before.has(i.id)).map(i => i.displayNumber)
        onSubmitted(issued.length > 0 ? `Claim submitted. Issued ${joinList(issued)}.` : 'Claim submitted. No invoices issued.')
      },
      onError: err => setError(extractErrorMessage(err, "Couldn't update the claim status. Please try again.")),
    })
  }

  return (
    <ConfirmDialog
      open
      onCancel={() => { if (!updateClaim.isPending) onCancel() }}
      onConfirm={confirm}
      title="Mark as submitted?"
      confirmLabel="Mark as Submitted"
      loading={updateClaim.isPending}
      confirmDisabled={held}
      message={
        <>
          <p>Mark this claim as submitted to the NDIA? You can't change its lines after this.</p>
          <AnswerSlot>
            {failed ? (
              <CouldntCheck busy={preview.isFetching || invoices.isFetching} onRetry={retry} />
            ) : loading ? (
              <p role="status" className={LINE}>Checking which invoices this issues…</p>
            ) : answer!.missingSettings ? (
              <p className={LINE}>
                Set up your organisation's invoice details in Settings first.{' '}
                {canEditProviderSettings
                  ? <Link to="/settings?section=organisation" className={`${TAP_FLOOR} whitespace-nowrap font-medium text-[var(--color-primary)] underline underline-offset-2`}>Open Organisation profile</Link>
                  : 'Ask an Admin to fill in the organisation profile.'}
              </p>
            ) : (
              <p className={LINE}>{issuesLine(answer!)}</p>
            )}
          </AnswerSlot>
          {error && <p role="alert" className="text-[var(--color-destructive)]">{error}</p>}
        </>
      }
    />
  )
}

type BulkSubmitDialogProps = {
  claimIds: string[]
  onCancel: () => void
  /** Confirmed: the caller writes the claims (and says which it could not). */
  onConfirm: () => void
}

/** "Mark 3 claims as submitted?" for the trip's bulk status change: one preview call for every claim, a count and no numbers (SHAPE section 3). */
export function BulkSubmitDialog({ claimIds, onCancel, onConfirm }: BulkSubmitDialogProps) {
  const preview = useSubmitPreview(claimIds, true)
  const data = preview.data
  const failed = !data && preview.isError
  const missing = !!data?.claims.some(c => c.missingSettings)

  return (
    <ConfirmDialog
      open
      onCancel={onCancel}
      onConfirm={() => { if (data && !missing) onConfirm() }}
      title={`Mark ${claimIds.length} claims as submitted?`}
      confirmLabel="Mark as Submitted"
      confirmDisabled={!data || missing}
      message={
        <AnswerSlot>
          {failed ? (
            <CouldntCheck busy={preview.isFetching} onRetry={() => void preview.refetch()} text="Couldn't check which invoices these issue." />
          ) : !data ? (
            <p role="status" className={LINE}>Checking which invoices these issue…</p>
          ) : missing ? (
            <p>Set up your organisation's invoice details in Settings first.</p>
          ) : (
            <p>{data.invoiceCount === 0 ? 'No invoices are issued.' : `This issues ${plural(data.invoiceCount, 'invoice')}.`} You can't change their lines after this.</p>
          )}
        </AnswerSlot>
      }
    />
  )
}
