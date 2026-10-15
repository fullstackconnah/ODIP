/** Every key a tenant or user switch writes; the API client sends the viewed tenant and user from them on every request. */
const VIEW_KEYS = ['odip_user', 'odip_superadmin_user', 'odip_viewing_user', 'odip_viewing_tenant', 'odip_last_tenant'] as const

/** Anything the person can do first: a bare click or submit comes from a screen reader in browse mode, voice control or a scripted click. */
const FIRST_ACTS = ['pointerdown', 'keydown', 'click', 'submit'] as const

/**
 * Writes a view-as switch to storage, then reloads into it. A dirty form's "Leave site?" can cancel that reload; the page then lives on
 * with the new keys, and its next save would go to the other organisation. So the first press, key, click or submit after staying, caught
 * before any handler acts on it, puts the old values back. A reload that goes ahead takes the listeners with the page, and the next page reads the
 * new keys. (A timer can't tell the two apart: the old page keeps running while a slow reload loads, and would undo a real switch.)
 */
export function switchViewAndReload(write: () => void) {
  const before = VIEW_KEYS.map(key => [key, localStorage.getItem(key)] as const)
  write()
  const disarm = () => {
    for (const act of FIRST_ACTS) window.removeEventListener(act, restore, true)
    window.removeEventListener('pagehide', disarm)
  }
  const restore = () => {
    for (const [key, value] of before) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
    disarm()
  }
  for (const act of FIRST_ACTS) window.addEventListener(act, restore, true)
  // The page is going: the reload went ahead, so there is nothing to put back.
  window.addEventListener('pagehide', disarm)
  window.location.reload()
}
