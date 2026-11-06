/**
 * Whether the server has an address lookup at all. The first 404 from it means no Google key is set, so no address field makes another request for the rest of
 * the page load. A module object, not state: every AddressField on the page shares it, and a field mounted later starts plain.
 * shortcut: a flag, not a config endpoint; a key set on live shows up at the next page load.
 */
export const addressLookup = { off: false }

/** The server answered 404: there is no key. */
export function switchAddressLookupOff() { addressLookup.off = true }

/** For tests: a fresh page load. */
export function resetAddressLookup() { addressLookup.off = false }
