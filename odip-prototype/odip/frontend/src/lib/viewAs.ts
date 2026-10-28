/**
 * The organisation and user a SuperAdmin is viewing as. Kept in sessionStorage so it belongs to ONE tab: localStorage is shared, and a switch in
 * another tab would otherwise change the headers of a form still open for the old organisation. A new tab starts un-switched; a reload keeps the choice.
 */
export type ViewAsKey = 'odip_viewing_tenant' | 'odip_viewing_user'

export function getViewAs(key: ViewAsKey): string | null {
  try {
    const own = sessionStorage.getItem(key)
    if (own !== null) return own
    // A value saved before this moved: this tab takes it once, and no other tab can.
    const legacy = localStorage.getItem(key)
    if (legacy !== null) {
      sessionStorage.setItem(key, legacy)
      localStorage.removeItem(key)
    }
    return legacy
  } catch { return null }
}

export function setViewAs(key: ViewAsKey, value: string): void {
  try { sessionStorage.setItem(key, value) } catch { /* storage blocked: nothing to remember */ }
}

/** Clears both stores, so a legacy localStorage value cannot be taken back in. */
export function clearViewAs(key: ViewAsKey): void {
  try { sessionStorage.removeItem(key); localStorage.removeItem(key) } catch { /* storage blocked */ }
}
