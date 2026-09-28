import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextField } from './TextField'
import { SelectField } from './SelectField'

afterEach(() => cleanup())

describe('TextField primitive', () => {
  it('renders a labelled input and associates the label via htmlFor/id', () => {
    render(<TextField label="Full name" />)
    const input = screen.getByLabelText('Full name')
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveAttribute('type', 'text')
  })

  it('renders the required marker and aria-required when required', () => {
    render(<TextField label="Email" required />)
    const input = screen.getByLabelText(/Email/)
    expect(input).toHaveAttribute('aria-required', 'true')
    // The required marker is part of the label text — look it up via the label element
    // (FormField wraps the label inside its own div with the marker character).
    const labelEl = screen.getByText(/Email/).closest('label')!
    expect(labelEl.textContent).toMatch(/\*/)
  })

  it('uses inputClass so styling matches the rest of the form system', () => {
    render(<TextField label="X" />)
    const input = screen.getByLabelText('X')
    expect(input.className).toMatch(/bg-\[var\(--color-input\)\]/)
    expect(input.className).toMatch(/focus:ring-\[var\(--color-ring\)\]/)
  })

  it('renders the hint and links it via aria-describedby', () => {
    render(<TextField label="NDIS number" hint="9 digits" />)
    const input = screen.getByLabelText('NDIS number')
    expect(input).toHaveAttribute('aria-describedby', expect.stringMatching(/-hint$/))
    expect(screen.getByText('9 digits')).toBeInTheDocument()
  })

  it('renders the error and sets aria-invalid + swaps aria-describedby to the error', () => {
    render(<TextField label="Email" error="Required" />)
    const input = screen.getByLabelText(/Email/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toMatch(/-error$/)
    // The error itself is announced via role="alert" (FormField applies this).
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
  })

  it('forwards extra <input> attributes (placeholder, maxLength, type)', () => {
    render(<TextField label="Phone" placeholder="0400 000 000" maxLength={10} type="tel" />)
    const input = screen.getByLabelText('Phone')
    expect(input).toHaveAttribute('placeholder', '0400 000 000')
    expect(input).toHaveAttribute('maxlength', '10')
    expect(input).toHaveAttribute('type', 'tel')
  })

  it('fires onChange with the typed value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextField label="Name" onChange={onChange} />)
    await user.type(screen.getByLabelText('Name'), 'a')
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)![0].target.value).toBe('a')
  })
})

describe('SelectField primitive', () => {
  const opts = [
    { value: 'draft', label: 'Draft' },
    { value: 'submitted', label: 'Submitted' },
    { value: 'approved', label: 'Approved' },
  ]

  it('renders a labelled select with the given options', () => {
    render(<SelectField label="Status" options={opts} />)
    const select = screen.getByLabelText('Status')
    expect(select.tagName).toBe('SELECT')
    const optionEls = select.querySelectorAll('option')
    expect(optionEls).toHaveLength(3)
    expect(screen.getByRole('option', { name: 'Draft' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Submitted' })).toBeInTheDocument()
  })

  it('renders a disabled placeholder option when `placeholder` is set', () => {
    const { container } = render(<SelectField label="Status" options={opts} placeholder="Choose…" />)
    // The placeholder is `hidden` (only visible until selection) so it's not in the
    // accessible role tree; inspect it via the rendered DOM directly.
    const select = container.querySelector('select')!
    const placeholderOption = select.querySelector('option')!
    expect(placeholderOption.textContent).toBe('Choose…')
    expect(placeholderOption).toBeDisabled()
    expect(placeholderOption.hidden).toBe(true)
    expect(placeholderOption.value).toBe('')
  })

  it('renders the required marker and aria-required when required', () => {
    render(<SelectField label="Status" required options={opts} />)
    expect(screen.getByLabelText(/Status/)).toHaveAttribute('aria-required', 'true')
    const labelEl = screen.getByText(/Status/).closest('label')!
    expect(labelEl.textContent).toMatch(/\*/)
  })

  it('renders the error and sets aria-invalid', () => {
    render(<SelectField label="Status" error="Pick one" options={opts} />)
    const select = screen.getByLabelText(/Status/)
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Pick one')
  })

  it('respects disabled options', () => {
    const optsWithDisabled = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true },
    ]
    render(<SelectField label="Pick" options={optsWithDisabled} />)
    expect(screen.getByRole('option', { name: 'B' })).toBeDisabled()
  })

  it('fires onChange when the value changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SelectField label="Status" options={opts} onChange={onChange} />)
    await user.selectOptions(screen.getByLabelText('Status'), 'submitted')
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)![0].target.value).toBe('submitted')
  })
})
