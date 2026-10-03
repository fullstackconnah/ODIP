import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WizardStepHeading } from './WizardStepHeading'

describe('WizardStepHeading', () => {
  it('renders the step label as a heading that is programmatically focusable but excluded from the tab order', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Before</button>
        <WizardStepHeading stepKey="keyIdentifiers" label="Key Identifiers" />
        <button type="button">After</button>
      </>,
    )

    const heading = screen.getByRole('heading', { name: 'Key Identifiers' })
    expect(heading.tagName).toBe('H2')
    // Programmatically focusable (the step-change effect calls headingRef.current?.focus()) ...
    expect(heading).toHaveAttribute('tabindex', '-1')

    // ...but tabIndex={-1} removes it from SEQUENTIAL tab order: tabbing on from the button
    // before it must land on the button after it, never on the heading itself.
    screen.getByRole('button', { name: 'Before' }).focus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
  })

  it('does not steal focus on first mount', () => {
    render(<WizardStepHeading stepKey="keyIdentifiers" label="Key Identifiers" />)

    // The effect's hasMounted guard must skip the very first run — a screen-reader/keyboard
    // user landing on this page for the first time keeps whatever focus the router/page already
    // set (document.body here, since nothing else claimed it), instead of having it stolen.
    expect(document.activeElement).toBe(document.body)
  })

  it('moves focus to the heading when the step changes, and the heading text is the new step label', () => {
    const { rerender } = render(<WizardStepHeading stepKey="keyIdentifiers" label="Key Identifiers" />)
    expect(document.activeElement).toBe(document.body)

    rerender(<WizardStepHeading stepKey="medical" label="Medical" />)

    expect(screen.getByRole('heading', { name: 'Medical' })).toHaveFocus()
    expect(screen.queryByRole('heading', { name: 'Key Identifiers' })).not.toBeInTheDocument()
  })

  // Review F14: under a section's own h2 (the plan builder's "Add a block") the step is an h3; the three older wizards keep their h2.
  it('is an h2 unless the wizard sits under an h2 of its own, which asks for an h3', () => {
    const { rerender } = render(<WizardStepHeading stepKey="a" label="Step A" />)
    expect(screen.getByRole('heading', { name: 'Step A' }).tagName).toBe('H2')

    rerender(<WizardStepHeading stepKey="a" label="Step A" level={3} />)
    expect(screen.getByRole('heading', { name: 'Step A', level: 3 })).toHaveAttribute('tabindex', '-1')
  })

  it('takes classes of its own, so a wizard can keep the heading for focus and the announcement and hide its text on a small screen', () => {
    render(<WizardStepHeading stepKey="a" label="Step A" className="max-lg:sr-only" />)

    expect(screen.getByRole('heading', { name: 'Step A' })).toHaveClass('max-lg:sr-only', 'font-semibold')
  })

  it('announces the step change through a polite, atomic, visually hidden live region', () => {
    const { container } = render(<WizardStepHeading stepKey="keyIdentifiers" label="Key Identifiers" />)

    const liveRegion = container.querySelector('[aria-live]') as HTMLElement
    expect(liveRegion).toBeInTheDocument()
    expect(liveRegion).toHaveAttribute('aria-live', 'polite')
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true')
    expect(liveRegion).toHaveTextContent(/key identifiers/i)
    // sr-only is this codebase's visually-hidden convention for a live region with no visible
    // rendering of its own (identical to RosterGateFields' live region, commit 30aad79) — this
    // is the accessible-semantics contract under test, not an incidental styling class.
    expect(liveRegion).toHaveClass('sr-only')
  })
})
