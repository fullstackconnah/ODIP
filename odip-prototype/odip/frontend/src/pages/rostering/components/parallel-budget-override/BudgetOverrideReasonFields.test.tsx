// BudgetOverrideReasonFields in a DOM: it appears only when the server refused the shift on the budget, offers "Emergency or safety" as a secondary action, moves focus to the description once it
// is chosen, validates the description after an attempt, holds its controls while a save is in flight, and says nothing that promises the browser is the boundary.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { render, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BudgetOverrideReasonFields } from './BudgetOverrideReasonFields'
import type { BudgetOverrideReasonFieldsProps } from './BudgetOverrideReasonFields'
import type { BudgetOverrideChoice } from './budgetOverrideTypes'
import { GOOD_EMERGENCY_REASON, SHORT_REASON, approachingFinding, forecastOverFinding, forecastOverWarningForAdmin } from './fixtures'

afterEach(() => cleanup())

function Static(p: Partial<BudgetOverrideReasonFieldsProps>) {
  return (
    <BudgetOverrideReasonFields
      findings={p.findings ?? [forecastOverFinding]}
      choice={p.choice ?? 'none'}
      reason={p.reason ?? ''}
      submitted={p.submitted ?? false}
      pending={p.pending}
      disabled={p.disabled}
      error={p.error}
      onChoiceChange={p.onChoiceChange ?? vi.fn()}
      onReasonChange={p.onReasonChange ?? vi.fn()}
    />
  )
}

/** The host owns the state, as the shift panel does. */
function Host(p: { findings?: BudgetOverrideReasonFieldsProps['findings']; submitted?: boolean }) {
  const [choice, setChoice] = useState<BudgetOverrideChoice>('none')
  const [reason, setReason] = useState('')
  return (
    <>
      <BudgetOverrideReasonFields
        findings={p.findings ?? [forecastOverFinding]}
        choice={choice}
        reason={reason}
        submitted={p.submitted ?? false}
        onChoiceChange={setChoice}
        onReasonChange={setReason}
      />
      <output data-testid="state">{`${choice}|${reason}`}</output>
    </>
  )
}

const description = () => screen.getByLabelText(/What made this an emergency or safety need/i)

describe('when the panel appears', () => {
  it('appears when the server refused the shift on the budget, with a secondary action and no description yet', () => {
    render(<Static />)

    expect(screen.getByRole('region', { name: 'Emergency or safety' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Emergency or safety/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/What made this an emergency or safety need/i)).not.toBeInTheDocument()
  })

  it('renders nothing at all for an Admin, whose finding is a warning the existing reason field answers', () => {
    const { container } = render(<Static findings={[forecastOverWarningForAdmin]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for warnings that block nothing, or for no finding: the description is not a note on an ordinary shift', () => {
    expect(render(<Static findings={[approachingFinding]} />).container).toBeEmptyDOMElement()
    cleanup()
    expect(render(<Static findings={[]} />).container).toBeEmptyDOMElement()
  })

  it('is a secondary action, not the primary one', () => {
    render(<Static />)

    expect(screen.getByRole('button', { name: /Emergency or safety/i }).className).toMatch(/border/)   // the secondary variant: ruled border, card fill
    expect(screen.getByRole('button', { name: /Emergency or safety/i }).className).not.toMatch(/bg-\[var\(--color-primary\)\]/)
  })
})

describe('choosing the path', () => {
  it('reports the choice, opens the description, and moves focus to it', async () => {
    const user = userEvent.setup()
    render(<Host />)

    await user.click(screen.getByRole('button', { name: /Emergency or safety/i }))

    expect(screen.getByTestId('state')).toHaveTextContent('emergency|')
    expect(description()).toHaveFocus()
    expect(screen.queryByRole('button', { name: /^Emergency or safety/i })).not.toBeInTheDocument()   // the action is spent: the panel is now the path
  })

  it('does not steal focus on a re-render that was already in the path', () => {
    const { rerender } = render(<Static choice="emergency" reason="Unsafe" />)
    const field = description()
    field.blur()

    rerender(<Static choice="emergency" reason="Unsafe tonight" />)

    expect(description()).not.toHaveFocus()
  })

  it('lets the user step back out, keeping what they had typed', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: /Emergency or safety/i }))
    await user.type(description(), 'Unsafe tonight')

    await user.click(screen.getByRole('button', { name: /This is not an emergency/i }))

    expect(screen.getByTestId('state')).toHaveTextContent('none|Unsafe tonight')
    expect(screen.getByRole('button', { name: /Emergency or safety/i })).toBeInTheDocument()
  })

  it('says the shift saves at once, an Admin reviews it afterwards, and that it cannot be switched off', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: /Emergency or safety/i }))

    expect(screen.getByText(/saves at once and an Admin reviews it afterwards/i)).toBeInTheDocument()
    expect(screen.getByText(/always available and cannot be switched off/i)).toBeInTheDocument()
  })
})

