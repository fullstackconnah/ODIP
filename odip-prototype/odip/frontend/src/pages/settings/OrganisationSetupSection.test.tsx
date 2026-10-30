import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { ProviderSettingsDto, PlanPricingSettingsDto } from '@/api/types'
import OrganisationSetupSection from './OrganisationSetupSection'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  apiGet: api.get,
  apiGetWithDefault: async (url: string, fallback: unknown) => (await api.get(url)) ?? fallback,
  apiPut: api.put, apiPost: api.post, apiPatch: api.patch, apiDelete: api.delete,
}))

const provider: ProviderSettingsDto = {
  id: 'synthetic-provider', registrationNumber: 'not-shown-registration', abn: 'not-shown-abn',
  organisationName: 'Synthetic Support', address: '1 Example Street', state: 'VIC', gstRegistered: true, isPaceProvider: true,
  bankAccountName: 'PRIVATE BANK NAME', bsb: '123-456', accountNumber: '987654321', invoiceFooterNotes: 'PRIVATE FOOTER',
  managerName: 'PRIVATE MANAGER', managerPhone: 'PRIVATE PHONE', participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce',
  updatedAt: '2026-10-23T01:00:00.123456Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}
const pricing: PlanPricingSettingsDto = {
  registrationGroupsHeld: ['0107'], registrationGroupsConfirmed: true, crossingPolicy: 'Split', claimProviderTravel: true,
  travelKmRateStandard: 0.99, travelKmRateAccessible: 2.76, travelRatesProvisional: false, groupOutings: 'GroupActivities',
  staUsesHourlyAndAccommodation: true, approverRoles: ['Admin'], approvalActivatesParticipant: false, isDefault: false,
}
const clients: QueryClient[] = []
function show(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  clients.push(client)
  return { client, ...render(<QueryClientProvider client={client}><MemoryRouter><OrganisationSetupSection /></MemoryRouter></QueryClientProvider>) }
}
const row = (name: string) => screen.getByRole('heading', { name }).closest('li')!
function respond(details: ProviderSettingsDto | null = provider, groups: PlanPricingSettingsDto | null = pricing) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/provider-settings') return details
    if (url === '/plan-pricing/settings') return groups
    throw new Error(`Unexpected request ${url}`)
  })
}
beforeEach(() => { vi.clearAllMocks(); respond() })
afterEach(() => { clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true); vi.restoreAllMocks() })

