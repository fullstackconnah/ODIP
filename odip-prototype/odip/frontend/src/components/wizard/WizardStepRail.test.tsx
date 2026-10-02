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
    expect(nav).toHaveClass('relative', 'w-full', 'min-w-0', 'max-w-full', '[contain:inline-size]', 'overflow-x-auto', 'touch-pan-x')
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

  // L5-10: the label was hard-coded "Intake wizard steps", so every wizard announced itself as the intake. A wizard names itself with `ariaLabel`;
  // the default is still the intake's name (see the prop's note), so the Intake and Profile wizards' own tests keep passing.
  it('names the nav with the wizard’s own name through ariaLabel, and not "Intake" when it is not the intake', () => {
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a'])} currentKey="a" onSelect={vi.fn()} ariaLabel="Incident report steps" />)

    expect(screen.getByRole('navigation', { name: 'Incident report steps' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /intake/i })).not.toBeInTheDocument()
  })

  it('still defaults to "Intake wizard steps" with orientation="vertical" too', () => {
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={vi.fn()} orientation="vertical" />)

    expect(screen.getByRole('navigation', { name: /intake wizard steps/i })).toBeInTheDocument()
  })

  it('with orientation="vertical" the <ol> carries the vertical layout classes and the buttons keep their step-label accessible name', () => {
    render(
      <WizardStepRail
        steps={steps}
        visitedSteps={new Set(['a', 'b'])}
        currentKey="a"
        onSelect={vi.fn()}
        orientation="vertical"
      />,
    )

    const list = screen.getByRole('list')
    expect(list).toHaveClass('flex', 'flex-col', 'gap-2', 'w-full')
    // No horizontal-scrolling class on a vertical rail.
    expect(list).not.toHaveClass('w-max', 'min-w-full')

    // Every step button still has its full label as accessible name in vertical mode (no DOM
    // stripping of the label just because the layout changed).
    expect(screen.getByRole('button', { name: /alpha/i, current: 'step' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /beta/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /gamma/i })).toBeInTheDocument()
    // And no duplicate step buttons.
    expect(screen.getAllByRole('button', { name: /alpha/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /beta/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /gamma/i })).toHaveLength(1)
  })

  it('does not render duplicated step buttons in either orientation (single rendered nav at every width)', () => {
    const { rerender } = render(
      <WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={vi.fn()} orientation="horizontal" />,
    )
    expect(screen.getAllByRole('navigation', { name: /intake wizard steps/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /alpha/i })).toHaveLength(1)
    rerender(
      <WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={vi.fn()} orientation="vertical" />,
    )
    expect(screen.getAllByRole('navigation', { name: /intake wizard steps/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /alpha/i })).toHaveLength(1)
  })
})
