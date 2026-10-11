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
  useActivities: () => ({ data: rows.current }),
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
    await user.click(screen.getByRole('button', { name: 'Add activity' }))
    await user.type(screen.getByLabelText(/Name/), 'Kayak')
    await user.selectOptions(screen.getByLabelText('Category'), 'Sport')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ activityName: 'Kayak', category: 'Sport', isActive: true }))
  })

  it('refuses a blank name with a field error', async () => {
    const user = userEvent.setup()
    render(<ActivityLibraryTab />)
    await user.click(screen.getByRole('button', { name: 'Add activity' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByText('Required')).toBeInTheDocument()
  })

  it('edits an activity', async () => {
    const user = userEvent.setup()
    render(<ActivityLibraryTab />)
    await user.click(screen.getByRole('button', { name: 'Edit Beach walk' }))
    const name = screen.getByLabelText(/Name/)
    await user.clear(name)
    await user.type(name, 'Beach stroll')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(update).toHaveBeenCalledWith({ id: 'a1', data: expect.objectContaining({ activityName: 'Beach stroll', location: 'Burleigh', isActive: true }) })
  })

  it('deactivates with isActive false and reactivates an inactive row', async () => {
    const user = userEvent.setup()
    render(<ActivityLibraryTab />)
    await user.click(screen.getByRole('button', { name: 'Deactivate Beach walk' }))
    expect(update).toHaveBeenCalledWith({ id: 'a1', data: expect.objectContaining({ isActive: false }) })
    const row = screen.getByText('Old tour').closest('tr')!
    expect(within(row).getByText('Inactive')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Reactivate Old tour' }))
    expect(update).toHaveBeenLastCalledWith({ id: 'a2', data: expect.objectContaining({ isActive: true }) })
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
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(screen.getByLabelText(/Name/)).toHaveValue('Beach stroll')
  })
})
