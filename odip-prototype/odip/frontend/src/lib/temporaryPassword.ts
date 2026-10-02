// A temporary password an admin hands to a new user, for demo or offline use where the emailed set-password link is not an option.
// Pure and JSX-free.
//
// Long, and drawn from Web Crypto: Math.random is not a security source. It holds one character of every class, so a stricter Firebase
// password policy than the 6-character default still accepts it. Look-alikes (0 O 1 l I) are left out because it gets read out and retyped.
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%&*?_'
const ALL = LOWER + UPPER + DIGITS + SYMBOLS

const LENGTH = 16

/**
 * A uniformly random integer in [0, max). A draw from the uneven tail of the 32-bit range is thrown away and redrawn:
 * folding it in with `%` would make the low values likelier than the high ones.
 */
function randomBelow(max: number): number {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new Error('Secure Web Crypto entropy is unavailable; cannot generate a password.')
  }
  const limit = 2 ** 32 - (2 ** 32 % max)
  const draw = new Uint32Array(1)
  do {
    webCrypto.getRandomValues(draw)
  } while (draw[0] >= limit)
  return draw[0] % max
}

/** Throws when the browser has no Web Crypto: it fails closed rather than fall back to something guessable. */
export function generateTemporaryPassword(): string {
  const chars = [LOWER, UPPER, DIGITS, SYMBOLS].map(set => set[randomBelow(set.length)])
  while (chars.length < LENGTH) chars.push(ALL[randomBelow(ALL.length)])

  // Fisher-Yates, so the one-of-each characters are not always the first four.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
