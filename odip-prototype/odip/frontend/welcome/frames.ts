// On phones a screen scrolls sideways inside its own frame so its text stays legible.
// A scrollable region must be reachable by keyboard, so it gets focus and a name only while it really scrolls.

export function initScrollFrames(doc: Document = document, win: Window = window): { destroy(): void } {
  const frames = Array.from(doc.querySelectorAll<HTMLElement>('.screen__frame'))

  function sync() {
    for (const frame of frames) {
      if (frame.scrollWidth > frame.clientWidth + 1) {
        frame.tabIndex = 0
        frame.setAttribute('role', 'region')
        frame.setAttribute('aria-label', 'Screen, scrolls sideways')
      } else {
        frame.removeAttribute('tabindex')
        frame.removeAttribute('role')
        frame.removeAttribute('aria-label')
      }
    }
  }

  win.addEventListener('resize', sync)
  sync()
  return { destroy: () => win.removeEventListener('resize', sync) }
}
