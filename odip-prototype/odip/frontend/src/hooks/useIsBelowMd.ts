import { useMediaQuery } from './useMediaQuery'

/** Tailwind's `md` breakpoint in its own unit (48rem = 768px), so this switch and the `md:` classes flip together (see useIsBelowLg). */
const MD_UP_QUERY = '(min-width: 48rem)'

/** Whether the viewport is narrower than Tailwind's `md`: the roster board offers drag and drop from md up only (decision 10); phones keep the tap menus. */
export function useIsBelowMd(): boolean {
  // Without matchMedia (jsdom) the fallback is false, so this is true: assume a phone, no drag and drop.
  return !useMediaQuery(MD_UP_QUERY, false)
}
