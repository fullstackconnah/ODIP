// An address is the whole of someone's sign-in, and any address can sign in, so one that is at neither the tenant's own domain nor a common email
// provider (a typo, another organisation's) is a live login for whoever owns it. The SERVER decides which addresses those are (it holds the one list
// of providers and knows the tenant's domain) and refuses the first attempt with a 400 carrying this code. The screens never hold a copy of the
// list: they ask the admin to check the address, and on "Use this address" send the same request again with `addressConfirmed: true`.

/** The `code` of the 400 that asks for the confirmation. */
export const ADDRESS_NEEDS_CONFIRMATION = 'AddressNeedsConfirmation'

const FALLBACK =
  "This address is not at your organisation's domain or a common email provider. The sign-in link goes to whoever owns it. Check it is right."

/**
 * The sentence to ask the admin to check, when this failure is the server asking for a confirmation of the address; otherwise null, and the
 * failure is shown as the error it is.
 */
export function addressConfirmationRequest(err: unknown): string | null {
  const response = (err as { response?: { status?: number; data?: { code?: string; errors?: string[] } } } | null | undefined)?.response
  if (response?.status !== 400 || response.data?.code !== ADDRESS_NEEDS_CONFIRMATION) return null
  return response.data.errors?.[0] ?? FALLBACK
}
