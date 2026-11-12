import { useEffect, useRef, useState } from 'react'
import { useMyUiPreferences, useSaveUiPreferences } from '@/api/hooks'

export type ScheduleView = 'days' | 'list'

const VIEW_STORAGE_KEY = 'odip.itinerary.view'
const isView = (v: unknown): v is ScheduleView => v === 'days' || v === 'list'

function readStoredView(): ScheduleView | null {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    return isView(stored) ? stored : null
  } catch {
    return null
  }
}

function writeStoredView(view: ScheduleView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // private browsing / quota: the toggle still works for this session
  }
}

/**
 * The itinerary's By day | List choice. The browser copy is the instant value and the offline fallback; the person's saved server value
 * replaces it once, when it first arrives, unless they have already switched. A switch updates the browser copy and sends one PUT;
 * a failed GET or PUT is silent (the toggle and the browser copy carry on).
 */
export function useItineraryView(): [ScheduleView, (view: ScheduleView) => void] {
  const [view, setViewState] = useState<ScheduleView>(() => readStoredView() ?? 'days')
  const settled = useRef(false) // the server value has been applied, or the person has chosen
  const { data } = useMyUiPreferences()
  const { mutate: save } = useSaveUiPreferences()
  const serverView = data?.itineraryView

  useEffect(() => {
    if (settled.current || !isView(serverView)) return
    settled.current = true
    setViewState(serverView)
    writeStoredView(serverView)
  }, [serverView])

  const setView = (next: ScheduleView) => {
    settled.current = true
    setViewState(next)
    writeStoredView(next)
    save({ itineraryView: next })
  }
  return [view, setView]
}
