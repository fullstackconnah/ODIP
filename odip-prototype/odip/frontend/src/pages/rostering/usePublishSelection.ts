import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RosterBoardDto, ShiftDto } from '@/api/types'
import { isUnfilledShift } from './lib/roster'
import { isBlocked } from './lib/rosterWeek'
import type { BoardViewMode } from './lib/useBoardViewMode'

type Args = {
  board: RosterBoardDto | undefined
  boardShifts: ShiftDto[]
  weekStart: string
  groupBy: BoardViewMode
  participantFilter: string
  regionFilter: string
  unfilledOnly: boolean
  canWrite: boolean
}

/** The Publish week drafts and the select-mode (publish several) state of the roster board, moved verbatim out of RosterBoardPage. */
export function usePublishSelection({ board, boardShifts, weekStart, groupBy, participantFilter, regionFilter, unfilledOnly, canWrite }: Args) {
  const drafts = useMemo(() => boardShifts.filter(s => s.status === 'Draft' && !s.groupActivityId && !isUnfilledShift(s)), [boardShifts])
  const heldDrafts = useMemo(() => boardShifts.filter(s => s.status === 'Draft' && !s.groupActivityId && isUnfilledShift(s)).length, [boardShifts])
  const draftActivities = useMemo(() => (board?.groupActivitiesEnabled === true ? (board.groupActivities ?? []).filter(a => a.status === 'Draft') : []), [board])
  // Only an explicit false is unstarted: a board without the field (old fixtures) reads as started.
  const unstarted = board?.weekStarted === false
  const blocked = useMemo(() => drafts.filter(isBlocked), [drafts])
  const publishable = useMemo(() => drafts.filter(s => !isBlocked(s)), [drafts])
  // What Publish week would send: select mode picks shifts only, so this is for the whole-week button, banner and leave guard.
  const weekPublishable = publishable.length + draftActivities.length
  // Select mode (R3, publish several): a writer ticks Drafts on the board and publishes just those. Keyed to the toolbar (week, view, filters), so any toolbar change leaves the mode with the selection; a render-time reset, as the pickers above.
  const toolbarKey = [weekStart, groupBy, participantFilter, regionFilter, unfilledOnly].join('|')
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null)
  if (selection && (selection.key !== toolbarKey || !canWrite || publishable.length === 0)) setSelection(null)
  const selecting = selection !== null
  const publishableIds = useMemo(() => new Set(publishable.map(s => s.id)), [publishable])
  // A draft someone else published, deleted or blocked drops out of the selection on the next render, and the count follows.
  const chosen = useMemo(() => (selection ? publishable.filter(s => selection.ids.has(s.id)) : []), [selection, publishable])
  const chosenIds = useMemo(() => new Set(chosen.map(s => s.id)), [chosen])
  const toggleChosen = useCallback((shift: ShiftDto) => setSelection(prev => {
    if (!prev) return prev
    const ids = new Set(prev.ids)
    if (!ids.delete(shift.id)) ids.add(shift.id)
    return { ...prev, ids }
  }), [])
  // Focus: the count when the mode opens (it mounts then), Select shifts when Cancel or Escape closes it (it mounts then).
  const returnFocusToSelect = useRef(false)
  const focusCount = useCallback((el: HTMLElement | null) => el?.focus(), [])
  const focusSelectButton = useCallback((el: HTMLButtonElement | null) => { if (el && returnFocusToSelect.current) { returnFocusToSelect.current = false; el.focus() } }, [])
  const leaveSelecting = () => { returnFocusToSelect.current = true; setSelection(null) }
  // Escape closes the topmost layer only: a capture listener sees a dialog, listbox or menu that Escape is about to close, so it leaves the mode alone.
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role=alertdialog], [role=dialog], [role=listbox], [role=menu]')) return
      returnFocusToSelect.current = true
      setSelection(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [selecting])
  return { drafts, heldDrafts, draftActivities, unstarted, blocked, publishable, weekPublishable, toolbarKey, setSelection, selecting, publishableIds, chosen, chosenIds, toggleChosen, focusCount, focusSelectButton, leaveSelecting }
}
