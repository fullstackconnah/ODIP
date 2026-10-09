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

    await user.click(screen.getByRole('button', { name: /^Back: this is not an emergency$/ }))

    expect(screen.getByTestId('state')).toHaveTextContent('none|Unsafe tonight')
    expect(screen.getByRole('button', { name: /Emergency or safety/i })).toBeInTheDocument()
  })

  it('says "Back" on the button and "Back: this is not an emergency" to a screen reader, so the old meaning is kept (design review round 1, N4)', () => {
    render(<Static choice="emergency" />)

    const back = screen.getByRole('button', { name: 'Back: this is not an emergency' })
    expect(back).toHaveTextContent('Back')
    expect(back).toHaveAttribute('aria-label', 'Back: this is not an emergency')
  })

  it('puts focus on the "Emergency or safety" button when the user steps back, so it is not dropped to the page (M7)', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: /Emergency or safety/i }))

    await user.click(screen.getByRole('button', { name: /^Back: this is not an emergency$/ }))

    expect(screen.getByRole('button', { name: /Emergency or safety/i })).toHaveFocus()
  })

  it('brings the whole card into view when the path opens, so the character count and Back are not left behind the footer on a phone', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const user = userEvent.setup()
      render(<Host />)

      await user.click(screen.getByRole('button', { name: /Emergency or safety/i }))

      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
      const card = scrollIntoView.mock.contexts[0] as HTMLElement
      expect(card).toBe(screen.getByRole('region', { name: 'Emergency or safety' }))
      expect(card).toContainElement(description())
      expect(card).toContainElement(screen.getByRole('button', { name: /^Back: this is not an emergency$/ }))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('does not scroll on a re-render that was already in the path, or when the user steps back', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const user = userEvent.setup()
      render(<Host />)
      await user.click(screen.getByRole('button', { name: /Emergency or safety/i }))
      scrollIntoView.mockClear()

      await user.type(description(), 'Unsafe tonight')
      await user.click(screen.getByRole('button', { name: /^Back: this is not an emergency$/ }))

      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('says once that the shift saves at once and an Admin reviews it afterwards, and leaves the policy for Settings (L5)', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: /Emergency or safety/i }))

    expect(screen.getAllByText(/An Admin reviews it afterwards/i)).toHaveLength(1)
    expect(screen.getByText('It saves at once. An Admin reviews it afterwards.')).toBeInTheDocument()
    expect(screen.queryByText(/cannot be switched off/i)).not.toBeInTheDocument()
  })
})

describe('the description', () => {
  it('is required, labelled apart from an ordinary override reason, and hints the minimum and where it is kept', () => {
    render(<Static choice="emergency" />)

    expect(description()).toBeRequired()
    expect(description()).toHaveAccessibleDescription('At least 10 characters. Kept with the shift.')
    expect(screen.queryByLabelText(/Reason for the override/i)).not.toBeInTheDocument()
  })

  it('says how many more characters it needs while it is under the minimum, and stops saying so at it (L5)', () => {
    const { rerender } = render(<Static choice="emergency" reason="Unsafe" />)
    expect(description()).toHaveAccessibleDescription('At least 10 characters, 4 more needed. Kept with the shift.')

    rerender(<Static choice="emergency" reason="  Unsafe  " />)   // padding does not count
    expect(description()).toHaveAccessibleDescription('At least 10 characters, 4 more needed. Kept with the shift.')

    rerender(<Static choice="emergency" reason="Unsafe now" />)
    expect(description()).toHaveAccessibleDescription('At least 10 characters. Kept with the shift.')
  })

  it('stops at the 1,900 characters the server accepts (C10)', () => {
    render(<Static choice="emergency" />)

    expect(description()).toHaveAttribute('maxlength', '1900')
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
    expect(screen.getByRole('button', { name: /^Back: this is not an emergency$/ })).toBeDisabled()
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
  it('does not talk about the server at all: the coordinator is told what is true of this shift, not how the system works (H3)', () => {
    const { rerender } = render(<Static />)
    expect(document.body.textContent).not.toMatch(/\bserver\b/i)

    rerender(<Static choice="emergency" />)
    expect(document.body.textContent).not.toMatch(/\bserver\b/i)
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

  it('names the three ways out: change the shift, ask an Admin to save it with a reason, or book it as an emergency (H3)', () => {
    render(<Static />)

    expect(screen.getByText('You can change the shift so it costs less, ask an Admin to save it with a reason, or, if it is an emergency or a safety need, book it now. An Admin reviews it afterwards.')).toBeInTheDocument()
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
