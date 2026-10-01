// Scroll motion for the landing page. One authored moment, driven by scroll:
// the route line draws down the strip, each fold unfolds as it arrives, the landscape drifts,
// and the distance marker counts down to "Early access 0 km".
// Everything is visible and static by default: no listeners at all when the visitor prefers reduced motion.

import { clamp01, currentFold, kmAt, routeFill, sectionProgress, unfoldAmount } from './motion-math'

export function initMotion(doc: Document = document, win: Window = window): { destroy(): void } {
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)')
  const wide = win.matchMedia('(min-width: 1024px)')
  const hero = doc.querySelector<HTMLElement>('.hero')
  const strip = doc.querySelector<HTMLElement>('.strip')
  const tour = doc.querySelector<HTMLElement>('.tour')
  const country = doc.querySelector<HTMLElement>('.tour__country')
  const folds = Array.from(doc.querySelectorAll<HTMLElement>('[data-fold]'))
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('[data-stop]'))
  const odo = doc.querySelector<HTMLElement>('[data-odo]')
  const status = doc.querySelector<HTMLElement>('[data-stops-status]')
  const prev = doc.querySelector<HTMLButtonElement>('[data-step="prev"]')
  const next = doc.querySelector<HTMLButtonElement>('[data-step="next"]')
  const names = folds.map((f) => f.querySelector('.sign__label')?.textContent?.trim() ?? '')

  let frame = 0
  let current = -1

  function clear() {
    hero?.style.removeProperty('--drift')
    country?.style.removeProperty('--drift')
    for (const fold of folds) {
      fold.style.removeProperty('--fill')
      fold.style.removeProperty('--unfold')
      fold.classList.remove('is-folding')
    }
    links.forEach((a) => a.removeAttribute('aria-current'))
    if (odo) odo.textContent = '60'
  }

  function update() {
    frame = 0
    if (reduce.matches) return
    const vh = win.innerHeight
    if (hero) hero.style.setProperty('--drift', clamp01(win.scrollY / Math.max(1, hero.offsetHeight)).toFixed(3))
    if (country && tour) {
      const t = tour.getBoundingClientRect()
      country.style.setProperty('--drift', sectionProgress(t.top, t.height, vh).toFixed(3))
    }
    if (!strip || folds.length === 0) return

    const readingLine = vh * 0.6
    const rects = folds.map((f) => f.getBoundingClientRect())
    const folding = wide.matches
    folds.forEach((fold, i) => {
      const r = rects[i]
      fold.style.setProperty('--fill', routeFill(r.top, r.height, readingLine).toFixed(3))
      if (folding) {
        const open = unfoldAmount(r.top, vh)
        fold.style.setProperty('--unfold', open.toFixed(3))
        fold.classList.toggle('is-folding', open < 0.995)
      } else {
        fold.style.removeProperty('--unfold')
        fold.classList.remove('is-folding')
      }
    })

    const s = strip.getBoundingClientRect()
    if (odo) odo.textContent = String(kmAt((readingLine - s.top) / s.height))

    const index = currentFold(rects, readingLine)
    if (index !== current) {
      current = index
      links.forEach((a, i) => (i === index ? a.setAttribute('aria-current', 'step') : a.removeAttribute('aria-current')))
      prev?.setAttribute('aria-disabled', String(index <= 0))
      next?.setAttribute('aria-disabled', String(index >= folds.length - 1))
    }
  }

  function schedule() {
    if (!frame) frame = win.requestAnimationFrame(update)
  }

  function go(delta: number) {
    const target = Math.min(folds.length - 1, Math.max(0, current + delta))
    if (current < 0 && delta < 0) return
    const fold = folds[target]
    if (!fold) return
    fold.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'start' })
    if (status) status.textContent = `Stop ${target + 1} of ${folds.length}: ${names[target]}`
  }

  const onPrev = () => go(-1)
  const onNext = () => go(1)
  function onPreferenceChange() {
    if (reduce.matches) clear()
    else schedule()
  }

  win.addEventListener('scroll', schedule, { passive: true })
  win.addEventListener('resize', schedule)
  prev?.addEventListener('click', onPrev)
  next?.addEventListener('click', onNext)
  reduce.addEventListener('change', onPreferenceChange)
  wide.addEventListener('change', onPreferenceChange)
  schedule()

  return {
    destroy() {
      win.removeEventListener('scroll', schedule)
      win.removeEventListener('resize', schedule)
      prev?.removeEventListener('click', onPrev)
      next?.removeEventListener('click', onNext)
      reduce.removeEventListener('change', onPreferenceChange)
      wide.removeEventListener('change', onPreferenceChange)
      if (frame) win.cancelAnimationFrame(frame)
      clear()
    },
  }
}
