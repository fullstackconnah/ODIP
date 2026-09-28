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

  it('keeps the rail inside its container while preserving an independently scrollable touch target', () => {
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={vi.fn()} />)

    const nav = screen.getByRole('navigation', { name: /intake wizard steps/i })
    expect(nav).toHaveClass('w-full', 'min-w-0', 'max-w-full', '[contain:inline-size]', 'overflow-x-auto', 'touch-pan-x')
    expect(within(nav).getByRole('list')).toHaveClass('w-max', 'min-w-full')
  })

  it('shows a visible current-step summary while retaining every full step label in button names', () => {
    const nineSteps = Array.from({ length: 9 }, (_, index) => ({
      key: `step-${index + 1}`,
      label: `Step label ${index + 1}`,
      fields: [],
    }))
    render(<WizardStepRail steps={nineSteps} visitedSteps={new Set(['step-1', 'step-2'])} currentKey="step-2" onSelect={vi.fn()} />)

    expect(screen.getByText('Step 2 of 9')).toBeVisible()
    for (const step of nineSteps) {
      expect(screen.getByRole('button', { name: new RegExp(step.label) })).toBeInTheDocument()
    }
  })

  it('keeps visited buttons keyboard-operable while unvisited steps stay disabled', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={onSelect} />)

    await user.tab()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('a')
    expect(screen.getByRole('button', { name: /gamma/i })).toBeDisabled()
  })
})
