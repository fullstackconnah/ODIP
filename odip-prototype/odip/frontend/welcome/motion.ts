/** The day's motion (SHAPE section 9). Slots arrive once; the "now" dot follows the slot in the centre band. Observers only, no scroll handlers. */
export function initDay(doc: Document = document): void {
  const win = doc.defaultView!
  const slots = Array.from(doc.querySelectorAll<HTMLElement>('.slot'))
  const arrived = (s: Element) => s.setAttribute('data-in', '')
  if (typeof win.IntersectionObserver !== 'function') return slots.forEach(arrived) // no hidden starts without observers
  // A slot already in view (a deep link, a reload mid-page) arrives now, before the hidden starts exist, so it never flashes.
  for (const s of slots) {
    const r = s.getBoundingClientRect()
    if (r.top < win.innerHeight * 0.88 && r.bottom > 0) arrived(s)
  }
  // The fragment target too: the browser may not have scrolled to it yet when this deferred module runs.
  let hashed: Element | null = null
  try {
    hashed = win.location.hash ? doc.getElementById(decodeURIComponent(win.location.hash.slice(1)))?.closest('.slot') ?? null : null
  } catch {
    /* a malformed #% hash */
  }
  if (hashed) arrived(hashed)
  const arrive = new win.IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      arrived(e.target)
      arrive.unobserve(e.target)
    }
  }, { rootMargin: '0px 0px -12% 0px' })
  slots.filter((s) => !s.hasAttribute('data-in')).forEach((s) => arrive.observe(s))

  const rail = doc.querySelector('.rail')
  const dot = rail?.querySelector<HTMLElement>('.rail__dot')
  const stops = Array.from(rail?.querySelectorAll<HTMLElement>('[data-for]') ?? [])
  if (dot && stops.length) {
    let current = stops.find((s) => s.classList.contains('is-now')) ?? stops[0]
    // On the dot itself, never a parent variable, so a fast scroll retargets the running transition from where it is.
    const place = () => {
      dot.style.transform = `translateY(${current.offsetTop}px)`
    }
    const centre = new win.IntersectionObserver((entries) => {
      for (const e of entries) {
        const stop = e.isIntersecting && stops.find((s) => s.dataset.for === (e.target as HTMLElement).id)
        if (!stop || stop === current) continue
        current.classList.remove('is-now')
        stop.classList.add('is-now')
        current = stop
        place()
      }
    }, { rootMargin: '-45% 0px -50% 0px' })
    slots.forEach((s) => centre.observe(s))
    win.addEventListener('resize', place)
    place()
  }
  doc.documentElement.classList.add('js') // last: if anything above threw, nothing was hidden
}
