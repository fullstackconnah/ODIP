import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_UI_PREFERENCES, readUiPreferences, writeUiPreferences } from './uiPreferences'

describe('uiPreferences', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips a written preference back out for the same user', () => {
    writeUiPreferences('user-1', { tableVerticalDividers: true, theme: 'system', sidebarCollapsed: false })

    expect(readUiPreferences('user-1')).toEqual({ tableVerticalDividers: true, theme: 'system', sidebarCollapsed: false })
  })

  it('does not leak one user\'s preference onto another user id', () => {
    writeUiPreferences('user-1', { tableVerticalDividers: true, theme: 'system', sidebarCollapsed: false })

    expect(readUiPreferences('user-2')).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('falls back to defaults when nothing has been stored yet', () => {
    expect(readUiPreferences('brand-new-user')).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('falls back to defaults when the stored value is malformed JSON', () => {
    localStorage.setItem('odip_ui_prefs:user-1', '{not valid json')

    expect(readUiPreferences('user-1')).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('falls back to defaults when the stored value is valid JSON but not an object', () => {
    localStorage.setItem('odip_ui_prefs:user-1', '"just a string"')

    expect(readUiPreferences('user-1')).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('ignores unknown/extra keys and falls back to the default for a missing known key', () => {
    localStorage.setItem('odip_ui_prefs:user-1', JSON.stringify({ someFuturePref: 'x' }))

    expect(readUiPreferences('user-1')).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('ignores a stored value of the wrong type for a known key rather than trusting it', () => {
    localStorage.setItem('odip_ui_prefs:user-1', JSON.stringify({ tableVerticalDividers: 'yes' }))

    expect(readUiPreferences('user-1')).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('falls back to defaults without throwing when localStorage.getItem throws (e.g. Safari private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => readUiPreferences('user-1')).not.toThrow()
    expect(readUiPreferences('user-1')).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('does not throw when localStorage.setItem throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => writeUiPreferences('user-1', { tableVerticalDividers: true, theme: 'system', sidebarCollapsed: false })).not.toThrow()
  })

  it('returns defaults and performs no write for a null userId', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    expect(readUiPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES)
    writeUiPreferences(null, { tableVerticalDividers: true, theme: 'system', sidebarCollapsed: false })

    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

describe('uiPreferences theme', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('defaults to following the device (System)', () => {
    expect(DEFAULT_UI_PREFERENCES.theme).toBe('system')
    expect(readUiPreferences('nobody').theme).toBe('system')
  })

  it('reads prefs saved before the theme existed as System, keeping the dividers setting', () => {
    localStorage.setItem('odip_ui_prefs:user-1', JSON.stringify({ tableVerticalDividers: true }))

    expect(readUiPreferences('user-1')).toEqual({ tableVerticalDividers: true, theme: 'system', sidebarCollapsed: false })
  })

  it.each([['sepia', '"sepia"'], ['a number', '1'], ['null', 'null']])('reads a stored theme of %s as System', (_name, json) => {
    localStorage.setItem('odip_ui_prefs:user-1', `{"theme":${json}}`)

    expect(readUiPreferences('user-1').theme).toBe('system')
  })

  it('reads bad JSON and a throwing getItem as System', () => {
    localStorage.setItem('odip_ui_prefs:user-1', '{nope')
    expect(readUiPreferences('user-1').theme).toBe('system')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(readUiPreferences('user-1').theme).toBe('system')
  })

  it('keeps Dark per user: user A on Dark leaves user B on System', () => {
    writeUiPreferences('user-a', { tableVerticalDividers: false, theme: 'dark', sidebarCollapsed: false })

    expect(readUiPreferences('user-a').theme).toBe('dark')
    expect(readUiPreferences('user-b').theme).toBe('system')
  })
})

describe('uiPreferences sidebarCollapsed', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('defaults to the wide sidebar', () => {
    expect(DEFAULT_UI_PREFERENCES.sidebarCollapsed).toBe(false)
    expect(readUiPreferences('nobody').sidebarCollapsed).toBe(false)
  })

  it('reads a stored true as true, per user', () => {
    writeUiPreferences('user-a', { ...DEFAULT_UI_PREFERENCES, sidebarCollapsed: true })

    expect(readUiPreferences('user-a').sidebarCollapsed).toBe(true)
    expect(readUiPreferences('user-b').sidebarCollapsed).toBe(false)
  })

  it.each([['a string', '"yes"'], ['a number', '1'], ['null', 'null']])('reads a stored %s as false', (_name, json) => {
    localStorage.setItem('odip_ui_prefs:user-1', `{"sidebarCollapsed":${json}}`)

    expect(readUiPreferences('user-1').sidebarCollapsed).toBe(false)
  })

  it('reads missing, malformed and unreadable storage as false', () => {
    expect(readUiPreferences('user-1').sidebarCollapsed).toBe(false)
    localStorage.setItem('odip_ui_prefs:user-1', '{nope')
    expect(readUiPreferences('user-1').sidebarCollapsed).toBe(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(readUiPreferences('user-1').sidebarCollapsed).toBe(false)
  })
})
