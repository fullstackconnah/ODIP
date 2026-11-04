import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestGeolocation } from './geolocation'

const secure = (value: boolean) => Object.defineProperty(window, 'isSecureContext', { value, configurable: true })
const geo = (getCurrentPosition: unknown) => Object.defineProperty(navigator, 'geolocation', { value: getCurrentPosition === undefined ? undefined : { getCurrentPosition }, configurable: true })

afterEach(() => {
  Reflect.deleteProperty(window, 'isSecureContext')
  Reflect.deleteProperty(navigator, 'geolocation')
  vi.useRealTimers()
})

describe('requestGeolocation', () => {
  it('returns the fix with its accuracy', async () => {
    secure(true)
    geo((ok: (p: unknown) => void) => ok({ coords: { latitude: -27.5, longitude: 153.02, accuracy: 14.6 } }))
    expect(await requestGeolocation()).toEqual({ ok: true, latitude: -27.5, longitude: 153.02, accuracyMetres: 14.6 })
  })

  it('maps a refusal to denied and anything else to timeout', async () => {
    secure(true)
    geo((_: unknown, bad: (e: unknown) => void) => bad({ code: 1 }))
    expect(await requestGeolocation()).toEqual({ ok: false, cause: 'denied' })
    geo((_: unknown, bad: (e: unknown) => void) => bad({ code: 3 }))
    expect(await requestGeolocation()).toEqual({ ok: false, cause: 'timeout' })
  })

  it('is insecure on plain HTTP without asking the phone', async () => {
    secure(false)
    const ask = vi.fn()
    geo(ask)
    expect(await requestGeolocation()).toEqual({ ok: false, cause: 'insecure' })
    expect(ask).not.toHaveBeenCalled()
  })

  it('is unsupported with no Geolocation API', async () => {
    secure(true)
    geo(undefined)
    expect(await requestGeolocation()).toEqual({ ok: false, cause: 'unsupported' })
  })

  it('gives up on a prompt that is never answered', async () => {
    vi.useFakeTimers()
    secure(true)
    geo(() => {})
    const out = requestGeolocation()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await out).toEqual({ ok: false, cause: 'timeout' })
  })
})
