import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TextField } from './TextField'
import { TextAreaField } from './TextAreaField'
import { SelectField } from './SelectField'

// L5-03: the three field primitives took `required`, drew the star and set aria-required, but never put the HTML `required`
// attribute on the control, so a plain form lost its native "fill this in" check. The enquiry form (no JS validation of its own)
// then posted empty names, and the API's 400 was answered with a generic banner.
describe('form field primitives honour `required`', () => {
  it('TextField sets the HTML required attribute on the input', () => {
    render(<TextField id="first" label="First name" required defaultValue="" />)

    expect(screen.getByLabelText(/first name/i)).toHaveAttribute('required')
  })

  it('TextAreaField sets the HTML required attribute on the textarea', () => {
    render(<TextAreaField id="notes" label="Notes" required defaultValue="" />)

    expect(screen.getByLabelText(/notes/i)).toHaveAttribute('required')
  })

  it('SelectField sets the HTML required attribute on the select', () => {
    render(<SelectField id="source" label="Source" required defaultValue="Web" options={[{ value: 'Web', label: 'Web' }]} />)

    expect(screen.getByLabelText(/source/i)).toHaveAttribute('required')
  })

  it('sets nothing when the field is optional', () => {
    render(
      <>
        <TextField id="a" label="Alpha" defaultValue="" />
        <TextAreaField id="b" label="Bravo" defaultValue="" />
        <SelectField id="c" label="Charlie" defaultValue="x" options={[{ value: 'x', label: 'x' }]} />
      </>,
    )

    for (const name of [/alpha/i, /bravo/i, /charlie/i]) expect(screen.getByLabelText(name)).not.toHaveAttribute('required')
  })
})
