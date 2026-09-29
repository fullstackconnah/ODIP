import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CheckboxField } from './CheckboxField'

afterEach(() => cleanup())

describe('CheckboxField primitive', () => {
  it('renders a labelled checkbox findable by its accessible name', () => {
    render(<CheckboxField label="High support" />)
    const checkbox = screen.getByRole('checkbox', { name: /High support/ })
    expect(checkbox.tagName).toBe('INPUT')
    expect(checkbox).toHaveAttribute('type', 'checkbox')
  })

  it('keeps the checkbox on the left of its label (matches existing call-site DOM)', () => {
    const { container } = render(<CheckboxField label="High support" />)
    const label = container.querySelector('label')!
    expect(label).not.toBeNull()
    // First child element inside the label should be the <input>; the label text is in a
    // <span> as the second child — matches FormField's checkbox layout order.
    const firstChild = label.firstElementChild
    expect(firstChild?.tagName).toBe('INPUT')
    expect(firstChild?.getAttribute('type')).toBe('checkbox')
    const span = label.querySelector('span')
    expect(span?.textContent).toBe('High support')
  })

  it('renders the required marker on the label when required', () => {
    render(<CheckboxField label="High support" required />)
    // FormField's checkbox layout only wires aria-required on the input when the field
    // gets the attribute *via the control*; the layout branch doesn't push it through
    // itself (the rest of the codebase relies on the label marker). Assert the visible
    // marker instead.
    const labelEl = screen.getByText(/High support/).closest('label')!
    expect(labelEl.textContent).toMatch(/\*/)
  })

  it('renders the hint and links it via aria-describedby', () => {
    render(<CheckboxField label="High risk medication" hint="Second worker must witness" />)
    const checkbox = screen.getByRole('checkbox', { name: /High risk medication/ })
    expect(checkbox).toHaveAttribute('aria-describedby', expect.stringMatching(/-hint$/))
    expect(screen.getByText('Second worker must witness')).toBeInTheDocument()
  })

  it('does not render an error element in checkbox layout (FormField surfaces errors in the default layout only)', () => {
    render(<CheckboxField label="Consent" error="Required" />)
    // FormField's checkbox layout branch deliberately omits the role="alert" error that
    // the default layout renders — single checkboxes are rarely paired with validation
    // messages, and the existing call sites in the repo don't rely on it. The `error`
    // prop is still accepted (to keep the prop surface identical to TextField/etc.) but
    // is intentionally a no-op in this layout. Assert the no-op explicitly so any future
    // change that starts rendering the alert is a deliberate, reviewed decision.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('respects disabled state', () => {
    render(<CheckboxField label="Consent" disabled />)
    expect(screen.getByRole('checkbox', { name: /Consent/ })).toBeDisabled()
  })

  it('toggling fires onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CheckboxField label="Consent" onChange={onChange} />)
    await user.click(screen.getByRole('checkbox', { name: /Consent/ }))
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)![0].target.checked).toBe(true)
  })

  it('gives the wrapping label a >=44px tall hit area so checkbox + text are one touch target', () => {
    render(<CheckboxField label="High support" />)
    const label = screen.getByText('High support').closest('label')
    expect(label).toHaveClass('min-h-[var(--control-h)]')
  })
})
