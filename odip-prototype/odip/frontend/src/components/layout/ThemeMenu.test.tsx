import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UiPreferencesProvider } from '@/hooks/useUiPreferences'
import AppearanceSection from '@/pages/settings/AppearanceSection'
import ThemeMenu from './ThemeMenu'

const SCRIPT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../public/theme.js'), 'utf-8')
const applied = () => document.documentElement.getAttribute('data-theme')
const stored = () => JSON.parse(localStorage.getItem('odip_ui_prefs:u1')!).theme

function setup(withSettings = false) {
  const user = userEvent.setup()
  render(
    <UiPreferencesProvider>
      <ThemeMenu />
      {withSettings && <AppearanceSection />}
    </UiPreferencesProvider>,
  )
  return user
}

describe('ThemeMenu', () => {
  beforeEach(() => {
    window.matchMedia = (() => ({ matches: false, addEventListener: () => {} })) as unknown as typeof window.matchMedia
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    new Function(SCRIPT)()
  })
  afterEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme') })

  it('names the current preference on the trigger', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Theme: System' })).toBeInTheDocument()
  })

  it('lists Light, Dark and System with only the current one selected', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Theme: System' }))
    const rows = screen.getAllByRole('option')
    expect(rows.map(r => r.textContent)).toEqual(['Light', 'Dark', 'System'])
    expect(rows.map(r => r.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true'])
  })

  it('applies Dark at once, stores it, closes the menu and returns focus to the trigger', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Theme: System' }))
    await user.click(screen.getByRole('option', { name: 'Dark' }))
    expect(applied()).toBe('dark')
    expect(stored()).toBe('dark')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toHaveFocus()
  })

  it('works from the keyboard: Enter opens, arrows move, Enter chooses, Escape closes', async () => {
    const user = setup()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Theme: System' })).toHaveFocus()
    await user.keyboard('{Enter}') // opens on the first row, Light
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(stored()).toBe('dark')
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toHaveFocus()
    await user.keyboard('{Enter}{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(stored()).toBe('dark')
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toHaveFocus()
  })

  it('stays in step with Settings, Appearance in both directions', async () => {
    const user = setup(true)
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    await user.click(screen.getByRole('button', { name: 'Theme: Dark' }))
    await user.click(screen.getByRole('option', { name: 'Light' }))
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
    expect(applied()).toBe('light')
  })
})
