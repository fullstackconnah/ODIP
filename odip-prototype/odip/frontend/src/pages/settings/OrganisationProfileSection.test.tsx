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
    // All eight states are on the page at once (no panel to scroll), and the stored one is selected.
    expect(screen.getAllByRole('radio').map(r => r.textContent)).toEqual(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'])
    expect(screen.getByRole('radio', { name: 'WA' })).toBeChecked()
  })

  // The real old case is an organisation with no provider row at all (the server answers null), not a row with a blank state.
  it('does not pick Victoria for an organisation with no profile row yet', async () => {
    api.get.mockResolvedValue(null)
    show()
    await screen.findByRole('radiogroup', { name: 'State' })
    screen.getAllByRole('radio').forEach(r => expect(r).not.toBeChecked())
  })

  it('keeps Save off until a state is chosen, so no organisation is put on Victoria by saving', async () => {
    api.get.mockResolvedValue(null)
    const user = userEvent.setup()
    show()
    await user.type(await screen.findByLabelText('Organisation name'), 'Jo Care')
    await user.type(screen.getByLabelText('ABN'), '51824753556')
    await user.type(screen.getByLabelText('NDIS registration number'), '4050')
    await user.type(screen.getByRole('textbox', { name: 'Address' }), '1 Example Street')
    expect(screen.getByRole('button', { name: /^Save/ })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: 'WA' }))
    await user.click(screen.getByRole('button', { name: /^Save/ }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/provider-settings', expect.objectContaining({ state: 'WA', organisationName: 'Jo Care' })))
  })

  it('gives the manager fields the same examples as Safety checks, since it is one stored value', () => {
    show()
    return screen.findByDisplayValue('Priya Sharma').then(() => {
      expect(screen.getByLabelText('Manager name')).toHaveAttribute('placeholder', 'For example: Priya Sharma')
      expect(screen.getByLabelText('Manager phone')).toHaveAttribute('placeholder', 'For example: 0412 345 007')
    })
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
