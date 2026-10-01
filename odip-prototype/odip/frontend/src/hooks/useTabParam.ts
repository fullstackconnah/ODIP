import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A page's active tab, kept in the URL as `?tab=` so a reload, a bookmark and a shared link all land on the same tab.
 *
 *   const TAB_KEYS = ['overview', 'bookings', 'history'] as const
 *   const [tab, setTab] = useTabParam(TAB_KEYS, 'overview')
 *   <Tabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="Trip sections" />
 *
 * - The URL is the only source of truth (no copy in component state), so a link to `?tab=bookings` clicked while the page is
 *   already open switches it too.
 * - A `?tab=` that is not one of `keys` reads as `defaultKey`; `setTab` ignores a key that is not in `keys`.
 * - `setTab` writes with `replace`, so switching tabs does not stack history entries (Back still leaves the page), keeps every
 *   other query param, and deletes `tab` when it is the default so the default tab has the clean URL.
 */
export function useTabParam<T extends string>(keys: readonly T[], defaultKey: T): [tab: T, setTab: (tab: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('tab')
  const tab = raw !== null && (keys as readonly string[]).includes(raw) ? (raw as T) : defaultKey
  const setTab = useCallback(
    (next: string) => {
      if (!(keys as readonly string[]).includes(next)) return
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          if (next === defaultKey) params.delete('tab')
          else params.set('tab', next)
          return params
        },
        { replace: true },
      )
    },
    [keys, defaultKey, setSearchParams],
  )
  return [tab, setTab]
}
