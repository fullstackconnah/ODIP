import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_UI_PREFERENCES, readUiPreferences, writeUiPreferences } from './uiPreferences'

describe('uiPreferences', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips a written preference back out for the same user', () => {
    writeUiPreferences('user-1', { tableVerticalDividers: true })

    expect(readUiPreferences('user-1')).toEqual({ tableVerticalDividers: true })
  })

  it('does not leak one user\'s preference onto another user id', () => {
    writeUiPreferences('user-1', { tableVerticalDividers: true })

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

    expect(() => writeUiPreferences('user-1', { tableVerticalDividers: true })).not.toThrow()
  })

  it('returns defaults and performs no write for a null userId', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    expect(readUiPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES)
    writeUiPreferences(null, { tableVerticalDividers: true })

    expect(setItemSpy).not.toHaveBeenCalled()
  })
})
