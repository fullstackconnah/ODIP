import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UserFormPanel from './UserFormPanel'
import type { AdminUserDto } from '@/api/types'

vi.mock('@/api/hooks', () => ({
  useAdminTenantsSummary: () => ({ data: [{ id: 'tenant-1', name: 'Sample Support Co' }] }),
  useCreateAdminUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAdminUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const user1: AdminUserDto = {
  id: 'user-1',
  firstName: 'Ann',
  lastName: 'One',
  fullName: 'Ann One',
  email: 'ann@example.com',
  username: 'ann',
  role: 'Coordinator',
  tenantId: 'tenant-1',
  tenantName: 'Sample Support Co',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  lastLoginAt: null,
}

describe('UserFormPanel as a dialog', () => {
  it('is a modal dialog named "New User" or "Edit User", closed when isOpen is false', () => {
    const { rerender } = render(<UserFormPanel isOpen={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<UserFormPanel isOpen onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'New User' })).toHaveAttribute('aria-modal', 'true')
    rerender(<UserFormPanel isOpen onClose={() => {}} user={user1} />)
    expect(screen.getByRole('dialog', { name: 'Edit User' })).toBeInTheDocument()
  })

  it('an untouched panel closes on Escape without asking, in edit mode and in create mode with a default tenant', async () => {
    const u = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<UserFormPanel isOpen onClose={onClose} user={user1} />)
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Ann')
    await u.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    onClose.mockClear()
    rerender(<UserFormPanel isOpen={false} onClose={onClose} />)
    rerender(<UserFormPanel isOpen onClose={onClose} defaultTenantId="tenant-1" />)
    await u.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('an edit makes Escape ask first; Keep editing keeps what was typed; undoing the edit makes it clean again', async () => {
    const u = userEvent.setup()
    const onClose = vi.fn()
    render(<UserFormPanel isOpen onClose={onClose} user={user1} />)
    await u.type(screen.getByLabelText(/first name/i), 'ie')

    await u.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Annie')

    await u.type(screen.getByLabelText(/first name/i), '{Backspace}{Backspace}')
    await u.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the footer Cancel closes at once, even after an edit', async () => {
    const u = userEvent.setup()
    const onClose = vi.fn()
    render(<UserFormPanel isOpen onClose={onClose} user={user1} />)
    await u.type(screen.getByLabelText(/first name/i), 'ie')
    await u.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
