/**
 * Scrolls an element into view by the least distance (`block: 'nearest'`: nothing moves if it is already on screen), smoothly while motion is allowed and instantly under `prefers-reduced-motion` or where the
 * browser cannot say (jsdom has no `matchMedia`). Does nothing for no element, or one the environment cannot scroll (jsdom has no `scrollIntoView`).
 *
 * For a block a person needs to see and cannot ask for: a refusal at the foot of a long form, a card that has just grown below the fold. Not for scrolling on every change: it would fight a person who is
 * working somewhere else on the same screen.
 */
export function bringIntoView(element: Element | null | undefined): void {
  if (!element || typeof element.scrollIntoView !== 'function') return
  const reduced = typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
}
