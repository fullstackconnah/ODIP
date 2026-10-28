/**
 * The organisation and user a SuperAdmin is viewing as. Kept in sessionStorage so it belongs to ONE tab: localStorage is shared, and a switch in
 * another tab would otherwise change the headers of a form still open for the old organisation. A new tab starts un-switched; a reload keeps the choice.
 * `odip_viewing_profile` is the viewed user's profile (the signed-in blob with their id, name and role); `odip_user` stays the SuperAdmin's own.
 */
export type ViewAsKey = 'odip_viewing_tenant' | 'odip_viewing_user' | 'odip_viewing_profile'

/** The old switcher overwrote localStorage `odip_user` with the viewed user and kept the SuperAdmin's own in `odip_superadmin_user`. Put it right, once. */
function migrateLegacyProfile(): void {
  const admin = localStorage.getItem('odip_superadmin_user')
  if (admin === null) return
  if (localStorage.getItem('odip_viewing_user') !== null && sessionStorage.getItem('odip_viewing_profile') === null) {
    const viewed = localStorage.getItem('odip_user')
    if (viewed !== null) sessionStorage.setItem('odip_viewing_profile', viewed)
  }
  localStorage.setItem('odip_user', admin)
  localStorage.removeItem('odip_superadmin_user')
}

export function getViewAs(key: ViewAsKey): string | null {
  try {
    migrateLegacyProfile()
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

/** Clears both stores, so a legacy localStorage value cannot be taken back in. Ending the view of a user ends their profile with it. */
export function clearViewAs(key: ViewAsKey): void {
  try {
    sessionStorage.removeItem(key); localStorage.removeItem(key)
    if (key === 'odip_viewing_user') clearViewAs('odip_viewing_profile')
  } catch { /* storage blocked */ }
}

/** The profile this tab acts as: the viewed user's while viewing as one, else the signed-in user's own. */
export function currentProfile(): Record<string, unknown> {
  try {
    return JSON.parse(getViewAs('odip_viewing_profile') ?? localStorage.getItem('odip_user') ?? '{}')
  } catch { return {} }
}
