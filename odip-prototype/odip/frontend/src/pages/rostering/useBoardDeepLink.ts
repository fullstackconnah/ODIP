import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { SetURLSearchParams } from 'react-router-dom'
import type { GroupActivityDto, RosterBoardDto } from '@/api/types'
import type { ShiftSlideOverTarget } from './components'
import type { ActivityModalTarget } from './components/GroupActivityModal'
import { allBoardShifts } from './lib/roster'

type Args = {
  searchParams: URLSearchParams
  setSearchParams: SetURLSearchParams
  board: RosterBoardDto | undefined
  weekStart: string
  setSlideOverTarget: Dispatch<SetStateAction<ShiftSlideOverTarget | null>>
  groupActivities: GroupActivityDto[] | null
  activityTarget: ActivityModalTarget | null
  setActivityTarget: Dispatch<SetStateAction<ActivityModalTarget | null>>
}

/** Opens the shift or activity named by `?shift=` / `?activity=` once its week has loaded, moved verbatim out of RosterBoardPage. */
export function useBoardDeepLink({ searchParams, setSearchParams, board, weekStart, setSlideOverTarget, groupActivities, activityTarget, setActivityTarget }: Args) {
  // `?shift=<id>` (a shift clicked on a person's roster week, spec 2026-10-28) opens that shift's editor once its week has loaded. Read once, then dropped from the address with replace.
  const [pendingShiftId, setPendingShiftId] = useState(() => searchParams.get('shift'))
  useEffect(() => {
    if (searchParams.has('shift')) setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('shift'); return p }, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once, on mount
  // Render-time, like the ?date= block above: no effect for state.
  if (pendingShiftId && board && board.weekStart === weekStart) {
    setPendingShiftId(null)
    const shift = allBoardShifts(board).find(s => s.id === pendingShiftId)
    if (shift) setSlideOverTarget({ mode: 'edit', shift })
  }
  // `?activity=<id>` (a row on the Group activities list) opens that activity's modal once its week has loaded. An id that is not on the loaded board (cancelled, another week, Staff view) opens the board plain.
  // The param stays while the modal is open and is dropped once nothing is open or pending.
  const [pendingActivityId, setPendingActivityId] = useState(() => searchParams.get('activity'))
  if (pendingActivityId && board && board.weekStart === weekStart) {
    setPendingActivityId(null)
    if (groupActivities?.some(a => a.id === pendingActivityId)) setActivityTarget({ mode: 'edit', id: pendingActivityId })
  }
  useEffect(() => {
    if (pendingActivityId === null && activityTarget === null && searchParams.has('activity')) setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('activity'); return p }, { replace: true })
  }, [pendingActivityId, activityTarget, searchParams, setSearchParams])
}
