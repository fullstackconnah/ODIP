import { useState } from 'react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { formatWithTimeZone } from '@/lib/utils'
import type { WhatsNewEntry } from '@/api/types'

const MUTED = 'text-[var(--color-muted-foreground)]'

/** `25 Oct 2026`, in Sydney time. en-AU prints September as "Sept": no test may hard-code a September date. */
export const formatWhatsNewDate = (iso: string) => formatWithTimeZone(iso, 'Australia/Sydney', { day: 'numeric', month: 'short', year: 'numeric' })

/** One release note, drawn the same in the panel and the pop-up. Title and body are plain text written by Bunya Support: React escapes them. */
export function WhatsNewEntryItem({ entry, isNew = false }: { entry: WhatsNewEntry; isNew?: boolean }) {
  return (
    <article className="border-b border-[var(--color-border)] px-4 py-3 last:border-b-0">
      <p className={`text-xs ${MUTED}`}>
        {isNew && <><span className="font-semibold text-[var(--color-primary)]">New</span>{' · '}</>}
        <time dateTime={entry.publishedAtUtc}>{formatWhatsNewDate(entry.publishedAtUtc)}</time>
      </p>
      <h3 className="mt-1 font-display text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{entry.title}</h3>
      <div className="mt-1 space-y-2 text-sm leading-normal text-foreground">
        {entry.body.split(/\n\s*\n/).map((paragraph, i) => (
          <p key={i} className="whitespace-pre-line [overflow-wrap:anywhere]">{paragraph}</p>
        ))}
      </div>
    </article>
  )
}

type Phase = 'idle' | 'pending' | 'failed'

/** The danger banner with the house held "Try again" (PageState's pattern, in this panel's own words). */
function LoadError({ onRetry }: { onRetry: () => Promise<unknown> | unknown }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const retry = async () => {
    if (phase === 'pending') return
    setPhase('pending')
    try {
      const result = (await onRetry()) as { isError?: boolean } | undefined
      setPhase(result?.isError ? 'failed' : 'idle')
    } catch {
      setPhase('failed')
    }
  }
  const status = phase === 'pending' ? 'Trying again…' : phase === 'failed' ? "Couldn't load it again." : ''
  return (
    <div className="px-4 py-3">
      <Callout
        tone="danger"
        actions={(
          <Button variant="secondary" size="sm" onClick={() => void retry()} aria-disabled={phase === 'pending'} aria-busy={phase === 'pending' || undefined} className="min-h-[var(--tap-min)] aria-disabled:opacity-50 aria-disabled:cursor-not-allowed">
            Try again
          </Button>
        )}
      >
        Couldn't load what's new.
        {status && <span className={`mt-1 block text-sm ${MUTED}`}>{status}</span>}
      </Callout>
      <div role="status" aria-live="polite" className="sr-only">{status}</div>
    </div>
  )
}

export type WhatsNewListProps = {
  entries?: WhatsNewEntry[]
  /** The feed failed with nothing to show (or a retry of that is in flight). */
  failed: boolean
  onRetry: () => Promise<unknown> | unknown
  /** How many of the newest entries were unread when the panel opened: they carry "New" for this open only. */
  newCount: number
}

/** The panel's body (SHAPE section 3): loading, error, empty and the entries, newest first. The frame owns the heading. */
export function WhatsNewList({ entries, failed, onRetry, newCount }: WhatsNewListProps) {
  if (!entries) {
    if (failed) return <LoadError onRetry={onRetry} />
    return <p role="status" className={`py-8 text-center text-sm ${MUTED}`}>Loading…</p>
  }
  if (entries.length === 0) return <p className={`py-8 text-center text-sm ${MUTED}`}>Nothing new yet.</p>
  return <>{entries.map((entry, i) => <WhatsNewEntryItem key={entry.id} entry={entry} isNew={i < newCount} />)}</>
}
