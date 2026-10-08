import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RejectClaimDialog } from './RejectClaimDialog'

// "Mark as rejected?" asks, optionally, for the NDIA's code. What these tests hold: the four codes that say the funds ran out, and Other, are offered; a rejection with no code is still a rejection;
// what is sent is exactly the code that was chosen or typed (trimmed, at most ten characters), and nothing at all is sent for "Not given".

function setup(props: Partial<React.ComponentProps<typeof RejectClaimDialog>> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<RejectClaimDialog onConfirm={onConfirm} onCancel={onCancel} {...props} />)
  const dialog = screen.getByRole('alertdialog', { name: 'Mark as rejected?' })
  return { onConfirm, onCancel, dialog, code: () => within(dialog).getByRole('combobox', { name: 'NDIA rejection code (optional)' }) }
}

describe('RejectClaimDialog', () => {
  it('asks to mark the claim rejected, and offers the NDIA code as optional: the four funds codes in words, and Other', () => {
    const { dialog, code } = setup()

    expect(dialog).toHaveTextContent('Mark this claim as rejected? This cannot be undone.')
    expect(within(code()).getAllByRole('option').map(option => option.textContent)).toEqual([
      'Not given', 'V17: not enough in the plan', 'V18: not enough in the plan', 'V27: not enough in the funding period', 'V28: not enough in the funding period', 'Other',
    ])
    expect(code()).toHaveValue('')   // optional: Not given until somebody says
    expect(dialog).toHaveTextContent('V17, V18, V27 and V28 say the funds ran out')
    expect(within(dialog).queryByLabelText('The code the NDIA gave')).not.toBeInTheDocument()
  })

  it('says how many claims when it is asked for several at once, and one code goes with all of them', () => {
    const { dialog } = setup({ count: 3 })

    expect(dialog).toHaveTextContent('Mark these 3 claims as rejected? This cannot be undone.')
    expect(dialog).not.toHaveTextContent('Mark this claim as rejected?')
  })

  it('rejects with no code at all by default: null, never an empty string', async () => {
    const user = userEvent.setup()
    const { onConfirm, dialog } = setup()

    await user.click(within(dialog).getByRole('button', { name: 'Mark as Rejected' }))

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(null)
  })

  it.each(['V17', 'V18', 'V27', 'V28'])('sends %s as chosen', async chosen => {
    const user = userEvent.setup()
    const { onConfirm, dialog, code } = setup()

    await user.selectOptions(code(), chosen)
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Rejected' }))

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(chosen)
  })

  it('asks for the code in words under Other, at most ten characters, and sends it trimmed and as typed', async () => {
    const user = userEvent.setup()
    const { onConfirm, dialog, code } = setup()

    await user.selectOptions(code(), 'Other')
    const typed = within(dialog).getByRole('textbox', { name: 'The code the NDIA gave' })
    expect(typed).toHaveAttribute('maxlength', '10')
    expect(dialog).toHaveTextContent('Up to 10 characters.')
    await user.type(typed, '  x99-aa  ')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Rejected' }))

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('x99-aa')
  })

  it('cannot take more than ten characters', async () => {
    const user = userEvent.setup()
    const { dialog, code } = setup()

    await user.selectOptions(code(), 'Other')
    const typed = within(dialog).getByRole('textbox', { name: 'The code the NDIA gave' })
    await user.type(typed, '0123456789ABC')

    expect(typed).toHaveValue('0123456789')
  })

  it('does not reject on an Other that is empty: it says what to do, and Not given clears that', async () => {
    const user = userEvent.setup()
    const { onConfirm, dialog, code } = setup()

    await user.selectOptions(code(), 'Other')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Rejected' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('textbox', { name: 'The code the NDIA gave' })).toBeInvalid()
    expect(dialog).toHaveTextContent('Type the code the NDIA gave, or choose Not given.')

    await user.selectOptions(code(), '')
    expect(dialog).not.toHaveTextContent('Type the code the NDIA gave')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Rejected' }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('treats an Other that is only spaces as empty', async () => {
    const user = userEvent.setup()
    const { onConfirm, dialog, code } = setup()

    await user.selectOptions(code(), 'Other')
    await user.type(within(dialog).getByRole('textbox', { name: 'The code the NDIA gave' }), '   ')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Rejected' }))

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('says the server\'s refusal in the dialog, as an alert, and keeps what was chosen so it can be tried again', async () => {
    const user = userEvent.setup()
    const { dialog, code } = setup({ error: 'The NDIA code is at most 10 characters.' })

    expect(within(dialog).getByRole('alert')).toHaveTextContent('The NDIA code is at most 10 characters.')
    await user.selectOptions(code(), 'V27')
    expect(code()).toHaveValue('V27')
  })

  it('holds the confirm button back while it saves', () => {
    const { dialog } = setup({ loading: true })

    expect(within(dialog).getByRole('button', { name: 'Mark as Rejected' })).toBeDisabled()
  })

  it('calls itself off without sending anything', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel, dialog } = setup()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
