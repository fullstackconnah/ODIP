import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextAreaField } from './TextAreaField'

afterEach(() => cleanup())

describe('TextAreaField primitive', () => {
  it('renders a labelled textarea and associates the label via htmlFor/id', () => {
    render(<TextAreaField label="Summary" />)
    const textarea = screen.getByLabelText('Summary')
    expect(textarea.tagName).toBe('TEXTAREA')
  })

  it('renders the required marker and aria-required when required', () => {
    render(<TextAreaField label="Notes" required />)
    const textarea = screen.getByLabelText(/Notes/)
    expect(textarea).toHaveAttribute('aria-required', 'true')
    const labelEl = screen.getByText(/Notes/).closest('label')!
    expect(labelEl.textContent).toMatch(/\*/)
  })

  it('uses inputClass so styling matches the rest of the form system', () => {
    render(<TextAreaField label="X" />)
    const textarea = screen.getByLabelText('X')
    expect(textarea.className).toMatch(/bg-\[var\(--color-input\)\]/)
    expect(textarea.className).toMatch(/focus:ring-\[var\(--color-ring\)\]/)
  })

  it('renders the hint and links it via aria-describedby', () => {
    render(<TextAreaField label="Background" hint="One paragraph max" />)
    const textarea = screen.getByLabelText('Background')
    expect(textarea).toHaveAttribute('aria-describedby', expect.stringMatching(/-hint$/))
    expect(screen.getByText('One paragraph max')).toBeInTheDocument()
  })

  it('renders the error and sets aria-invalid + swaps aria-describedby to the error', () => {
    render(<TextAreaField label="Reason" error="Required" />)
    const textarea = screen.getByLabelText(/Reason/)
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea.getAttribute('aria-describedby')).toMatch(/-error$/)
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
  })

  it('forwards extra <textarea> attributes (rows, placeholder, disabled)', () => {
    render(<TextAreaField label="Notes" rows={4} placeholder="Type here…" disabled />)
    const textarea = screen.getByLabelText('Notes')
    expect(textarea).toHaveAttribute('rows', '4')
    expect(textarea).toHaveAttribute('placeholder', 'Type here…')
    expect(textarea).toBeDisabled()
  })

  it('fires onChange with the typed value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextAreaField label="Notes" onChange={onChange} />)
    await user.type(screen.getByLabelText('Notes'), 'a')
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)![0].target.value).toBe('a')
  })
})
