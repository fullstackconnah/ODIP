import { useCallback, useState } from 'react'

export type BoardViewMode = 'participant' | 'staff'

const STORAGE_KEY = 'odip.roster.boardView'

function readStored(): BoardViewMode {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === 'staff' ? 'staff' : 'participant'
  } catch {
    // sessionStorage unavailable (private browsing, etc.) — fall back to the default view.
    return 'participant'
  }
}

/**
 * The board's participant/staff grouping toggle, persisted in sessionStorage so it survives
 * navigating away and back within the same tab session without outliving the session itself.
 * Participant is the default view per the rostering pass-2 spec.
 */
export function useBoardViewMode(): [BoardViewMode, (mode: BoardViewMode) => void] {
  const [mode, setModeState] = useState<BoardViewMode>(readStored)

  const setMode = useCallback((next: BoardViewMode) => {
    setModeState(next)
    try {
      window.sessionStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore — nothing to persist to
    }
  }, [])

  return [mode, setMode]
}
