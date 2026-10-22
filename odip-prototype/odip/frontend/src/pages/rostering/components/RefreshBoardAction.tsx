import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/Button'
import type { RosterBoardDto, ShiftDto } from '@/api/types'
import { allBoardShifts } from '../lib/roster'

const FAILED = "Couldn't refresh the board. Try again."

type RefreshBoardActionProps = {
  /** The board is fresh: the caller clears its notice, says so once and moves focus (this button is about to go). Gets the shifts now on the board, to re-read what the caller holds. Not called when the notice is already gone. */
  onRefreshed: (shifts: ShiftDto[]) => void
  /** Says a sentence in the caller's own polite region (AnnouncementRegion): the notice is role="alert", and in the shift panel a live region outside the modal is not heard. */
  announce: (sentence: string) => void
}

/**
 * "Refresh the board", for the board-changed 409 (lib/boardChanged) wherever a roster write shows it. It refetches the shown week (the active
 * roster-board query). PageState's RetryError pattern: aria-disabled and aria-busy while it runs, a status beside the button, and its sentences said
 * through the caller's region (`announce`); a failed refresh keeps the notice and says so. Put it in the notice's text column (Callout children), not
 * in the shared `actions` slot: its row wraps, so on a narrow notice the status goes under the button instead of pushing the dismiss X out.
 */
export function RefreshBoardAction({ onRefreshed, announce }: RefreshBoardActionProps) {
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
    announce('Refreshing the board…')   // every refresh passes through it, so a second success is a changed sentence and is heard again
    try {
      // No board on screen means nothing was fetched: that is a failure to report, not "up to date".
      if (queryClient.getQueryCache().findAll({ queryKey: ['roster-board'], type: 'active' }).length === 0) throw new Error('no board on screen')
      await queryClient.refetchQueries({ queryKey: ['roster-board'], type: 'active' }, { throwOnError: true })
      pending.current = false
      // The notice went while this ran (a newer write cleared it, or the panel was saved): what it was about is gone, so say nothing and take no focus.
      if (!mounted.current) return
      setState('idle')
      onRefreshed(queryClient.getQueriesData<RosterBoardDto>({ queryKey: ['roster-board'], type: 'active' }).flatMap(([, board]) => allBoardShifts(board)))
    } catch {
      pending.current = false
      if (!mounted.current) return
      setState('failed')
      announce(FAILED)
    }
  }

  const status = state === 'pending' ? 'Refreshing…' : state === 'failed' ? FAILED : ''
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button variant="secondary" size="sm" onClick={refresh} aria-disabled={state === 'pending'} aria-busy={state === 'pending' || undefined} className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed">
        Refresh the board
      </Button>
      {/* The longest line sits invisible in the same grid cell as the live one: the box is the same size in every state, and on a narrow notice it wraps under the button as one piece (no fixed width, no shift). */}
      <span aria-hidden="true" className="grid text-[var(--color-muted-foreground)]">
        <span className="invisible col-start-1 row-start-1">{FAILED}</span>
        <span className="col-start-1 row-start-1">{status}</span>
      </span>
    </div>
  )
}
