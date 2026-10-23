import { useState } from 'react'
import { useIssueCreditNote, useVoidInvoice } from '@/api/hooks'
import type { InvoiceSummaryDto } from '@/api/types'
import { extractErrorMessage, formatCurrency } from '@/lib/utils'
import { ConfirmDialog } from './ConfirmDialog'
import { TextAreaField } from './TextAreaField'

/** The server's limit too (InvoiceReasonDto). */
const REASON_MAX_LENGTH = 500

const COPY = {
  void: {
    title: (n: string) => `Void ${n}?`,
    body: () => 'The invoice stays on record marked VOID, and its number is never used again. Let the payer know it no longer stands.',
    missing: "Say why it's being voided.",
    confirm: 'Void invoice',
  },
  credit: {
    title: (n: string) => `Issue a credit note for ${n}?`,
    body: (total: number) => `A payment is recorded against this invoice, so it can't be voided. A credit note for the full ${formatCurrency(total)} cancels it, and the invoice is marked CREDITED.`,
    missing: "Say why it's being credited.",
    confirm: 'Issue credit note',
  },
}

type VoidInvoiceDialogProps = {
  claimId: string
  invoice: InvoiceSummaryDto
  /** void: no payment is recorded; credit: one is, so the invoice is cancelled by a credit note instead. */
  mode: 'void' | 'credit'
  onCancel: () => void
  /** The server's answer: the voided invoice, or the new credit note. */
  onDone: (result: InvoiceSummaryDto) => void
}

/** "Void INV-0042?" or "Issue a credit note for INV-0042?", asking why (kept in the audit log). Built like RejectClaimDialog. */
export function VoidInvoiceDialog({ claimId, invoice, mode, onCancel, onDone }: VoidInvoiceDialogProps) {
  const voidInvoice = useVoidInvoice()
  const creditNote = useIssueCreditNote()
  const mutation = mode === 'void' ? voidInvoice : creditNote
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copy = COPY[mode]

  function confirm() {
    const trimmed = reason.trim()
    if (trimmed === '') { setMissing(true); return }
    setError(null)
    mutation.mutate({ invoiceId: invoice.id, claimId, reason: trimmed }, {
      onSuccess: result => onDone(result),
      onError: err => setError(extractErrorMessage(err, "Couldn't save that. Please try again.")),
    })
  }

  return (
    <ConfirmDialog
      open
      onCancel={() => { if (!mutation.isPending) onCancel() }}
      onConfirm={confirm}
      title={copy.title(invoice.displayNumber)}
      confirmLabel={copy.confirm}
      variant="danger"
      loading={mutation.isPending}
      message={
        <>
          <p>{copy.body(invoice.total)}</p>
          <TextAreaField
            label="Reason"
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            value={reason}
            onChange={event => { setReason(event.target.value); setMissing(false) }}
            hint="Kept in the audit log. Not printed on the invoice."
            error={missing ? copy.missing : undefined}
          />
          {error && <p role="alert" className="text-[var(--color-destructive)]">{error}</p>}
        </>
      }
    />
  )
}
