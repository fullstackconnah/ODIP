import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReferralSourcesSection from './ReferralSourcesSection'

const { create, update, perms, query } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  perms: { current: { isSuperAdmin: false, isAdmin: true, isCoordinator: false } },
  query: { current: {} as Record<string, unknown> },
}))

vi.mock('@/api/hooks', () => ({
  useReferralSources: () => query.current,
  useCreateReferralSource: () => ({ mutateAsync: create, isPending: false }),
  useUpdateReferralSource: () => ({ mutateAsync: update, isPending: false }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => perms.current }))

const hospital = { id: 'r1', name: 'Hospital', isActive: true }
const gp = { id: 'r2', name: 'GP', isActive: true }
const clinic = { id: 'r3', name: 'Closed clinic', isActive: false }
const loaded = (data: unknown[]) => ({ data, isLoading: false, isError: false, refetch: vi.fn() })

beforeEach(() => {
  create.mockReset().mockResolvedValue({})
  update.mockReset().mockResolvedValue({})
  perms.current = { isSuperAdmin: false, isAdmin: true, isCoordinator: false }
  query.current = loaded([hospital, gp, clinic])
})

describe('ReferralSourcesSection', () => {
  it('lists active sources, then hidden ones under "Hidden"', () => {
    render(<ReferralSourcesSection />)
    expect(screen.getByText('Hospital')).toBeInTheDocument()
    const hidden = screen.getByRole('heading', { name: 'Hidden' }).closest('section')!
    expect(within(hidden).getByText('Closed clinic')).toBeInTheDocument()
    expect(within(hidden).queryByText('Hospital')).toBeNull()
  })

  it('adds a source and closes the input', async () => {
    const user = userEvent.setup()
    render(<ReferralSourcesSection />)
    await user.click(screen.getByRole('button', { name: 'Add a source' }))
    expect(screen.getByLabelText('Source name')).toHaveFocus()
    await user.type(screen.getByLabelText('Source name'), '  Another provider ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(create).toHaveBeenCalledWith({ name: 'Another provider' })
    expect(screen.queryByLabelText('Source name')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add a source' })).toHaveFocus()
  })

  it('refuses a blank name with the sentence', async () => {
    const user = userEvent.setup()
    render(<ReferralSourcesSection />)
    await user.click(screen.getByRole('button', { name: 'Add a source' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.')
  })

  it('shows the 409 sentence inline and keeps the input open', async () => {
    create.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { success: false, errors: ['That source is already on the list.'], message: 'That source is already on the list.' } } })
    const user = userEvent.setup()
    render(<ReferralSourcesSection />)
    await user.click(screen.getByRole('button', { name: 'Add a source' }))
    await user.type(screen.getByLabelText('Source name'), 'hospital')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That source is already on the list.')
    expect(screen.getByLabelText('Source name')).toHaveValue('hospital')
  })

  it('Hide and Show send isActive only', async () => {
    const user = userEvent.setup()
    render(<ReferralSourcesSection />)
    await user.click(screen.getByRole('button', { name: 'Hide: Hospital' }))
    expect(update).toHaveBeenLastCalledWith({ id: 'r1', data: { isActive: false } })
    await user.click(screen.getByRole('button', { name: 'Show: Closed clinic' }))
    expect(update).toHaveBeenLastCalledWith({ id: 'r3', data: { isActive: true } })
  })

  it('renames a source in its row', async () => {
    const user = userEvent.setup()
    render(<ReferralSourcesSection />)
    await user.click(screen.getByRole('button', { name: 'Rename: GP' }))
    const box = screen.getByLabelText('Source name')
    await user.clear(box)
    await user.type(box, 'GP or nurse')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(update).toHaveBeenCalledWith({ id: 'r2', data: { name: 'GP or nurse' } })
  })

  it('is read-only for staff: no Add, Rename, Hide or Show, and a note says why', () => {
    perms.current = { isSuperAdmin: false, isAdmin: false, isCoordinator: false }
    render(<ReferralSourcesSection />)
    expect(screen.getByText('Only Admins and Coordinators can change this list.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a source' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Rename|Hide|Show):/ })).toBeNull()
    expect(screen.getByText('Hospital')).toBeInTheDocument()
  })

  it('shows the empty sentence', () => {
    query.current = loaded([])
    render(<ReferralSourcesSection />)
    expect(screen.getByText('No referral sources yet. Add the places your enquiries come from, like a support coordinator or GP.')).toBeInTheDocument()
  })

  it('shows the error state with a retry', async () => {
    const refetch = vi.fn()
    query.current = { data: undefined, isLoading: false, isError: true, refetch }
    const user = userEvent.setup()
    render(<ReferralSourcesSection />)
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows the loading state', () => {
    query.current = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() }
    render(<ReferralSourcesSection />)
    expect(screen.queryByText('Hospital')).toBeNull()
    expect(screen.queryByText(/No referral sources yet/)).toBeNull()
  })
})
