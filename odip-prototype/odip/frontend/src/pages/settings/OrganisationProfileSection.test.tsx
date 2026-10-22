import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { ProviderSettingsDto } from '@/api/types'
import OrganisationProfileSection from './OrganisationProfileSection'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  apiGet: api.get,
  apiGetWithDefault: async (url: string, fallback: unknown) => (await api.get(url)) ?? fallback,
  apiPut: api.put,
}))

const frame = { title: 'Organisation profile', description: 'Who you are.', readOnly: false, focusOnMount: false }
const row: ProviderSettingsDto = {
  id: 'p1', registrationNumber: '4050', abn: '51824753556', organisationName: 'Jo Care', address: '1 Example Street', state: 'WA', gstRegistered: false, isPaceProvider: false,
  bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null,
  managerName: 'Priya Sharma', managerPhone: '0412 345 007', participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn',
}
const clients: QueryClient[] = []
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const router = createMemoryRouter([{ path: '/settings', element: <OrganisationProfileSection {...frame} /> }], { initialEntries: ['/settings'] })
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(row); api.put.mockResolvedValue(row) })
afterEach(() => { clients.splice(0).forEach(c => c.clear()) })

describe('Organisation profile: state and manager', () => {
  it('shows the stored state, and the manager name and phone from the same fields as Safety checks', async () => {
    show()
    expect(await screen.findByDisplayValue('Priya Sharma')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0412 345 007')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /State/ })).toHaveTextContent('WA')
  })

  it('does not pick Victoria when no state is stored', async () => {
    api.get.mockResolvedValue({ ...row, state: '' })
    show()
    await screen.findByDisplayValue('Jo Care')
    expect(screen.getByRole('button', { name: /State/ })).not.toHaveTextContent('VIC')
    expect(screen.getByRole('button', { name: /State/ })).toHaveTextContent('Select state')
  })

  it('saves an edited manager phone with the whole row unchanged otherwise', async () => {
    const user = userEvent.setup()
    show()
    const phone = await screen.findByDisplayValue('0412 345 007')
    await user.clear(phone)
    await user.type(phone, '0400 000 000')
    await user.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(api.put).toHaveBeenCalled())
    expect(api.put).toHaveBeenCalledWith('/provider-settings', expect.objectContaining({
      managerName: 'Priya Sharma', managerPhone: '0400 000 000', state: 'WA', organisationName: 'Jo Care', abn: '51824753556',
    }))
  })
})
