import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TenantFormPanel from './TenantFormPanel'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('@/api/hooks/admin', () => ({
  useCreateTenantWithSetup: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
}))

// A sole trader on a personal address has no email domain, and every new organisation chooses its state (nothing is pre-selected, so no one
// is silently put on Victoria's prices and holidays). The provider row is always sent, with the organisation's name in it.

const stateRadio = (name: string) => screen.getByRole('radio', { name })
const create = () => screen.getByRole('button', { name: 'Create tenant' })

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ id: 't1', name: 'Jo Care', emailDomain: null, isActive: true, createdAt: '2026-01-01T00:00:00Z', userCount: 0 })
})

describe('TenantFormPanel create: optional domain, required state', () => {
  it('says the domain can be left blank, and starts with no state chosen', () => {
    render(<TenantFormPanel isOpen onClose={vi.fn()} />)
    expect(screen.getByLabelText('Email Domain')).toHaveAccessibleDescription('Leave blank if your staff use personal addresses')
    screen.getAllByRole('radio', { name: /^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/ }).forEach(r => expect(r).not.toBeChecked())
  })

  it('names the state group "State" and marks it required', () => {
    render(<TenantFormPanel isOpen onClose={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: 'State' })).toBeRequired()
  })

  it('waits for a name and a state, but not for a domain', async () => {
    const u = userEvent.setup()
    render(<TenantFormPanel isOpen onClose={vi.fn()} />)
    await u.type(screen.getByPlaceholderText('e.g. Acme Travel Co'), 'Jo Care')
    expect(create()).toBeDisabled()
    await u.click(stateRadio('WA'))
    expect(create()).toBeEnabled()
  })

  it('sends a blank domain, the chosen state and the organisation name in the provider settings', async () => {
    const u = userEvent.setup()
    render(<TenantFormPanel isOpen onClose={vi.fn()} />)
    await u.type(screen.getByPlaceholderText('e.g. Acme Travel Co'), 'Jo Care')
    await u.click(stateRadio('WA'))
    await u.click(create())

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jo Care', emailDomain: '', initialUser: null,
      providerSettings: expect.objectContaining({ state: 'WA', organisationName: 'Jo Care', registrationNumber: '', abn: '', address: '', gstRegistered: false, isPaceProvider: false }),
    }))
  })

  it('prefills the provider section\'s organisation name from the name above, until it is edited', async () => {
    const u = userEvent.setup()
    render(<TenantFormPanel isOpen onClose={vi.fn()} />)
    await u.type(screen.getByPlaceholderText('e.g. Acme Travel Co'), 'Jo Care')
    await u.click(screen.getByRole('button', { name: /provider settings/i }))
    const legal = screen.getByPlaceholderText('Legal entity name')
    expect(legal).toHaveValue('Jo Care')

    await u.clear(legal)
    await u.type(legal, 'Jo Care Pty Ltd')
    await u.type(screen.getByPlaceholderText('e.g. Acme Travel Co'), ' Services')
    expect(legal).toHaveValue('Jo Care Pty Ltd')
  })

  it('keeps what was typed and shows the server\'s refusal', async () => {
    mockCreate.mockRejectedValue({ response: { data: { errors: ['A tenant with this email domain already exists'] } } })
    const u = userEvent.setup()
    render(<TenantFormPanel isOpen onClose={vi.fn()} />)
    await u.type(screen.getByPlaceholderText('e.g. Acme Travel Co'), 'Jo Care')
    await u.type(screen.getByPlaceholderText('e.g. acme.com.au'), 'jo.example.com')
    await u.click(stateRadio('SA'))
    await u.click(create())

    expect(await screen.findByText('A tenant with this email domain already exists')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. Acme Travel Co')).toHaveValue('Jo Care')
    expect(screen.getByPlaceholderText('e.g. acme.com.au')).toHaveValue('jo.example.com')
    expect(stateRadio('SA')).toBeChecked()
  })
})
