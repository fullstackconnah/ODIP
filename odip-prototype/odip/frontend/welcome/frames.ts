// On phones a screen scrolls sideways inside its own frame so its text stays legible.
// A scrollable region must be reachable by keyboard, so it gets focus and a name only while it really scrolls.
// It is a plain group (not a landmark) named after its own caption, so seven frames do not become seven
// identical "region" landmarks. While more of the screen is hidden to the right, a fade and a hint say so.

export function captionOf(frame: HTMLElement): string {
  const caption = frame.closest('figure')?.querySelector('figcaption')
  if (!caption) return ''
  const copy = caption.cloneNode(true) as HTMLElement
  copy.querySelectorAll('.tag, .screen__hint').forEach((n) => n.remove())
  return copy.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

export function initScrollFrames(doc: Document = document, win: Window = window): { destroy(): void } {
  const frames = Array.from(doc.querySelectorAll<HTMLElement>('.screen__frame'))

  function fade(frame: HTMLElement) {
    const view = frame.parentElement
    if (!view?.classList.contains('screen__view')) return
    const more = frame.scrollLeft + frame.clientWidth < frame.scrollWidth - 2
    view.toggleAttribute('data-fade', more)
  }

  function sync() {
    for (const frame of frames) {
      const scrolls = frame.scrollWidth > frame.clientWidth + 1
      const hint = frame.closest('figure')?.querySelector<HTMLElement>('.screen__hint')
      if (hint) hint.hidden = !scrolls
      if (scrolls) {
        const name = captionOf(frame)
        frame.tabIndex = 0
        frame.setAttribute('role', 'group')
        frame.setAttribute('aria-label', name ? `Screen: ${name}, scrolls sideways` : 'Screen, scrolls sideways')
      } else {
        frame.removeAttribute('tabindex')
        frame.removeAttribute('role')
        frame.removeAttribute('aria-label')
      }
      fade(frame)
    }
  }

  const onScroll = (event: Event) => fade(event.currentTarget as HTMLElement)
  frames.forEach((frame) => frame.addEventListener('scroll', onScroll, { passive: true }))
  win.addEventListener('resize', sync)
  sync()
  return {
    destroy() {
      frames.forEach((frame) => frame.removeEventListener('scroll', onScroll))
      win.removeEventListener('resize', sync)
    },
  }
}
