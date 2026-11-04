import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import { minutesWords } from '../lib/portal'
import { ReasonField } from './LocationSheets'

/** The server cuts a time reason at the same length (ShiftTimeRules.MaxReasonLength). */
export const TIME_REASON_MAX = 500

/**
 * Before Start, when the worker is more than 5 minutes off the rostered start. The reason is optional and "Start shift" always goes ahead;
 * "Not yet" (or Escape) leaves the shift not started. A failed Start keeps the sheet open and says why, since the page's own line sits behind it.
 */
export function TimeCheckSheet({ minutes, rosteredLabel, starting, error, onStart, onClose }: {
  /** Signed whole minutes from the rostered start: negative is early. */
  minutes: number
  /** The rostered start on the provider's clock, e.g. "9:00 am". */
  rosteredLabel: string
  starting: boolean
  error: string | null
  onStart: (reason: string) => void
  onClose: () => void
}) {
  // The parent mounts it only while open, so each opening starts with an empty note.
  const [reason, setReason] = useState('')
  const way = minutes < 0 ? 'early' : 'late'
  return (
    <Modal
      open
      onClose={onClose}
      title={`You're starting ${minutesWords(minutes)} ${way}`}
      size="md"
      closeOnBackdrop={false}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={starting}>Not yet</Button>
          <Button size="lg" onClick={() => onStart(reason.trim())} disabled={starting}>{starting ? 'Starting…' : 'Start shift'}</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm">Your shift is rostered to start at {rosteredLabel}.</p>
        <ReasonField
          id="start-time-reason" label={`Why are you starting ${way}? (optional)`} hint="Your coordinator sees this."
          value={reason} onChange={setReason} max={TIME_REASON_MAX} autoFocus
        />
        {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
      </div>
    </Modal>
  )
}