describe('the description', () => {
  it('is required, labelled apart from an ordinary override reason, and hints the minimum and the review', () => {
    render(<Static choice="emergency" />)

    expect(description()).toBeRequired()
    expect(screen.getByText(/At least 10 characters/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Reason for the override/i)).not.toBeInTheDocument()
  })

  it('keeps what was typed, exactly, and shows the value it is given', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: /Emergency or safety/i }))

    await user.type(description(), '  Unsafe at home  ')

    expect(description()).toHaveValue('  Unsafe at home  ')
  })

  it('does not complain while the user is still typing their first word', () => {
    render(<Static choice="emergency" reason="" submitted={false} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refuses an empty or whitespace-only description after an attempt, and says why in words', () => {
    render(<Static choice="emergency" reason={' \t\n '} submitted />)

    expect(screen.getByRole('alert')).toHaveTextContent(/Write why this shift should go ahead/)
  })

  it('refuses a too-short description after an attempt, with the minimum in the message', () => {
    render(<Static choice="emergency" reason={SHORT_REASON} submitted />)

    expect(screen.getByRole('alert')).toHaveTextContent(/at least 10 characters/)
  })

  it('associates the error with the textarea, so a focused user is told', () => {
    render(<Static choice="emergency" reason={SHORT_REASON} submitted />)

    expect(description()).toBeInvalid()
    expect(description()).toHaveAccessibleDescription(/at least 10 characters/i)
  })

  it('shows no error for a real description', () => {
    render(<Static choice="emergency" reason={GOOD_EMERGENCY_REASON} submitted />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('pending, disabled and failed states', () => {
  it('holds the controls while a save is in flight, so a second submit cannot double-write', () => {
    render(<Static choice="emergency" reason={GOOD_EMERGENCY_REASON} pending />)

    expect(description()).toBeDisabled()
    expect(screen.getByRole('button', { name: /This is not an emergency/i })).toBeDisabled()
  })

  it('says it is saving and that the description is kept, without adding a live region of its own', () => {
    render(<Static choice="emergency" reason={GOOD_EMERGENCY_REASON} pending />)

    expect(screen.getByText(/Saving — the description above is kept/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('disables, rather than hides, the action for a read-only viewer', () => {
    render(<Static disabled />)

    expect(screen.getByRole('button', { name: /Emergency or safety/i })).toBeDisabled()
  })

  it("shows the server's failure above the controls and keeps the description and the path", () => {
    render(<Static choice="emergency" reason={GOOD_EMERGENCY_REASON} error="The shift was not saved. Try again." />)

    expect(screen.getByRole('alert')).toHaveTextContent('The shift was not saved. Try again.')
    expect(description()).toHaveValue(GOOD_EMERGENCY_REASON)
  })
})

describe('the copy makes no promise the browser cannot keep', () => {
  it('says the server checks the budget, so hiding a path is not described as security', () => {
    render(<Static />)

    expect(screen.getByText(/The server checks the budget on every save/)).toBeInTheDocument()
  })

  it('offers no control that could switch the emergency path off', () => {
    render(<Static choice="emergency" />)

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('never says a shift cannot be saved or support cannot be claimed', () => {
    render(<Static />)

    expect(document.body.textContent).not.toMatch(/cannot be saved|can't be saved|cannot be claimed|can't be claimed/i)
  })

  it('names Admin as the other way through, by a written reason', () => {
    render(<Static />)

    expect(screen.getByText(/An Admin can save it with a written reason/)).toBeInTheDocument()
  })
})

describe('the emergency state is visibly its own thing', () => {
  it('has its own fill once chosen, and not before', () => {
    const { rerender } = render(<Static choice="none" />)
    const before = document.querySelector('[data-emergency-panel]')!.className
    rerender(<Static choice="emergency" />)
    const after = document.querySelector('[data-emergency-panel]')!.className

    expect(before).not.toMatch(/warning-container/)
    expect(after).toMatch(/warning-container/)
  })

  it('is distinguished by its words, not by colour alone', () => {
    render(<Static choice="emergency" />)

    expect(screen.getByText('Emergency or safety', { selector: 'p' })).toBeInTheDocument()
  })
})
