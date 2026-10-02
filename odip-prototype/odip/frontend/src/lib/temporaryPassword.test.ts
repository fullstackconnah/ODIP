import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateTemporaryPassword } from './temporaryPassword'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Stands in for Web Crypto: hands out `draws` in order, then zeros, and counts the calls. */
function stubCrypto(draws: number[] = []) {
  const queue = [...draws]
  const getRandomValues = vi.fn((buffer: Uint32Array) => {
    buffer[0] = queue.shift() ?? 0
    return buffer
  })
  vi.stubGlobal('crypto', { getRandomValues })
  return getRandomValues
}

describe('generateTemporaryPassword', () => {
  it('is at least 14 characters, well over the 6 Firebase insists on', () => {
    for (let i = 0; i < 50; i++) expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(14)
  })

  it('always holds a lower-case letter, an upper-case letter, a digit and a symbol, so a stricter password policy still accepts it', () => {
    for (let i = 0; i < 50; i++) {
      const password = generateTemporaryPassword()
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/\d/)
      expect(password).toMatch(/[!@#$%&*?_]/)
    }
  })

  it('leaves out the characters that get misread when it is read out or retyped: 0, O, 1, l and I', () => {
    for (let i = 0; i < 200; i++) expect(generateTemporaryPassword()).not.toMatch(/[01OIl]/)
  })

  it('draws from crypto.getRandomValues and never from Math.random', () => {
    const getRandomValues = stubCrypto()
    const mathRandom = vi.spyOn(Math, 'random')

    generateTemporaryPassword()

    expect(getRandomValues).toHaveBeenCalled()
    expect(mathRandom).not.toHaveBeenCalled()
  })

  it('is different every time', () => {
    const passwords = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()))
    expect(passwords.size).toBe(50)
  })

  it('throws away a draw from the uneven tail of the range instead of folding it in with %, which would favour the low letters', () => {
    // 0xffffffff sits above the unbiased limit for the 25 lower-case letters. Folded in with %, it would pick index 20, "v".
    // Redrawn, the next value (0) picks index 0, "a". Every other draw in this run is 0 too, so "v" can only come from the bad draw.
    stubCrypto([0xffffffff])

    const password = generateTemporaryPassword()

    expect(password).not.toContain('v')
    expect(password).toContain('a')
  })

  it('fails closed when the browser has no Web Crypto, rather than falling back to something guessable', () => {
    vi.stubGlobal('crypto', undefined)
    const mathRandom = vi.spyOn(Math, 'random')

    expect(() => generateTemporaryPassword()).toThrow(/web crypto/i)
    expect(mathRandom).not.toHaveBeenCalled()
  })
})
