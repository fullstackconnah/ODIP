import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { resetAddressLookup } from '@/lib/addressLookupState'

/** The one suggestion the stubbed proxy offers, and the place it resolves to (the same as caller A's pick test). */
export const SUGGESTION = { placeId: 'p1', mainText: '12 Example Street', secondaryText: 'Brisbane City QLD' }
export const DETAILS = { street: '12 Example Street', suburb: 'Brisbane City', state: 'QLD', postcode: '4000', formattedAddress: '12 Example Street, Brisbane City QLD 4000' }

/** For `vi.mock('@/api/client', async o => withAddressApi(await o()))`: the address proxy answers; every other call is the module's own. */
export function withAddressApi<T extends { apiPost: (...a: never[]) => unknown; apiGet: (...a: never[]) => unknown }>(real: T): T {
  return {
    ...real,
    apiPost: (path: string, ...rest: never[]) => path === '/address/suggest' ? Promise.resolve([SUGGESTION]) : (real.apiPost as (...a: unknown[]) => unknown)(path, ...rest),
    apiGet: (path: string, ...rest: never[]) => path === '/address/details' ? Promise.resolve(DETAILS) : (real.apiGet as (...a: unknown[]) => unknown)(path, ...rest),
  }
}

/** Types into an address combobox, picks the first suggestion and waits for "Address filled in.". */
export async function pickAddress(user: UserEvent, input: HTMLElement, text = '12 Exa') {
  resetAddressLookup()
  await user.click(input)
  await user.type(input, text)
  const list = await screen.findByRole('listbox', { name: 'Address suggestions' })
  await user.click(within(list).getByRole('option'))
  await screen.findByText('Address filled in.')
}
