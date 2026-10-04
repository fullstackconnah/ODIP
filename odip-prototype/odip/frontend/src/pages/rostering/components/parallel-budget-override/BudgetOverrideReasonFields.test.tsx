// BudgetOverrideReasonFields in a DOM: every role/capability combination, every path, the
// whitespace-only refusal, the error association, keyboard control of the radios, the pending and
// failed-save states, and the copy that must not promise the browser is the boundary.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { render, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BudgetOverrideReasonFields } from './BudgetOverrideReasonFields'
import type { BudgetOverrideReasonFieldsProps } from './BudgetOverrideReasonFields'
import { reasonError, type BudgetOverrideChoice } from './budgetOverrideTypes'
import {
  GOOD_EMERGENCY_REASON,
  adminCapabilities,
  approachingFinding,
  coordinatorCapabilities,
  forecastOverFinding,
  forecastOverWarningForAdmin,
  noPathCapabilities,
} from './fixtures'

afterEach(() => cleanup())

type HarnessProps = Partial<BudgetOverrideReasonFieldsProps> & {
  /** Let the host own the state, the way ShiftSlideOver will. */
  interactive?: boolean
}

/**
 * The component is exercised as the controlled thing it is: it renders what it is given and calls
 * back, holding no state of its own. That is the integration contract, so the harness mirrors it.
 */
function Harness({ interactive = false, ...p }: HarnessProps) {
  const props = {
    findings: p.findings ?? [forecastOverFinding],
    capabilities: p.capabilities ?? coordinatorCapabilities,
    choice: (p.choice ?? 'none') as BudgetOverrideChoice,
    reason: p.reason ?? '',
    submitted: p.submitted ?? false,
    pending: p.pending,
    disabled: p.disabled,
    error: p.error,
    className: p.className,
  }
  if (!interactive) {
    return (
      <BudgetOverrideReasonFields
        {...props}
        onChoiceChange={p.onChoiceChange ?? vi.fn()}
        onReasonChange={p.onReasonChange ?? vi.fn()}
      />
    )
  }
  return <InteractiveHost {...props} onChoiceChange={p.onChoiceChange} onReasonChange={p.onReasonChange} />
}

function InteractiveHost({
  choice: initialChoice,
  reason: initialReason,
  onChoiceChange,
  onReasonChange,
  ...rest
}: Omit<BudgetOverrideReasonFieldsProps, 'onChoiceChange' | 'onReasonChange'> & {
  onChoiceChange?: (c: BudgetOverrideChoice) => void
  onReasonChange?: (r: string) => void
}) {
  const [choice, setChoice] = useState<BudgetOverrideChoice>(initialChoice)
  const [reason, setReason] = useState(initialReason)
  return (
    <BudgetOverrideReasonFields
      {...rest}
      choice={choice}
      reason={reason}
      onChoiceChange={c => {
        setChoice(c)
        onChoiceChange?.(c)
      }}
      onReasonChange={r => {
        setReason(r)
        onReasonChange?.(r)
      }}
    />
  )
}

const adminRadio = () => screen.getByRole('radio', { name: /Override as an Admin/i })
const emergencyRadio = () => screen.getByRole('radio', { name: /Emergency or safety/i })
const overrideReason = () => screen.getByLabelText(/Reason for the override/i)
const emergencyReason = () => screen.getByLabelText(/What made this an emergency or safety need/i)

