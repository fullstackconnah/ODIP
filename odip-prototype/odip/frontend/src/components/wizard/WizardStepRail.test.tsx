import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WizardStepRail } from './WizardStepRail'

const steps = [
  { key: 'a', label: 'Alpha', fields: [] },
  { key: 'b', label: 'Beta', fields: [] },
  { key: 'c', label: 'Gamma', fields: [] },
]

describe('WizardStepRail', () => {
  it('marks the current step with aria-current="step"', () => {
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a'])} currentKey="a" onSelect={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: /intake wizard steps/i })
    expect(within(nav).getByRole('button', { name: /alpha/i, current: 'step' })).toBeInTheDocument()
  })

  it('disables a pill whose key is not in visitedSteps', () => {
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a'])} currentKey="a" onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /gamma/i })).toBeDisabled()
  })

  it('calls onSelect with the clicked step key when the pill is visited', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: /beta/i }))
    expect(onSelect).toHaveBeenCalledWith('b')
  })
})
