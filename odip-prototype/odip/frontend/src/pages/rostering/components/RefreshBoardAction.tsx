import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/Button'

type RefreshBoardActionProps = {
  /** The board is fresh: the caller clears its notice, says so once and moves focus (this button is about to go). */
  onRefreshed: () => void
}

/**
 * "Refresh the board", for the board-changed 409 (lib/boardChanged) wherever a roster write shows it. It refetches the shown week (the active
 * roster-board query). PageState's RetryError pattern: aria-disabled and aria-busy while it runs, a fixed-width status beside the button so the
 * notice never changes size, and one polite status line; a failed refresh keeps the notice and says so.
 */
export function RefreshBoardAction({ onRefreshed }: RefreshBoardActionProps) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<'idle' | 'pending' | 'failed'>('idle')
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  async function refresh() {
    if (pending.current) return
    pending.current = true
    setState('pending')
    try {
      await queryClient.refetchQueries({ queryKey: ['roster-board'], type: 'active' }, { throwOnError: true })
      pending.current = false
      if (mounted.current) setState('idle')
      onRefreshed()
    } catch {
      pending.current = false
      if (mounted.current) setState('failed')
    }
  }

  const status = state === 'pending' ? 'Refreshing…' : state === 'failed' ? "Couldn't refresh the board." : ''
  return (
    <>
      <Button variant="secondary" size="sm" onClick={refresh} aria-disabled={state === 'pending'} aria-busy={state === 'pending' || undefined} className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed">
        Refresh the board
      </Button>
      {/* A fixed width (the failed line measures about 170px), so the button holds one x position in every state. */}
      <span aria-hidden="true" className="min-w-[11rem] text-[var(--color-muted-foreground)]">{status}</span>
      {/* Out of the notice: it sits in a role="alert" Callout, which would say the status again, assertively. */}
      {createPortal(<span role={state === 'idle' ? undefined : 'status'} aria-live="polite" aria-atomic="true" className="sr-only">{status}</span>, document.body)}
    </>
  )
}
