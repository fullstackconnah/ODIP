import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
