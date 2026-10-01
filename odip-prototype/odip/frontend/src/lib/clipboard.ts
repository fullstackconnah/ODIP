/**
 * Copies `text` to the clipboard and says whether it worked. It never throws.
 *
 * `navigator.clipboard` exists only in a secure context (https or localhost). This app is also served over plain http on the LAN, where it is
 * undefined, so a bare `navigator.clipboard.writeText(...)` threw an uncaught TypeError and copied nothing (L5-07). The async clipboard is tried
 * first (it needs no element and no focus); when it is missing or refuses (permission denied, an unfocused document), a selection copy runs
 * instead: a temporary off-screen textarea, selected, and `execCommand('copy')`.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the selection copy
  }
  return selectionCopy(text)
}

function selectionCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.setAttribute('aria-hidden', 'true')
  field.style.position = 'fixed'
  field.style.top = '0'
  field.style.left = '-9999px'
  field.style.opacity = '0'
  const active = document.activeElement as HTMLElement | null
  document.body.appendChild(field)
  try {
    field.focus()
    field.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(field)
    active?.focus?.()
  }
}
