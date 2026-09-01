import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_UI_PREFERENCES, readUiPreferences, writeUiPreferences, type UiPreferences } from '@/lib/uiPreferences'

/**
 * Resolves the signed-in (or, under SuperAdmin "view as", the currently-impersonated) user's id
 * from the `odip_user` localStorage entry the auth layer maintains — mirrors the exact
 * `JSON.parse(localStorage.getItem('odip_user') || '{}')` + `id ?? null` idiom used throughout
 * the app (see `usePermissions` in `src/lib/permissions.ts`) rather than introducing a second
 * parser for the same blob.
 */
function getCurrentUserId(): string | null {
  try {
    const user = JSON.parse(localStorage.getItem('odip_user') || '{}') as Record<string, unknown>
    return (user?.id as string | undefined) ?? null
  } catch {
    return null
  }
}

type UiPreferencesContextValue = {
  prefs: UiPreferences
  setPref: <K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => void
}

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null)

/**
 * Mounted once inside the authenticated app shell (see `App.tsx`). Note: both UserSwitcher
 * ("view as user") and TenantSwitcher ("view as tenant") change `odip_user` and then call
 * `window.location.reload()` — a full reload remounts the whole React tree, so this provider
 * always re-resolves the current user id and re-reads preferences fresh on the next mount. There
 * is no live, same-render user-switch path to handle.
 *
 * This file is plain `.ts` (not `.tsx`), so the provider element is built with `createElement`
 * rather than JSX syntax.
 */
export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const userId = useMemo(() => getCurrentUserId(), [])
  const [prefs, setPrefs] = useState<UiPreferences>(() => readUiPreferences(userId))

  const setPref = useCallback(<K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: value }
      writeUiPreferences(userId, next)
      return next
    })
  }, [userId])

  const value = useMemo(() => ({ prefs, setPref }), [prefs, setPref])

  return createElement(UiPreferencesContext.Provider, { value }, children)
}

/**
 * Falls back to defaults (with a no-op `setPref`) when called outside `UiPreferencesProvider`
 * instead of throwing — DataTable is exercised in tests that render it unwrapped.
 */
export function useUiPreferences(): UiPreferencesContextValue {
  const ctx = useContext(UiPreferencesContext)
  if (!ctx) {
    return { prefs: DEFAULT_UI_PREFERENCES, setPref: () => {} }
  }
  return ctx
}
