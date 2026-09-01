/**
 * GEN-2: per-device UI preferences, namespaced per signed-in user so switching accounts (or
 * SuperAdmin "view as" impersonation, which overwrites `odip_user` in place — see UserSwitcher)
 * doesn't leak one user's table-appearance choice onto another user sharing the same browser.
 *
 * Stored as a JSON object (not a bare boolean) under `odip_ui_prefs:<userId>` so more
 * preferences can be added later without a storage-format migration.
 */
export type UiPreferences = {
  tableVerticalDividers: boolean
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  tableVerticalDividers: false,
}

function storageKey(userId: string): string {
  return `odip_ui_prefs:${userId}`
}

/**
 * Reads stored preferences for `userId`, falling back to defaults for anything missing,
 * malformed, or unreadable. Never throws — a throwing localStorage (Safari private mode) or a
 * corrupt/unexpected stored value both degrade to `DEFAULT_UI_PREFERENCES` rather than crashing
 * the caller.
 */
export function readUiPreferences(userId: string | null): UiPreferences {
  if (userId === null) return { ...DEFAULT_UI_PREFERENCES }

  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return { ...DEFAULT_UI_PREFERENCES }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ...DEFAULT_UI_PREFERENCES }
    }

    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_UI_PREFERENCES }

    const candidate = parsed as Record<string, unknown>
    const tableVerticalDividers =
      typeof candidate.tableVerticalDividers === 'boolean'
        ? candidate.tableVerticalDividers
        : DEFAULT_UI_PREFERENCES.tableVerticalDividers

    return { tableVerticalDividers }
  } catch {
    // localStorage itself threw (e.g. Safari private mode) — degrade to defaults.
    return { ...DEFAULT_UI_PREFERENCES }
  }
}

/**
 * Persists `prefs` for `userId`. A no-op when `userId` is null (no signed-in user to scope the
 * preference to) and swallows any localStorage failure (quota exceeded, private-mode throw)
 * rather than surfacing it to the caller — a failed preference write should never break the UI
 * interaction that triggered it.
 */
export function writeUiPreferences(userId: string | null, prefs: UiPreferences): void {
  if (userId === null) return

  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(prefs))
  } catch {
    // Ignore — e.g. Safari private mode or storage quota exceeded.
  }
}
