import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Loader2 } from 'lucide-react'
import { RETENTION_DUE_KEY, purgeFailure, usePurgeParticipant, type PurgeFailure } from '@/api/hooks'
import type { DataExportFailure, DataExportSaved, PurgeRecordDto, RetentionDueDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { kindsText, recordsText, retentionKinds, retentionTotal } from './retentionKinds'

/** The server's limit too (PurgeRecord.ReasonMaxLength). */
const REASON_MAX_LENGTH = 500
const NAME_MISMATCH = "The last name doesn't match."
const REASON_REQUIRED = 'Give a reason for the purge.'

type PurgeParticipantDialogProps = {
  row: RetentionDueDto
  /** The tab's one per-participant download: this person's file when it has been saved (from the row button or in here), and its state. */
  downloaded: DataExportSaved | null
  downloading: boolean
  downloadFailure: DataExportFailure | null
  onDownload: () => void
  onCancel: () => void
  /** The server's answer, including the 200 for a record that was already purged. */
  onDone: (record: PurgeRecordDto) => void
}

/**
 * "Purge Zoe Campbell's record?" (SHAPE section 3.4). Built like VoidInvoiceDialog: the Admin types the last name and gives a reason.
 * The download prompt is a prompt, not a gate (lead ruling): the Admin may purge without a copy.
 */
export function PurgeParticipantDialog({ row, downloaded, downloading, downloadFailure, onDownload, onCancel, onDone }: PurgeParticipantDialogProps) {
  const purge = usePurgeParticipant()
  const queryClient = useQueryClient()
  const [lastName, setLastName] = useState('')
  const [reason, setReason] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [reasonTouched, setReasonTouched] = useState(false)
  const [failure, setFailure] = useState<PurgeFailure | null>(null)

  const kinds = retentionKinds(row.rowCounts)
  const total = retentionTotal(kinds)
  const person = `${row.firstName} ${row.lastName}`
  // The server's rule: trimmed, case-insensitive.
  const nameOk = lastName.trim().toLowerCase() === row.lastName.trim().toLowerCase()
  const reasonOk = reason.trim() !== ''
  const nameError = failure?.field === 'lastName' ? failure.message : nameTouched && lastName.trim() !== '' && !nameOk ? NAME_MISMATCH : undefined
  const reasonError = failure?.field === 'reason' ? failure.message : reasonTouched && !reasonOk ? REASON_REQUIRED : undefined
  const lineFailure = failure && !failure.field ? failure : null

  function confirm() {
    if (!nameOk || !reasonOk || failure?.final) return
    setFailure(null)
    purge.mutate({ participantId: row.participantId, lastName: lastName.trim(), reason: reason.trim() }, {
      onSuccess: onDone,
      onError: (err) => {
        const next = purgeFailure(err)
        setFailure(next)
        if (next.refresh) void queryClient.invalidateQueries({ queryKey: RETENTION_DUE_KEY })
      },
    })
  }

  return (
    <ConfirmDialog
      open
      alignTop
      variant="danger"
      title={`Purge ${person}'s record?`}
      confirmLabel="Purge record"
      loading={purge.isPending}
      confirmDisabled={!nameOk || !reasonOk || !!failure?.final}
      onConfirm={confirm}
      // Cancel and Escape are ignored while the purge runs: closing then would hide an answer that is still coming.
      onCancel={() => { if (!purge.isPending) onCancel() }}
      message={
        <>
          <p>This permanently deletes their record and everything linked to it: {recordsText(total)} of {kindsText(kinds.length)}. It can't be undone.</p>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-[var(--color-foreground)]">See what's deleted</summary>
            <ul className="mt-2 max-h-48 overflow-y-auto pl-5 list-disc">
              {kinds.map((k) => <li key={k.table}>{k.label}: {k.count.toLocaleString('en-AU')}</li>)}
            </ul>
          </details>
          {downloaded ? (
            <Callout tone="success" title="Their data is downloaded">Saved as {downloaded.fileName}. Keep it somewhere secure.</Callout>
          ) : (
            <Callout
              tone="warning"
              title="Download their data first"
              actions={
                <Button variant="secondary" size="sm" onClick={onDownload} aria-disabled={downloading || undefined} aria-busy={downloading || undefined} className="max-md:min-h-11">
                  {downloading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
                  {downloading ? 'Downloading…' : 'Download their data'}
                </Button>
              }
            >
              If anyone may still need their records, download them before you purge. Afterwards there is no copy in Bunya Support.
            </Callout>
          )}
          {downloadFailure && !downloaded && (
            <p role="alert" className="text-[var(--color-destructive)]">{downloadFailure.title}. {downloadFailure.body}</p>
          )}
          <TextField
            label={`Type their last name, ${row.lastName}, to confirm`}
            value={lastName}
            onChange={(event) => { setLastName(event.target.value); setFailure((f) => (f?.field === 'lastName' ? null : f)) }}
            onBlur={() => setNameTouched(true)}
            error={nameError}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
          />
          <TextAreaField
            label="Reason"
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            value={reason}
            onChange={(event) => { setReason(event.target.value); setFailure((f) => (f?.field === 'reason' ? null : f)) }}
            onBlur={() => setReasonTouched(true)}
            hint="Don't include their name or details."
            error={reasonError}
          />
          {lineFailure && <p role="alert" className="text-[var(--color-destructive)]">{lineFailure.message}</p>}
        </>
      }
    />
  )
}
