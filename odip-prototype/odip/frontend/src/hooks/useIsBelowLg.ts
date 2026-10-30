import { useMediaQuery } from './useMediaQuery'

/**
 * Tailwind's `lg` breakpoint, in the same rem unit its `lg:` variants compile to (64rem = 1024px at the default font size), so this
 * switch and the `lg:` classes of the app shell always flip together. A `max-width: 1023px` query would leave a gap at a fractional
 * width (a zoomed window of 1023.5px matches neither it nor `lg:`).
 */
const LG_UP_QUERY = '(min-width: 64rem)'

/**
 * Whether the viewport is narrower than Tailwind's `lg`, where the sidebar is a drawer; from `lg` up it is the permanent sidebar.
 * The drawer's dialog behaviour (Escape, Tab trap, scroll lock) must run only while it IS a drawer, or a stale "open" after a resize
 * would lock the page scroll and trap Tab on a desktop where the sidebar is just there. See components/README.md, useDialogBehavior.
 */
export function useIsBelowLg(): boolean {
  // Without matchMedia (jsdom) the fallback is false, so this is true: assume a phone, the drawer behaviours stay on.
  return !useMediaQuery(LG_UP_QUERY, false)
}
