// The section index (left margin on desktop, the bottom pill on phones) lights the section being read.
// One nav element; aria-current="location" marks the current link. Native anchor links do the moving.

/** The last section whose top has passed the reading line, or -1 above the first one. */
export function currentSection(tops: number[], line: number): number {
  let index = -1
  tops.forEach((top, i) => {
    if (top <= line) index = i
  })
  return index
}

export function initSections(doc: Document = document, win: Window = window): { destroy(): void } {
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('[data-section-link]'))
  const targets = links.map((a) => doc.getElementById(decodeURIComponent(a.hash.slice(1))))
  let frame = 0
  let current = -2

  function update() {
    frame = 0
    const tops = targets.map((t) => (t ? t.getBoundingClientRect().top : Number.POSITIVE_INFINITY))
    const root = doc.documentElement
    // At the very bottom the last section is current even if its top never reaches the line.
    const scrolls = root.scrollHeight > win.innerHeight + 2
    const atEnd = scrolls && win.innerHeight + win.scrollY >= root.scrollHeight - 2
    const index = atEnd ? links.length - 1 : currentSection(tops, win.innerHeight * 0.45)
    if (index === current) return
    current = index
    links.forEach((a, i) => (i === index ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')))
  }

  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(update)
  }
  win.addEventListener('scroll', schedule, { passive: true })
  win.addEventListener('resize', schedule)
  schedule()
  return {
    destroy() {
      win.removeEventListener('scroll', schedule)
      win.removeEventListener('resize', schedule)
      if (frame) win.cancelAnimationFrame(frame)
    },
  }
}
