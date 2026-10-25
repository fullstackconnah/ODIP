import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '@testing-library/react'
import { UiPreferencesProvider } from './useUiPreferences'

/** The provider's cleanup runs on every unmount, including the footer's SPA link to /accessibility; it must not drop a saved theme. */
const SCRIPT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../public/theme.js'), 'utf-8')
const theme = () => document.documentElement.getAttribute('data-theme')

describe('UiPreferencesProvider theme on unmount', () => {
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({ media: query, matches: false, addEventListener: () => {} })) as unknown as typeof window.matchMedia
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    localStorage.setItem('odip_ui_prefs:u1', JSON.stringify({ theme: 'dark' }))
    new Function(SCRIPT)()
  })
  afterEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme') })

  it('keeps a saved Dark on a light OS when the shell unmounts for another route', () => {
    const { unmount } = render(<UiPreferencesProvider><span /></UiPreferencesProvider>)
    expect(theme()).toBe('dark')
    unmount()
    expect(theme()).toBe('dark')
  })
})
