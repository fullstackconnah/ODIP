import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ActivityLibraryTab from './ActivityLibraryTab'

const { create, update, perms, rows } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  perms: { current: { isSuperAdmin: false, isAdmin: true, isCoordinator: false } },
  rows: { current: [] as unknown[] },
}))

vi.mock('@/api/hooks', () => ({
  useActivities: () => ({ data: rows.current, isLoading: false }),
  useCreateActivity: () => ({ mutateAsync: create, isPending: false }),
  useUpdateActivity: () => ({ mutateAsync: update, isPending: false }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => perms.current }))

const beach = { id: 'a1', eventTemplateId: null, activityName: 'Beach walk', category: 'Leisure', location: 'Burleigh', accessibilityNotes: null, suitabilityNotes: null, notes: null, isActive: true }
const old = { ...beach, id: 'a2', activityName: 'Old tour', isActive: false }

beforeEach(() => {
  create.mockReset().mockResolvedValue({})
  update.mockReset().mockResolvedValue({})
  perms.current = { isSuperAdmin: false, isAdmin: true, isCoordinator: false }
  rows.current = [beach, old]
})

describe('ActivityLibraryTab', () => {
  it('adds an activity', async () => {
    const user = userEvent.setup()
    render(<ActivityLibraryTab />)
    await user.click(screen.getByRole('button', { name: '+ New Activity' }))
    expect(screen.getByRole('dialog', { name: 'New Activity' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Name/), 'Kayak')
    await user.selectOptions(screen.getByLabelText('Category'), 'Sport')
    await user.click(screen.getByRole('button', { name: 'Create Activity' }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ activityName: 'Kayak', category: 'Sport', isActive: true }))
  })

  it('refuses a blank name: the error is announced, focus moves to Name, and typing clears it', async () => {
    const user = userEvent.setup()
    render(<ActivityLibraryTab />)
    await user.click(screen.getByRole('button', { name: '+ New Activity' }))
    await user.click(screen.getByRole('button', { name: 'Create Activity' }))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
    expect(screen.getByLabelText(/Name/)).toHaveFocus()
    await user.type(screen.getByLabelText(/Name/), 'K')
    expect(screen.queryByText('Required')).toBeNull()
    expect(screen.getByLabelText(/Name/)).not.toHaveAttribute('aria-invalid')
  })

  it('edits an activity', async () => {
    const user = userEvent.setup()
    render(<ActivityLibraryTab />)
    await user.click(screen.getByRole('button', { name: 'Edit Beach walk' }))
    expect(screen.getByRole('dialog', { name: 'Edit Activity' })).toBeInTheDocument()
    const name = screen.getByLabelText(/Name/)
    await user.clear(name)
    await user.type(name, 'Beach stroll')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(update).toHaveBeenCalledWith({ id: 'a1', data: expect.objectContaining({ activityName: 'Beach stroll', location: 'Burleigh', isActive: true }) })
  })

  it('deactivates only after a confirm, with isActive false', async () => {
    const user = userEvent.setup()
    render(<ActivityLibraryTab />)
    await user.click(screen.getByRole('button', { name: 'Edit Beach walk' }))
    await user.click(screen.getByRole('button', { name: 'Deactivate activity' }))
    expect(update).not.toHaveBeenCalled()
    expect(screen.getByText('Deactivate this activity?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(update).toHaveBeenCalledWith({ id: 'a1', data: expect.objectContaining({ activityName: 'Beach walk', isActive: false }) })
  })

  it('marks an inactive activity in the list and in its edit form, and reactivates it', async () => {
    const user = userEvent.setup()
    render(<ActivityLibraryTab />)
    expect(screen.getByText('Inactive activities are hidden from the trip picker.')).toBeInTheDocument()
    const row = screen.getByText('Old tour').closest('tr')!
    expect(within(row).getByText('Inactive')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Edit Old tour' }))
    expect(screen.getByText('This activity is inactive, so it does not appear when adding activities to a trip.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reactivate activity' }))
    expect(update).toHaveBeenLastCalledWith({ id: 'a2', data: expect.objectContaining({ isActive: true }) })
  })

  it('shows the empty state when there are no activities', () => {
    rows.current = []
    render(<ActivityLibraryTab />)
    expect(screen.getByText('No activities yet. Add one to offer it when planning trips.')).toBeInTheDocument()
  })

  it('shows no write controls to a support worker', () => {
    perms.current = { isSuperAdmin: false, isAdmin: false, isCoordinator: false }
    render(<ActivityLibraryTab />)
    expect(screen.getByText('Beach walk')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('ActivityLibraryTab — a rejected save', () => {
  it('shows the error and keeps what was typed', async () => {
    update.mockRejectedValue({ response: { data: { errors: ['boom'] } } })
    const user = userEvent.setup()
    render(<ActivityLibraryTab />)
    await user.click(screen.getByRole('button', { name: 'Edit Beach walk' }))
    const name = screen.getByLabelText(/Name/)
    await user.clear(name)
    await user.type(name, 'Beach stroll')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(screen.getByLabelText(/Name/)).toHaveValue('Beach stroll')
  })
})
