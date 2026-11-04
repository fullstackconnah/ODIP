import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import { fieldSurface } from '@/components/FormField'
import { formatDistanceMetres } from '@/lib/locationCheck'
import { extractErrorMessage } from '@/lib/utils'
import type { GeoCause } from './geolocation'

const REASON_MAX = 300
const fieldClass = `w-full py-2 min-h-[44px] text-sm ${fieldSurface}`

const CAUSE_LINE: Record<GeoCause, string> = {
  denied: 'Location is turned off for Bunya Support on this phone.',
  timeout: 'Your phone took too long to find you.',
  insecure: "This web address can't use your location. Open Bunya Support from your usual secure link next time.",
  unsupported: "This browser can't share your location.",
}

/** A fix can be tried again only when the phone could answer: a denied prompt may have been changed, a slow one may be quicker. */
const CAN_RETRY: ReadonlySet<GeoCause> = new Set(['denied', 'timeout'])

/** The note box the location sheets and the time check sheet share. The server cuts at the same length, so the box stops there too. */
export function ReasonField({ id, label, value, onChange, max = REASON_MAX }: { id: string; label: string; value: string; onChange: (v: string) => void; max?: number }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <textarea id={id} rows={3} maxLength={max} className={fieldClass} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

/**
 * Before Start, when the phone gave no fix at a shift with a service location. Start is never blocked: "Start shift" goes ahead with the
 * worker's optional note. "Try again" asks the phone once more (denied and timeout only). Closing the sheet leaves the shift not started.
 */
export function NoFixSheet({ cause, starting, error, onStart, onRetry, onClose }: {
  cause: GeoCause
  starting: boolean
  /** Why the last Start failed, shown here because the page's own line sits behind the sheet. */
  error: string | null
  onStart: (reason: string) => void
  onRetry: () => void
  onClose: () => void
}) {
  // The parent mounts it only while open, so each opening starts with an empty note.
  const [reason, setReason] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      title="We couldn't check your location"
      size="md"
      closeOnBackdrop={false}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          {CAN_RETRY.has(cause) && <Button variant="secondary" size="lg" onClick={onRetry} disabled={starting}>Try again</Button>}
          <Button size="lg" onClick={() => onStart(reason.trim())} disabled={starting}>{starting ? 'Starting…' : 'Start shift'}</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm">{CAUSE_LINE[cause]}</p>
        <ReasonField id="start-nofix-reason" label="Tell your coordinator why (optional)" value={reason} onChange={setReason} />
        {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
      </div>
    </Modal>
  )
}

/**
 * After an off-site Start: the shift has already started. "Send" saves the worker's note for the approver; "Skip" leaves it. A failed Send
 * keeps the note and says so, and Skip still closes the sheet.
 */
export function OffSiteSheet({ placeName, distanceMetres, send, onClose }: {
  placeName: string
  distanceMetres: number
  send: (reason: string) => Promise<unknown>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSending(true)
    setError(null)
    try {
      await send(reason.trim())
      onClose()
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't send your note. Try again, or skip it."))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`You're about ${formatDistanceMetres(distanceMetres)} from ${placeName}`}
      size="md"
      closeOnBackdrop={false}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={sending}>Skip</Button>
          <Button size="lg" onClick={submit} disabled={sending || !reason.trim()}>{sending ? 'Sending…' : 'Send'}</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm">Your shift has started. Let your coordinator know why you're starting here.</p>
        <ReasonField id="start-offsite-reason" label="Why you're starting here" value={reason} onChange={setReason} />
        {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
      </div>
    </Modal>
  )
}
