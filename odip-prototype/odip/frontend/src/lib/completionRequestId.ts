/**
 * Generates the idempotency key used only for an intake completion request.
 * `randomUUID` is secure-context-only, while `getRandomValues` is available in
 * browser contexts such as non-loopback HTTP that still expose Web Crypto.
 */
export function newCompletionRequestId(): string {
  const webCrypto = globalThis.crypto
  const nativeRandomUuid = webCrypto?.randomUUID
  if (typeof nativeRandomUuid === 'function') return nativeRandomUuid.call(webCrypto)

  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new Error('Secure Web Crypto entropy is unavailable; cannot create a completion request identifier.')
  }

  const bytes = webCrypto.getRandomValues(new Uint8Array(16))
  // RFC 4122 section 4.4: version 4 and the RFC 4122 variant.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
