import { useMediaQuery } from './useMediaQuery'

/** Tailwind's `md` up to just under `xl` (48rem to 80rem) in rem, so this switch and the `md:` classes flip together (see useIsBelowMd). */
const MD_TO_XL_QUERY = '(min-width: 48rem) and (max-width: 79.99rem)'

/** Whether the viewport is from Tailwind's `md` up to below `xl`: the Leave table merges two pairs of columns there (Staff · Type, Dates · Requested). */
export function useIsMdToXl(): boolean {
  // Without matchMedia (jsdom, the server) the fallback is false: the full layout.
  return useMediaQuery(MD_TO_XL_QUERY, false)
}
