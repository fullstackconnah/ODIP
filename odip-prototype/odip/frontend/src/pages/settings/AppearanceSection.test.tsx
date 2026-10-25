import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UiPreferencesProvider } from '@/hooks/useUiPreferences'
import AppearanceSection from './AppearanceSection'

const SCRIPT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../public/theme.js'), 'utf-8')

describe('AppearanceSection theme', () => {
  beforeEach(() => {
    window.matchMedia = (() => ({ matches: false, addEventListener: () => {} })) as unknown as typeof window.matchMedia
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    new Function(SCRIPT)()
  })
  afterEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme') })

  it('starts on System, applies Dark at once, stores it for the user, and returns to the OS on System', async () => {
    const user = userEvent.setup()
    render(<UiPreferencesProvider><AppearanceSection /></UiPreferencesProvider>)
    const group = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(group).toHaveAccessibleDescription("System follows your device's light or dark setting.")
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(JSON.parse(localStorage.getItem('odip_ui_prefs:u1')!).theme).toBe('dark')
    expect(screen.getByRole('status')).toHaveTextContent('Saved on this device')

    await user.click(screen.getByRole('radio', { name: 'System' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
