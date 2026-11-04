import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CompatibilityReachLine } from './CompatibilityReachLine'

const { settingsData } = vi.hoisted(() => ({ settingsData: { current: undefined as { autoRosterReach?: number } | undefined } }))
vi.mock('@/api/hooks', () => ({ useSettings: () => ({ data: settingsData.current }) }))

const NOT_LISTED = 'Anyone else it suggests, including staff not listed here, waits for you to look.'

function renderLine(canChange = true) {
  render(<MemoryRouter><CompatibilityReachLine canChange={canChange} /></MemoryRouter>)
}

describe('CompatibilityReachLine', () => {
  it.each([
    [0, 'Auto-roster places Preferred staff freely.'],
    [1, 'Auto-roster places Preferred and Backup staff freely.'],
    [2, 'Auto-roster places Preferred, Backup and Emergency staff freely.'],
  ])('at reach %i says who is placed freely and that anyone else waits for a look', (reach, sentence) => {
    settingsData.current = { autoRosterReach: reach }
    renderLine()
    expect(screen.getByText(new RegExp(`^${sentence.replace('.', '\\.')} ${NOT_LISTED.replace('.', '\\.')}`))).toBeInTheDocument()
  })

  it.each([[3], [undefined]])('at reach %s (the shipped setting, or still loading) says anyone not marked No, with no extra clause', reach => {
    settingsData.current = reach === undefined ? undefined : { autoRosterReach: reach }
    renderLine()
    expect(screen.getByText('Auto-roster can place anyone not marked No.')).toBeInTheDocument()
    expect(screen.queryByText(/waits for you to look/)).not.toBeInTheDocument()
  })

  it('links an Admin to the setting, and shows nobody else a link', () => {
    settingsData.current = { autoRosterReach: 1 }
    renderLine(true)
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/settings?section=rostering')
  })

  it('has no Change link for someone who cannot change it', () => {
    settingsData.current = { autoRosterReach: 1 }
    renderLine(false)
    expect(screen.queryByRole('link', { name: 'Change' })).not.toBeInTheDocument()
  })
})
