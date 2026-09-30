import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormField } from './FormField'

describe('FormField control sizing', () => {
  it('lets a textarea grow with its rows: min-height + auto height instead of the fixed control height', () => {
    render(
      <FormField label="Notes">
        <textarea rows={3} />
      </FormField>,
    )

    const textarea = screen.getByLabelText('Notes')
    // A fixed h-[var(--control-h)] made every textarea one line tall whatever `rows` said.
    expect(textarea).toHaveClass('min-h-[var(--control-h)]', 'h-auto', 'py-1.5')
    expect(textarea).not.toHaveClass('h-[var(--control-h)]')
    expect(textarea).toHaveAttribute('rows', '3')
    // The rest of the control surface is shared with inputs.
    expect(textarea).toHaveClass('w-full', 'px-3', 'rounded-[var(--radius-sm)]', 'bg-[var(--color-input)]')
  })

  it('keeps inputs and selects on the fixed --control-h height', () => {
    render(
      <>
        <FormField label="Name"><input type="text" /></FormField>
        <FormField label="Region">
          <select>
            <option value="n">North</option>
          </select>
        </FormField>
      </>,
    )

    for (const label of ['Name', 'Region']) {
      const control = screen.getByLabelText(label)
      expect(control).toHaveClass('h-[var(--control-h)]', 'w-full', 'px-3')
      expect(control).not.toHaveClass('h-auto')
      expect(control).not.toHaveClass('min-h-[var(--control-h)]')
    }
  })

  it('still merges a caller className onto a textarea', () => {
    render(
      <FormField label="Notes">
        <textarea className="resize-none" />
      </FormField>,
    )

    expect(screen.getByLabelText('Notes')).toHaveClass('resize-none', 'h-auto')
  })
})

describe('FormField hint API', () => {
  it('links the hint text to a native input via aria-describedby', () => {
    render(
      <FormField label="Notes" hint="Optional notes for this shift">
        <textarea id="notes" />
      </FormField>,
    )

    const field = screen.getByLabelText('Notes')
    const hint = screen.getByText('Optional notes for this shift')
    expect(hint.id).toBeTruthy()
    expect(field).toHaveAttribute('aria-describedby', hint.id)
  })

  it('links the hint text to a custom (non-native) control via aria-describedby', () => {
    function CustomControl(props: { id?: string; 'aria-describedby'?: string; 'aria-labelledby'?: string }) {
      return <button type="button" {...props}>Select…</button>
    }

    render(
      <FormField label="Staff" hint="Leave unassigned to add this shift to the Unfilled lane.">
        <CustomControl />
      </FormField>,
    )

    // aria-labelledby (wired by FormField for custom controls) wins over the button's own text
    // content for its accessible name, so the field is found by the field label, not "Select…".
    const field = screen.getByRole('button', { name: 'Staff' })
    const hint = screen.getByText('Leave unassigned to add this shift to the Unfilled lane.')
    expect(field).toHaveAttribute('aria-describedby', hint.id)
    expect(field).toHaveAttribute('aria-labelledby')
  })

  it('prefers the error over the hint when both are present, but still exposes the hint id', () => {
    render(
      <FormField label="Reason" error="Required" hint="Explain why">
        <textarea id="reason" />
      </FormField>,
    )

    const field = screen.getByLabelText('Reason')
    const error = screen.getByText('Required')
    // The hint text itself is not rendered while an error is showing...
    expect(screen.queryByText('Explain why')).not.toBeInTheDocument()
    // ...and the control is described by the error, not a stale hint id.
    expect(field).toHaveAttribute('aria-describedby', error.id)
  })

  it('folds an externally-rendered description into aria-describedby via descriptionId', () => {
    render(
      <FormField label="Staff" descriptionId="staff-compat-notice">
        <textarea id="staff" />
      </FormField>,
    )

    const field = screen.getByLabelText('Staff')
    expect(field).toHaveAttribute('aria-describedby', 'staff-compat-notice')
  })

  it('combines the built-in hint and an external descriptionId into one aria-describedby', () => {
    render(
      <FormField label="Staff" hint="Leave unassigned to skip." descriptionId="staff-compat-notice">
        <textarea id="staff" />
      </FormField>,
    )

    const field = screen.getByLabelText('Staff')
    const hint = screen.getByText('Leave unassigned to skip.')
    expect(field.getAttribute('aria-describedby')).toBe(`${hint.id} staff-compat-notice`)
  })

  it('gives the checkbox layout a >=44px tall label so the checkbox + text form one touch target', () => {
    render(
      <FormField label="Ends the next day" layout="checkbox">
        <input type="checkbox" />
      </FormField>,
    )

    const label = screen.getByText('Ends the next day').closest('label')
    expect(label).toHaveClass('min-h-[var(--control-h)]')
  })

  it('links a checkbox-layout hint to the checkbox via aria-describedby', () => {
    render(
      <FormField label="High-risk medication" layout="checkbox" hint="Second worker must witness">
        <input type="checkbox" />
      </FormField>,
    )

    const checkbox = screen.getByRole('checkbox')
    const hint = screen.getByText('Second worker must witness')
    expect(checkbox).toHaveAttribute('aria-describedby', hint.id)
  })
})
