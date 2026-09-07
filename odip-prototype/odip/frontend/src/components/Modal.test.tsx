import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
