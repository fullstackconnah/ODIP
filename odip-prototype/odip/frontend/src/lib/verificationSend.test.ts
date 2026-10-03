import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VERIFICATION_HOLD_MS, holdLeftMs, readVerificationSend, writeVerificationSend } from './verificationSend'

const record = (overrides: Partial<{ email: string; at: number; went: boolean }> = {}) => ({ email: 'jane.smith@acme.example.com', at: 1_000_000, went: true, ...overrides })

beforeEach(() => sessionStorage.clear())
afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('the hold', () => {
  it('is 30 seconds', () => {
    expect(VERIFICATION_HOLD_MS).toBe(30_000)
  })
})

describe('holdLeftMs', () => {
  const sentAt = 1_000_000

  it('is what is left of the hold for the address the link went to', () => {
    expect(holdLeftMs(record(), 'jane.smith@acme.example.com', sentAt)).toBe(30_000)
    expect(holdLeftMs(record(), 'jane.smith@acme.example.com', sentAt + 10_000)).toBe(20_000)
    expect(holdLeftMs(record(), 'jane.smith@acme.example.com', sentAt + 29_999)).toBe(1)
  })

  it('is 0 once the hold is over', () => {
    expect(holdLeftMs(record(), 'jane.smith@acme.example.com', sentAt + 30_000)).toBe(0)
    expect(holdLeftMs(record(), 'jane.smith@acme.example.com', sentAt + 5 * 60_000)).toBe(0)
  })

  it('is 0 for another address, and when nothing was sent', () => {
    expect(holdLeftMs(record(), 'someone.else@acme.example.com', sentAt + 1_000)).toBe(0)
    expect(holdLeftMs(null, 'jane.smith@acme.example.com', sentAt)).toBe(0)
  })

  it('treats an address the same whatever its case or spaces, as the exchange does', () => {
    expect(holdLeftMs(record(), '  Jane.Smith@ACME.example.com ', sentAt + 10_000)).toBe(20_000)
  })

  it('never holds longer than the hold, even if the clock has moved backwards', () => {
    expect(holdLeftMs(record(), 'jane.smith@acme.example.com', sentAt - 10 * 60_000)).toBe(30_000)
  })

  it('counts a failed attempt too: Firebase counts attempts, so the next one waits as well', () => {
    expect(holdLeftMs(record({ went: false }), 'jane.smith@acme.example.com', sentAt + 10_000)).toBe(20_000)
  })
})

describe('readVerificationSend and writeVerificationSend', () => {
  it('remember the last attempt for this tab, with the address, the time and whether it went', () => {
    writeVerificationSend(record({ went: false }))

    expect(readVerificationSend()).toEqual(record({ went: false }))
  })

  it('read nothing when nothing was written, or what is there is not a record', () => {
    expect(readVerificationSend()).toBeNull()
    sessionStorage.setItem('odip_verification_send', 'not json')
    expect(readVerificationSend()).toBeNull()
    sessionStorage.setItem('odip_verification_send', JSON.stringify({ email: 5, at: 'now' }))
    expect(readVerificationSend()).toBeNull()
    sessionStorage.setItem('odip_verification_send', 'null')
    expect(readVerificationSend()).toBeNull()
  })

  it('keep no password: only the address, the time and the flag', () => {
    writeVerificationSend(record())

    expect(Object.keys(JSON.parse(sessionStorage.getItem('odip_verification_send')!)).sort()).toEqual(['at', 'email', 'went'])
  })

  it('never throw when sessionStorage refuses (a private window), and just forget', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })

    expect(() => writeVerificationSend(record())).not.toThrow()
    expect(readVerificationSend()).toBeNull()
  })
})
