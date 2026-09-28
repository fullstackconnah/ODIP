import { afterEach, describe, expect, it, vi } from 'vitest'
import { newCompletionRequestId } from './completionRequestId'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('newCompletionRequestId', () => {
  it('uses native randomUUID when it is callable', () => {
    const randomUUID = vi.fn(() => 'f5f7fe46-23df-4af9-a22a-915d1d10b956')
    vi.stubGlobal('crypto', { randomUUID })

    expect(newCompletionRequestId()).toBe('f5f7fe46-23df-4af9-a22a-915d1d10b956')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('creates unique canonical UUID v4 identifiers from getRandomValues without randomUUID', () => {
    let counter = 0
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0)
      bytes[14] = counter >> 8
      bytes[15] = counter++
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })

    const ids = Array.from({ length: 32 }, () => newCompletionRequestId())
    expect(new Set(ids)).toHaveLength(ids.length)
    expect(ids).toEqual(expect.arrayContaining([
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    ]))
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true)
    expect(getRandomValues).toHaveBeenCalledTimes(32)
  })

  it('fails closed when no secure Web Crypto primitive is available', () => {
    vi.stubGlobal('crypto', undefined)

    expect(() => newCompletionRequestId()).toThrow(/secure web crypto entropy is unavailable/i)
  })
})
