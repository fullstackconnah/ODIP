// A chart card's remembered hide choice, per device.

/** '1' hidden, '0' shown, anything else (or storage unreadable) null: the card then follows its width. */
export function readHidden(key: string): boolean | null {
  try {
    const v = window.localStorage.getItem(key)
    return v === '1' ? true : v === '0' ? false : null
  } catch { return null }
}
export function writeHidden(key: string, hidden: boolean) {
  try { window.localStorage.setItem(key, hidden ? '1' : '0') } catch { /* the choice just isn't remembered */ }
}
