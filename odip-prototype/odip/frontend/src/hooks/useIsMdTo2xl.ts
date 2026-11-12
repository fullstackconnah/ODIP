import { useMediaQuery } from './useMediaQuery'

/** Tailwind's `md` up to just under `2xl` (48rem to 96rem) in rem, so this switch and the `md:` / `2xl:` classes flip together (see useIsMdToXl). */
const MD_TO_2XL_QUERY = '(min-width: 48rem) and (max-width: 95.99rem)'

/** Whether the viewport is from `md` up to below `2xl`: the invoice tables stack the Payment pill under the status there instead of giving it a column. */
export function useIsMdTo2xl(): boolean {
  // Without matchMedia (jsdom, the server) the fallback is false: the full layout.
  return useMediaQuery(MD_TO_2XL_QUERY, false)
}
