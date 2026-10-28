import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UserFormPanel from './UserFormPanel'
import type { AdminUserDto } from '@/api/types'

const { mockTenantsSummary, mockUpdateMutateAsync } = vi.hoisted(() => ({
  mockTenantsSummary: vi.fn<(enabled?: boolean) => { data: { id: string; name: string }[] }>(() => ({ data: [{ id: 'tenant-1', name: 'Sample Support Co' }] })),
  mockUpdateMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAdminTenantsSummary: mockTenantsSummary,
  useCreateAdminUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAdminUser: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
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

// CORE-4: Settings mounts this panel for every role that opens Settings, and GET /admin/tenants is SuperAdmin only: it reads the tenants only while open
// (it opens from the SuperAdmin-only Users tab).
describe('UserFormPanel — the tenants request', () => {
  it('asks for the tenants only while the panel is open', () => {
    const { rerender } = render(<UserFormPanel isOpen={false} onClose={() => {}} />)
    expect(mockTenantsSummary).toHaveBeenLastCalledWith(false)
    rerender(<UserFormPanel isOpen onClose={() => {}} />)
    expect(mockTenantsSummary).toHaveBeenLastCalledWith(true)
  })
})

// The Users form has no staff-profile fields: an edit sends the identity fields only, and the server leaves the staff profile on the row alone.
describe('UserFormPanel — edit payload', () => {
  it('sends only the identity fields and the role on an edit', async () => {
    mockUpdateMutateAsync.mockResolvedValue({ success: true, data: user1 })
    const u = userEvent.setup()
    render(<UserFormPanel isOpen onClose={() => {}} user={user1} />)

    await u.click(screen.getByRole('button', { name: 'Role *' }))
    await u.click(await screen.findByRole('option', { name: 'Support Worker' }))
    await u.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const { id, data } = mockUpdateMutateAsync.mock.calls[0][0]
    expect(id).toBe('user-1')
    expect(Object.keys(data).sort()).toEqual(['addressConfirmed', 'email', 'firstName', 'isActive', 'lastName', 'role', 'username'])
    expect(data).toEqual({ firstName: 'Ann', lastName: 'One', email: 'ann@example.com', username: 'ann', role: 'SupportWorker', isActive: true })
  })
})

// V-D2 follow-up: the Active toggle is named by its label (the house CheckboxField), as TenantFormPanel's twin is.
describe('UserFormPanel — Active toggle', () => {
  it('is a named checkbox that reports and flips its state', async () => {
    const u = userEvent.setup()
    render(<UserFormPanel isOpen onClose={() => {}} user={user1} />)
    const toggle = screen.getByRole('checkbox', { name: 'Active' })
    expect(toggle).toBeChecked()
    await u.click(toggle)
    expect(toggle).not.toBeChecked()
  })
})

describe('UserFormPanel inputs', () => {
  it('use the house Field Grey input surface, not a local fill', () => {
    render(<UserFormPanel isOpen onClose={() => {}} user={user1} />)
    expect(screen.getByLabelText(/first name/i).className).toContain('bg-[var(--color-input)]')
  })
})
