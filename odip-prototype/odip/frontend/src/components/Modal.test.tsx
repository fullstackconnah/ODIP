import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal'

describe('Modal closeOnBackdrop', () => {
  it('closes on a backdrop click by default', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Example">
        <p>Body</p>
      </Modal>,
    )

    // The backdrop is the outer fixed-position element wrapping the dialog.
    await user.click(screen.getByRole('dialog').parentElement!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on a backdrop click when closeOnBackdrop is false', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Example" closeOnBackdrop={false}>
        <p>Body</p>
      </Modal>,
    )

    await user.click(screen.getByRole('dialog').parentElement!)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('still closes via the header close button when closeOnBackdrop is false', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Example" closeOnBackdrop={false}>
        <p>Body</p>
      </Modal>,
    )

    await user.click(screen.getByRole('button'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Modal inside a form', () => {
  it('its close button is type="button", so closing the dialog never submits an enclosing form', async () => {
    // The dialog renders inline, so one opened from inside a <form> (the Profile wizard's embedded Contacts
    // editor) sits in that form's DOM. An untyped <button> is a submit button there.
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Modal open onClose={onClose} title="Example"><p>Body</p></Modal>
      </form>,
    )

    const close = within(screen.getByRole('dialog')).getAllByRole('button')[0]
    expect(close).toHaveAttribute('type', 'button')
    await user.click(close)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