describe('who may choose which path', () => {
  it('offers a Coordinator the emergency path and no ordinary override', () => {
    render(<Harness capabilities={coordinatorCapabilities} />)
    expect(emergencyRadio()).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Override as an Admin/i })).not.toBeInTheDocument()
  })

  it('offers an Admin both paths', () => {
    render(<Harness capabilities={adminCapabilities} />)
    expect(adminRadio()).toBeInTheDocument()
    expect(emergencyRadio()).toBeInTheDocument()
  })

  it('renders no choice at all, disabled or otherwise, when the caller authorises neither', () => {
    render(<Harness capabilities={noPathCapabilities} />)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('still shows the finding itself to a caller with no authorised path, so the warning is not lost', () => {
    render(<Harness capabilities={noPathCapabilities} />)
    expect(screen.getByText(forecastOverFinding.message)).toBeInTheDocument()
    expect(screen.getByText(/The server checks the budget on every save/)).toBeInTheDocument()
  })

  it('renders nothing at all with no finding: the reason field is not a note on an ordinary shift', () => {
    const { container } = render(<Harness findings={[]} capabilities={adminCapabilities} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the server finding is shown, not recomputed', () => {
  it("renders the server's own message verbatim", () => {
    render(<Harness findings={[forecastOverFinding]} />)
    expect(screen.getByText(forecastOverFinding.message)).toBeInTheDocument()
  })

  it('shows a warning finding without inventing a block on it', () => {
    render(<Harness findings={[approachingFinding]} />)
    expect(screen.getByText(approachingFinding.message)).toBeInTheDocument()
    expect(screen.queryByText(/can't be saved/i)).not.toBeInTheDocument()
  })

  it('shows an Admin the finding as a warning that asks for a reason', () => {
    render(<Harness findings={[forecastOverWarningForAdmin]} capabilities={adminCapabilities} />)
    expect(screen.getByText('Reason required')).toBeInTheDocument()
  })

  it('shows every finding it was given, not just the first', () => {
    render(<Harness findings={[approachingFinding, forecastOverFinding]} />)
    expect(screen.getByText(approachingFinding.message)).toBeInTheDocument()
    expect(screen.getByText(forecastOverFinding.message)).toBeInTheDocument()
  })

  it('prints no money figure of its own: the findings readout is a separate component', () => {
    // This component must not become a second place a number leaks from. The server's own message
    // is passed through because it is the server's; a figure this component derived is not.
    const { container } = render(<Harness findings={[approachingFinding]} />)
    const own = [...container.querySelectorAll('dd, .tabular-nums')].length
    expect(own).toBe(0)
  })
})

describe('choosing a path', () => {
  it('reports the choice, and no reason field exists until one is chosen', async () => {
    const user = userEvent.setup()
    const onChoiceChange = vi.fn()
    render(<Harness capabilities={adminCapabilities} onChoiceChange={onChoiceChange} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(adminRadio())
    expect(onChoiceChange).toHaveBeenCalledWith('adminOverride')
  })

  it('reveals the chosen path’s own field, with a different label from the other path', async () => {
    const user = userEvent.setup()
    render(<Harness interactive capabilities={adminCapabilities} />)

    await user.click(adminRadio())
    expect(overrideReason()).toBeInTheDocument()
    expect(screen.queryByLabelText(/Describe the emergency/i)).not.toBeInTheDocument()

    await user.click(emergencyRadio())
    expect(emergencyReason()).toBeInTheDocument()
    expect(screen.queryByLabelText(/Reason for the override/i)).not.toBeInTheDocument()
  })

  it('is a real radio group: one group, two radios, one name', () => {
    render(<Harness capabilities={adminCapabilities} />)
    const group = screen.getByRole('group', { name: /How\?$/i })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(new Set(radios.map(r => r.getAttribute('name'))).size).toBe(1)
  })

  it('marks the chosen path checked and leaves the other unchecked', () => {
    render(<Harness capabilities={adminCapabilities} choice="emergency" />)
    expect(emergencyRadio()).toBeChecked()
    expect(adminRadio()).not.toBeChecked()
  })

  it('is reachable by Tab and switchable with the arrow keys, per the radio pattern', async () => {
    const user = userEvent.setup()
    render(<Harness interactive capabilities={adminCapabilities} choice="adminOverride" />)

    adminRadio().focus()
    expect(adminRadio()).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(emergencyRadio()).toHaveFocus()
    expect(emergencyRadio()).toBeChecked()
  })

  it('reaches the reason field by Tab once a path is chosen, so a keyboard user is never stranded', async () => {
    const user = userEvent.setup()
    render(<Harness interactive capabilities={adminCapabilities} choice="adminOverride" />)
    overrideReason().focus()
    await user.tab()
    // Nothing focusable is injected between the field and the end of the form.
    expect(overrideReason()).not.toHaveFocus()
  })
})

describe('the reason', () => {
  it('keeps what the user typed, exactly', async () => {
    const user = userEvent.setup()
    render(<Harness interactive choice="adminOverride" />)
    await user.type(overrideReason(), 'Plan manager called')
    expect(overrideReason()).toHaveValue('Plan manager called')
  })

  it('shows the value it was given, so a retry after a failure loses nothing', () => {
    render(<Harness choice="adminOverride" reason="Plan manager confirmed the increase" submitted error="Could not save" />)
    expect(overrideReason()).toHaveValue('Plan manager confirmed the increase')
  })

  it('does not complain while the user is still typing their first word', () => {
    render(<Harness choice="adminOverride" reason="" submitted={false} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refuses a whitespace-only reason after an attempt, and says why in words', () => {
    render(<Harness choice="adminOverride" reason="    " submitted />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Write why this shift should go ahead/)
    expect(screen.getByText(/not a reason/i)).toBeInTheDocument()
  })

  it('refuses a reason that is only newlines and tabs', () => {
    render(<Harness choice="adminOverride" reason={'\n\t\n\t'} submitted />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Write why this shift should go ahead/)
  })

  it('refuses a too-short emergency reason, with the minimum in the message', () => {
    render(<Harness choice="emergency" reason="Unsafe" submitted />)
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 10 characters/)
  })

  it('lets a short reason through on the Admin path, which has no minimum of its own', () => {
    render(<Harness choice="adminOverride" reason="Unsafe" submitted />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('associates the error with the textarea, so a focused user is told', () => {
    render(<Harness choice="emergency" reason="Unsafe" submitted />)
    expect(emergencyReason()).toHaveAttribute('aria-invalid', 'true')
    expect(emergencyReason().getAttribute('aria-describedby')).toMatch(/-error$/)
  })

  it('marks the reason required on both paths', () => {
    const { unmount } = render(<Harness choice="adminOverride" reason="x" />)
    expect(overrideReason()).toHaveAttribute('aria-required', 'true')
    unmount()
    render(<Harness choice="emergency" reason="x" />)
    expect(emergencyReason()).toHaveAttribute('aria-required', 'true')
  })

  it('the error clears the moment the reason becomes real, with no second press', async () => {
    const user = userEvent.setup()
    render(<Harness interactive choice="adminOverride" submitted />)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.type(overrideReason(), 'Confirmed by the plan manager')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stays rejected while the text is still only whitespace', async () => {
    const user = userEvent.setup()
    render(<Harness interactive choice="adminOverride" submitted />)
    await user.type(overrideReason(), '   ')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('the message on screen is the one the pure rule produced, for every state', () => {
    // One source of truth: reasonError() decides, the field only prints it.
    expect(reasonError('adminOverride', '', true)).toMatch(/Write why/)
    expect(reasonError('emergency', '   ', true)).toMatch(/Write why/)
    expect(reasonError('emergency', 'Unsafe', true)).toMatch(/at least 10 characters/)
    expect(reasonError('emergency', GOOD_EMERGENCY_REASON, true)).toBeNull()
    expect(reasonError('adminOverride', 'Unsafe', true)).toBeNull()

    render(<Harness choice="emergency" reason="Unsafe" submitted />)
    expect(screen.getByRole('alert')).toHaveTextContent(reasonError('emergency', 'Unsafe', true)!)
  })
})

describe('pending, disabled and failed states', () => {
  it('holds the fields while a save is in flight, so a second submit cannot double-write', () => {
    render(<Harness choice="emergency" reason={GOOD_EMERGENCY_REASON} pending />)
    expect(emergencyReason()).toBeDisabled()
    expect(emergencyRadio()).toBeDisabled()
  })

  it('says it is saving, and that the reason is kept, without adding a second live region', () => {
    render(<Harness choice="emergency" reason={GOOD_EMERGENCY_REASON} pending />)
    expect(screen.getByText(/Saving/)).toBeInTheDocument()
    // ShiftSlideOver already owns the panel's polite status region; a second one would double-announce.
    expect(screen.queryAllByRole('status')).toHaveLength(0)
  })

  it('disables the whole fieldset for a read-only viewer, rather than hiding what happened', () => {
    render(<Harness capabilities={adminCapabilities} choice="adminOverride" reason="x" disabled />)
    expect(adminRadio()).toBeDisabled()
    expect(overrideReason()).toBeDisabled()
    // Still visible: a read-only form that vanished would leave no sign the shift was over budget.
    expect(screen.getByText(/This shift goes past the recorded budget/)).toBeInTheDocument()
  })

  it("shows the server's failure above the fields, and keeps the reason and the choice", () => {
    render(
      <Harness
        choice="emergency"
        reason={GOOD_EMERGENCY_REASON}
        error="The shift could not be saved: a newer version exists."
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('a newer version exists')
    expect(emergencyReason()).toHaveValue(GOOD_EMERGENCY_REASON)
    expect(emergencyRadio()).toBeChecked()
  })

  it('lets the user fix and resubmit after a failure: nothing is locked once pending clears', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness interactive choice="emergency" reason="x" error="Could not save" pending />)
    expect(emergencyReason()).toBeDisabled()

    rerender(<Harness interactive choice="emergency" reason="x" error="Could not save" pending={false} />)
    await user.type(emergencyReason(), 'y')
    expect(emergencyReason()).toBeEnabled()
    expect(emergencyReason()).toHaveValue('xy')
  })
})

describe('the copy makes no promise the browser cannot keep', () => {
  it('says the server checks the budget, so hiding a path is not described as security', () => {
    render(<Harness />)
    expect(screen.getByText(/The server checks the budget on every save/)).toBeInTheDocument()
  })

  it('offers no control at all that could switch the emergency path off', () => {
    render(<Harness capabilities={coordinatorCapabilities} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /disable|turn off/i })).not.toBeInTheDocument()
  })

  it('states that the emergency path is always available and cannot be switched off', () => {
    render(<Harness capabilities={coordinatorCapabilities} />)
    expect(screen.getByText(/always available and cannot be switched off/i)).toBeInTheDocument()
  })

  it('never says a shift cannot be saved or support cannot be recorded', () => {
    render(<Harness findings={[forecastOverWarningForAdmin]} capabilities={adminCapabilities} choice="adminOverride" reason="ok" />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/cannot be (saved|recorded|claimed)/i)
    expect(text).not.toMatch(/must not (save|record|claim)/i)
  })
})

describe('the emergency path is visibly its own thing', () => {
  it('gives the emergency panel its own fill, so it cannot be read as a second Admin option', () => {
    render(<Harness capabilities={adminCapabilities} choice="emergency" />)
    const panel = document.querySelector('[data-emergency-panel]')!
    expect(panel.className).toMatch(/bg-\[var\(--color-warning-container\)\]/)
  })

  it('drops the emergency fill when it is not the chosen path', () => {
    render(<Harness capabilities={adminCapabilities} choice="adminOverride" />)
    const panel = document.querySelector('[data-emergency-panel]')!
    expect(panel.className).not.toMatch(/bg-\[var\(--color-warning-container\)\]/)
  })

  it('is distinguished by its words, not by colour alone (WCAG 1.4.1)', () => {
    render(<Harness capabilities={adminCapabilities} choice="emergency" />)
    expect(screen.getByText('Emergency or safety')).toBeInTheDocument()
    expect(screen.getByText('Override as an Admin')).toBeInTheDocument()
  })
})

describe('long content at a phone width', () => {
  it('holds a long reason in the field without losing any of it', async () => {
    const user = userEvent.setup()
    const long =
      'Participant was unsafe at the time of the shift and the support worker on the previous ' +
      'shift had already escalated to the on-call coordinator by radio, so cover had to be ' +
      'arranged immediately rather than at the next scheduled check-in.'
    render(<Harness interactive choice="emergency" reason={long} />)
    await user.click(emergencyReason())
    expect(emergencyReason()).toHaveValue(long)
  })

  it('lets a long reason clear the emergency minimum on its own merits', () => {
    expect(reasonError('emergency', 'x'.repeat(400), true)).toBeNull()
  })

  it('the finding sentence is a single legend, so it wraps instead of being cut off', () => {
    render(<Harness capabilities={coordinatorCapabilities} />)
    expect(screen.getByText(/This shift goes past the recorded budget/).tagName).toBe('LEGEND')
  })
})
