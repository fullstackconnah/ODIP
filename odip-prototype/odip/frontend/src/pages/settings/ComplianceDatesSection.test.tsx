import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ComplianceDatesSection from './ComplianceDatesSection'

const { create, update, remove, perms, query } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  perms: { current: { canEditProviderSettings: true } },
  query: { current: {} as Record<string, unknown> },
}))

vi.mock('@/api/hooks', () => ({
  useComplianceItems: () => query.current,
  useCreateComplianceItem: () => ({ mutateAsync: create, isPending: false }),
  useUpdateComplianceItem: () => ({ mutateAsync: update, isPending: false }),
  useDeleteComplianceItem: () => ({ mutateAsync: remove, isPending: false }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => perms.current }))

const row = (over: Record<string, unknown>) => ({ id: 'x', kind: 'Registration', label: 'NDIS registration', expiresOn: '2027-02-14', reference: null, notes: null, daysLeft: 400, ...over })
const lapsed = row({ id: 'a', kind: 'Insurance', label: 'Workers compensation', expiresOn: '2026-11-03', daysLeft: -3 })
const today = row({ id: 'b', kind: 'Audit', label: 'Certification audit', expiresOn: '2026-11-06', daysLeft: 0 })
const soon = row({ id: 'c', kind: 'MidTermAudit', label: 'Midterm check', expiresOn: '2027-01-20', daysLeft: 75, reference: 'MT-9' })
const far = row({ id: 'd', label: 'NDIS registration', daysLeft: 400, notes: 'Renew online' })
const loaded = (data: unknown[]) => ({ data, isLoading: false, isError: false, refetch: vi.fn() })

beforeEach(() => {
  create.mockReset().mockResolvedValue({})
  update.mockReset().mockResolvedValue({})
  remove.mockReset().mockResolvedValue({})
  perms.current = { canEditProviderSettings: true }
  query.current = loaded([lapsed, today, soon, far])
})

describe('ComplianceDatesSection', () => {
  it('lists the columns in the pinned order, and a chip from each row\'s days left', () => {
    render(<ComplianceDatesSection />)
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent)
    expect(headers).toEqual(['Kind', 'Name', 'Expires on', 'Status', 'Reference', 'Actions'])
    const chips = ['Workers compensation', 'Certification audit', 'Midterm check', 'NDIS registration'].map(name => within(screen.getByText(name).closest('tr')!).getAllByText(/Overdue|Due soon|Current/)[0].textContent)
    expect(chips).toEqual(['Overdue', 'Due soon', 'Due soon', 'Current'])
    expect(screen.getByText('MT-9')).toBeInTheDocument()
  })

  it('shows a Coordinator the list with no Add button, no Actions column and no Edit or Delete', () => {
    perms.current = { canEditProviderSettings: false }
    render(<ComplianceDatesSection />)
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Kind', 'Name', 'Expires on', 'Status', 'Reference'])
    expect(screen.queryByRole('button')).toBeNull()
    // The settings frame already says it; a second lock callout stacked under it.
    expect(screen.queryByText('Only Admins can change this list.')).toBeNull()
  })

  it('has one sentence for an empty list per role', () => {
    query.current = loaded([])
    const { unmount } = render(<ComplianceDatesSection />)
    expect(screen.getByText("No compliance dates yet. Start with your registration: add the date it expires, and we'll remind your Admins 90 days before.")).toBeInTheDocument()
    unmount()
    perms.current = { canEditProviderSettings: false }
    render(<ComplianceDatesSection />)
    expect(screen.getByText('No compliance dates yet. An Admin can add them here.')).toBeInTheDocument()
  })

  it('refuses a blank name and date with the sentences and saves nothing', async () => {
    const user = userEvent.setup()
    render(<ComplianceDatesSection />)
    await user.click(screen.getByRole('button', { name: 'Add a date' }))
    expect(screen.getByText("We'll remind your Admins on the Tasks page 90 days before this date.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a name.')).toBeInTheDocument()
    expect(screen.getByText('Enter the date it expires.')).toBeInTheDocument()
  })

  it('refuses a year outside 2000 to 2100', async () => {
    const user = userEvent.setup()
    render(<ComplianceDatesSection />)
    await user.click(screen.getByRole('button', { name: 'Add a date' }))
    await user.type(screen.getByLabelText(/^Name/), 'Old policy')
    await user.type(screen.getByLabelText(/^Expires on/), '1999-12-31')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByText('Use a date between 2000 and 2100.')).toBeInTheDocument()
  })

  it('adds a date, trimming the name and sending empty optional boxes as null', async () => {
    const user = userEvent.setup()
    render(<ComplianceDatesSection />)
    await user.click(screen.getByRole('button', { name: 'Add a date' }))
    await user.selectOptions(screen.getByLabelText(/^Kind/), 'Insurance')
    await user.type(screen.getByLabelText(/^Name/), '  Public liability insurance ')
    await user.type(screen.getByLabelText(/^Expires on/), '2027-02-04')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(create).toHaveBeenCalledWith({ kind: 'Insurance', label: 'Public liability insurance', expiresOn: '2027-02-04', reference: null, notes: null })
    expect(screen.queryByLabelText(/^Name/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Add a date' })).toHaveFocus()
  })

  it('edits a date with its values filled in', async () => {
    const user = userEvent.setup()
    render(<ComplianceDatesSection />)
    await user.click(screen.getByRole('button', { name: 'Edit: NDIS registration' }))
    expect(screen.getByLabelText(/^Name/)).toHaveValue('NDIS registration')
    expect(screen.getByLabelText('Notes')).toHaveValue('Renew online')
    await user.clear(screen.getByLabelText(/^Expires on/))
    await user.type(screen.getByLabelText(/^Expires on/), '2027-03-01')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(update).toHaveBeenCalledWith({ id: 'd', data: { kind: 'Registration', label: 'NDIS registration', expiresOn: '2027-03-01', reference: null, notes: 'Renew online' } })
  })

  it('shows the key personnel hint and placeholder for that kind', async () => {
    const user = userEvent.setup()
    render(<ComplianceDatesSection />)
    await user.click(screen.getByRole('button', { name: 'Add a date' }))
    await user.selectOptions(screen.getByLabelText(/^Kind/), 'KeyPersonnel')
    expect(screen.getByText("The person's name and role.")).toBeInTheDocument()
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute('placeholder', 'e.g. Sam Lee, Chief executive')
  })

  it('keeps the panel open and shows the server sentence when a save fails', async () => {
    create.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { success: false, errors: ['Use a date between 2000 and 2100.'], message: 'Use a date between 2000 and 2100.' } } })
    const user = userEvent.setup()
    render(<ComplianceDatesSection />)
    await user.click(screen.getByRole('button', { name: 'Add a date' }))
    await user.type(screen.getByLabelText(/^Name/), 'Policy')
    await user.type(screen.getByLabelText(/^Expires on/), '2027-02-04')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a date between 2000 and 2100.')
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Policy')
  })

  it('asks before deleting, names the date, and deletes on confirm', async () => {
    const user = userEvent.setup()
    render(<ComplianceDatesSection />)
    await user.click(screen.getByRole('button', { name: 'Delete: Midterm check' }))
    expect(screen.getByText('Delete this date?')).toBeInTheDocument()
    expect(screen.getByText("Delete Midterm check? Its reminder on the Tasks page closes too. This can't be undone.")).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(remove).toHaveBeenCalledWith('c')
  })

  it('says so when a delete fails', async () => {
    remove.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    render(<ComplianceDatesSection />)
    await user.click(screen.getByRole('button', { name: 'Delete: Midterm check' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Could not delete the date. Try again.')).toBeInTheDocument()
  })
})
