import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog accessibility', () => {
  it('renders as an alertdialog with an accessible name and description', () => {
    render(
      <ConfirmDialog
        open
        onCancel={() => {}}
        onConfirm={() => {}}
        title="Delete record?"
        message="This action cannot be undone."
      />,
    )

    // A confirm that blocks on a decision must be role="alertdialog", not the plain "dialog"
    // Modal.tsx defaults to — see how useUnsavedChangesWarning.tsx wires the same pattern.
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Delete record?')
    expect(dialog).toHaveAccessibleDescription('This action cannot be undone.')
  })
})

describe('ConfirmDialog inside a form', () => {
  it('its Cancel and Confirm buttons are type="button", so answering the dialog never submits an enclosing form', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <form onSubmit={onSubmit}>
        <ConfirmDialog open onCancel={onCancel} onConfirm={onConfirm} title="Remove?" message="Sure?" confirmLabel="Remove" />
      </form>,
    )

    expect(screen.getByRole('button', { name: /cancel/i })).toHaveAttribute('type', 'button')
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute('type', 'button')
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
