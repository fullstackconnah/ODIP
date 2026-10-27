import { useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, CloudUpload, Loader2 } from 'lucide-react'
import { Button } from '@/components/Button'
import { offlineQueue } from '@/lib/offline/queue'
import { clockTime } from '@/lib/offline/reasons'
import { plural } from '@/lib/format'
import { NotSentModal } from './NotSentModal'
import { useSyncSummary } from './syncState'

/**
 * The first row of the sticky action bar (SHAPE 4a/4b): how many changes are waiting on this phone, with Send now, or the ones Bunya Support did not accept, with Review.
 * Neutral tone throughout; the count is in a status region so a change is announced politely.
 */
export function SyncRow() {
  const s = useSyncSummary()
  const [reviewing, setReviewing] = useState(false)
  if (s.state === 'idle') return null
  const send = () => { void offlineQueue.replay() }
  let icon = <CloudUpload className="size-4 shrink-0" aria-hidden="true" />
  let text = ''
  let action: ReactNode = null
  if (s.state === 'waiting') {
    text = `${s.stillOffline ? 'Still offline. ' : ''}${plural(s.waiting, 'change')} waiting to send`
    action = <Button variant="secondary" size="md" className="shrink-0 whitespace-nowrap" onClick={send}>Send now</Button>
  } else if (s.state === 'sending') {
    icon = <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    text = `Sending ${plural(s.waiting, 'change')}…`
    action = <Button variant="secondary" size="md" className="shrink-0 whitespace-nowrap" disabled>Send now</Button>
  } else if (s.state === 'allSent') {
    icon = <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
    text = `All sent at ${clockTime(new Date(s.at).toISOString())}`
  } else {
    icon = <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
    text = `${s.notSent} not sent${s.waiting > 0 ? ` · ${s.waiting} waiting` : ''}`
    action = <Button variant="secondary" size="md" className="shrink-0 whitespace-nowrap" onClick={() => setReviewing(true)}>Review</Button>
  }
  return (
    <div data-sync-row className="flex items-center gap-3 basis-full min-h-[var(--control-h)] text-[var(--color-foreground)]">
      {icon}
      <span role="status" className="flex-1 text-sm line-clamp-2">{text}</span>
      {action}
      {reviewing && <NotSentModal open onClose={() => setReviewing(false)} />}
    </div>
  )
}
