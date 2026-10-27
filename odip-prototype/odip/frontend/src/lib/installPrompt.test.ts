import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INSTALL_SNOOZE_MS, captureInstallEvents, getInstallSnapshot, installPromptMode, isIosSafari, readInstallRecord,
  snoozeInstallPrompt, markInstalled, type InstallPromptEnv,
} from './installPrompt'

const NOW = 1_800_000_000_000
const base: InstallPromptEnv = {
  belowMd: true, coarse: true, secure: true, standalone: false, installed: false, dismissedUntil: 0, now: NOW,
  hasDeferred: true, iosSafari: false, path: '/portal',
}

describe('installPromptMode matrix', () => {
  it.each<[string, Partial<InstallPromptEnv>, 'android' | 'ios' | null]>([
    ['android with a saved event', {}, 'android'],
    ['desktop (md and up)', { belowMd: false }, null],
    ['fine pointer', { coarse: false }, null],
    ['insecure context', { secure: false }, null],
    ['standalone', { standalone: true }, null],
    ['installed', { installed: true }, null],
    ['a nested route', { path: '/portal/shifts/x' }, null],
    ['the dashboard route', { path: '/' }, 'android'],
    ['dismissed until just after now', { dismissedUntil: NOW + 1 }, null],
    ['dismissal just lapsed', { dismissedUntil: NOW - 1 }, 'android'],
    ['deferred wins over an iOS user agent', { iosSafari: true }, 'android'],
    ['iOS Safari with no event', { hasDeferred: false, iosSafari: true }, 'ios'],
    ['neither event nor iOS Safari', { hasDeferred: false }, null],
  ])('%s', (_name, over, want) => {
    expect(installPromptMode({ ...base, ...over })).toBe(want)
  })
})

describe('isIosSafari', () => {
  const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  it('accepts iPhone Safari and iPadOS Safari (desktop UA with touch)', () => {
    expect(isIosSafari(SAFARI, 5)).toBe(true)
    expect(isIosSafari(SAFARI.replace('iPhone; CPU iPhone OS', 'Macintosh; Intel Mac OS X'), 5)).toBe(true)
  })
  it('rejects other iOS browsers and desktop Safari', () => {
    expect(isIosSafari(SAFARI.replace('Version/17.5', 'CriOS/126.0'), 5)).toBe(false)
    expect(isIosSafari(SAFARI.replace('Safari/604.1', 'FxiOS/127 Safari/604.1'), 5)).toBe(false)
    expect(isIosSafari(SAFARI.replace('iPhone; CPU iPhone OS', 'Macintosh; Intel Mac OS X'), 0)).toBe(false)
    expect(isIosSafari('Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile Safari/537.36', 5)).toBe(false)
  })
})

describe('dismissal storage', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('Not now writes odip_install_prompt:u1 with now + 30 days', () => {
    snoozeInstallPrompt('u1', NOW)
    expect(JSON.parse(localStorage.getItem('odip_install_prompt:u1')!)).toEqual({ dismissedUntil: NOW + 30 * 86_400_000 })
    expect(INSTALL_SNOOZE_MS).toBe(30 * 86_400_000)
  })

  it('installed is stored as {installed:true} and read back', () => {
    markInstalled('u1')
    expect(readInstallRecord('u1')).toEqual({ dismissedUntil: 0, installed: true })
  })

  it('a throwing setItem or getItem does not throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => snoozeInstallPrompt('u1', NOW)).not.toThrow()
    expect(() => markInstalled('u1')).not.toThrow()
    expect(readInstallRecord('u1')).toEqual({ dismissedUntil: 0, installed: false })
  })

  it.each(['{not json', 'null', '"x"', '{"dismissedUntil":"soon"}'])('corrupt value %s reads as not dismissed', (raw) => {
    localStorage.setItem('odip_install_prompt:u1', raw)
    expect(readInstallRecord('u1')).toEqual({ dismissedUntil: 0, installed: false })
  })

  it("u1's dismissal does not hide the prompt for u2", () => {
    snoozeInstallPrompt('u1', NOW)
    expect(readInstallRecord('u1').dismissedUntil).toBe(NOW + INSTALL_SNOOZE_MS)
    expect(readInstallRecord('u2').dismissedUntil).toBe(0)
  })
})

describe('capture before mount', () => {
  it('keeps an event dispatched before any subscriber, and calls preventDefault', () => {
    const win = new EventTarget()
    captureInstallEvents(win)
    const evt = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' }) })
    win.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(getInstallSnapshot().deferred).toBe(evt)
  })

  it('appinstalled sets installed and drops the deferred event; subscribers are told', () => {
    const win = new EventTarget()
    captureInstallEvents(win)
    win.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) }))
    win.dispatchEvent(new Event('appinstalled'))
    expect(getInstallSnapshot()).toMatchObject({ deferred: null, installed: true })
  })
})