describe('Organisation setup read-only facts', () => {
  it('shows only narrow recorded facts, correct destinations and no writes, storage or sensitive values', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const log = vi.spyOn(console, 'log')
    const { container } = show()
    expect(await screen.findByText('Details recorded')).toBeInTheDocument()
    expect(await screen.findByText('Registration groups confirmed')).toBeInTheDocument()
    expect(within(row('Billing details')).getByText('Review')).toBeInTheDocument()
    expect(within(row('Safety checks')).getByText('Review')).toBeInTheDocument()
    for (const [name, target] of [['Open organisation profile', 'organisation'], ['Open plan pricing', 'pricing'], ['Open billing details', 'billing'], ['Open safety checks', 'safety']]) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', `/settings?section=${target}`)
    }
    for (const value of ['PRIVATE', '123-456', '987654321', 'not-shown', 'Synthetic Support', '1 Example Street', 'Enforce']) {
      expect(container.innerHTML).not.toContain(value)
    }
    expect(container.querySelector('input,select,textarea')).toBeNull()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(storage).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    for (const write of [api.put, api.post, api.patch, api.delete]) expect(write).not.toHaveBeenCalled()
    expect(api.get.mock.calls.map(call => call[0]).sort()).toEqual(['/plan-pricing/settings', '/provider-settings'])
  })

  it.each([
    ['no row', null], ['blank name', { ...provider, organisationName: ' ' }],
    ['blank address', { ...provider, address: ' ' }], ['unknown state', { ...provider, state: 'ZZ' }],
  ])('does not claim details recorded for %s', async (_name, details) => {
    respond(details)
    show()
    expect(await screen.findByText('Not recorded')).toBeInTheDocument()
    expect(screen.queryByText('Details recorded')).not.toBeInTheDocument()
  })

  it.each([null, { ...pricing, registrationGroupsConfirmed: false }])('keeps registration groups for review without explicit confirmation', async groups => {
    respond(provider, groups)
    show()
    await screen.findByText('Details recorded')
    await waitFor(() => expect(within(row('Registration groups')).getByText('Review')).toBeInTheDocument())
    expect(screen.queryByText('Registration groups confirmed')).not.toBeInTheDocument()
  })

  it('keeps independent sources truthful while pending and after an error, and retries only the failed read', async () => {
    let resolveProvider!: (value: ProviderSettingsDto) => void
    let pricingFails = true
    api.get.mockImplementation((url: string) => url === '/provider-settings'
      ? new Promise(resolve => { resolveProvider = resolve })
      : pricingFails ? Promise.reject(new Error('synthetic failure')) : Promise.resolve(pricing))
    const user = userEvent.setup()
    show()
    expect(within(row('Organisation details')).getByText('Checking')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this registration group list")
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open plan pricing' })).toBeInTheDocument()
    await act(async () => resolveProvider(provider))
    expect(await screen.findByText('Details recorded')).toBeInTheDocument()
    pricingFails = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Registration groups confirmed')).toBeInTheDocument()
    expect(api.get.mock.calls.filter(call => call[0] === '/provider-settings')).toHaveLength(1)
  })

  it('has checking states while offline instead of inventing missing or confirmed facts', () => {
    onlineManager.setOnline(false)
    show()
    expect(screen.getAllByText('Checking')).toHaveLength(2)
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument()
    expect(screen.queryByText('Details recorded')).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('rechecks current facts on return rather than keeping a completion mark', async () => {
    respond(null, { ...pricing, registrationGroupsConfirmed: false })
    const first = show(new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } }))
    expect(await screen.findByText('Not recorded')).toBeInTheDocument()
    first.unmount()
    respond()
    show(first.client)
    expect(await screen.findByText('Details recorded')).toBeInTheDocument()
    expect(await screen.findByText('Registration groups confirmed')).toBeInTheDocument()
    expect(api.get.mock.calls.filter(call => call[0] === '/provider-settings')).toHaveLength(2)
    expect(api.get.mock.calls.filter(call => call[0] === '/plan-pricing/settings')).toHaveLength(2)
  })

  it('does not carry the previous organisation facts across the existing full-reload cache boundary', async () => {
    const first = show()
    expect(await screen.findByText('Details recorded')).toBeInTheDocument()
    first.unmount()
    first.client.clear()
    respond(null, { ...pricing, registrationGroupsConfirmed: false })
    show()
    expect(await screen.findByText('Not recorded')).toBeInTheDocument()
    expect(screen.queryByText('Details recorded')).not.toBeInTheDocument()
    expect(screen.queryByText('Registration groups confirmed')).not.toBeInTheDocument()
  })
})

describe('Show setup steps on the dashboard', () => {
  afterEach(() => localStorage.clear())

  it('offers no way back while the card is showing', async () => {
    show()
    await screen.findByText('Details recorded')
    expect(screen.queryByRole('button', { name: 'Show setup steps on the dashboard' })).not.toBeInTheDocument()
  })

  it('shows the line and button while hidden; pressing clears the flag and removes both', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ tenantId: 'org-1' }))
    localStorage.setItem('bunya-setup-hidden:org-1', '1')
    show()
    expect(await screen.findByText('Setup steps are hidden on this device.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show setup steps on the dashboard' }))
    expect(localStorage.getItem('bunya-setup-hidden:org-1')).toBeNull()
    expect(screen.queryByText('Setup steps are hidden on this device.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show setup steps on the dashboard' })).not.toBeInTheDocument()
  })

  it('confirms in a polite region and moves focus to the section heading when the button goes', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ tenantId: 'org-1' }))
    localStorage.setItem('bunya-setup-hidden:org-1', '1')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <section aria-labelledby="sec-h"><h2 id="sec-h" tabIndex={-1}>Setup</h2><OrganisationSetupSection /></section>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Show setup steps on the dashboard' }))
    expect(screen.getByText('Setup steps will show on the dashboard.')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('heading', { name: 'Setup' })).toHaveFocus()
  })
})
