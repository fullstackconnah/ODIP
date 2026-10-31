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
  managerName: 'Priya Sharma', managerPhone: '0412 345 007', timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn',
  updatedAt: '2026-10-23T01:00:00.123456Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
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
    await screen.findByRole('radiogroup', { name: 'State *' })
    screen.getAllByRole('radio').forEach(r => expect(r).not.toBeChecked())
  })

  it('ties the required flag and the error to the state group, so a screen reader hears them', async () => {
    api.get.mockResolvedValue(null)
    const user = userEvent.setup()
    show()
    const group = await screen.findByRole('radiogroup', { name: 'State *' })
    expect(group).toBeRequired()
    expect(group).not.toHaveAttribute('aria-invalid')
    await user.type(screen.getByRole('textbox', { name: 'Address' }), '1 Example Street')
    expect(group).toHaveAttribute('aria-invalid', 'true')
    expect(group).toHaveAccessibleDescription("Choose the organisation's state.")
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

const ZONE_HINT = 'Changing this moves what counts as today for rosters, the portal and reminders. Times already saved stay the same.'
const zone = () => screen.getByRole('combobox', { name: 'Time zone' })

describe('Organisation profile: time zone', () => {
  it('lists the seven zones in picker order, with no empty option', async () => {
    show()
    await screen.findByDisplayValue('Priya Sharma')
    const options = Array.from(zone().querySelectorAll('option'))
    expect(options.map(o => [o.textContent, (o as HTMLOptionElement).value])).toEqual([
      ['Sydney (NSW, ACT)', 'Australia/Sydney'], ['Melbourne (VIC)', 'Australia/Melbourne'], ['Hobart (TAS)', 'Australia/Hobart'],
      ['Brisbane (QLD)', 'Australia/Brisbane'], ['Adelaide (SA)', 'Australia/Adelaide'], ['Perth (WA)', 'Australia/Perth'], ['Darwin (NT)', 'Australia/Darwin'],
    ])
    expect(zone()).not.toBeRequired()
    expect(zone()).toHaveAccessibleDescription(ZONE_HINT)
  })

  it.each([
    ['NSW', 'Australia/Sydney'], ['ACT', 'Australia/Sydney'], ['VIC', 'Australia/Melbourne'], ['TAS', 'Australia/Hobart'],
    ['QLD', 'Australia/Brisbane'], ['SA', 'Australia/Adelaide'], ['WA', 'Australia/Perth'], ['NT', 'Australia/Darwin'], ['', 'Australia/Sydney'],
  ])('shows the default for state "%s" when no zone is saved, and is not dirty', async (state, expected) => {
    api.get.mockResolvedValue({ ...row, state, timeZoneId: null })
    show()
    await screen.findByDisplayValue('Priya Sharma')
    expect(zone()).toHaveValue(expected)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('moves the zone with the state while it is still that state's default', async () => {
    api.get.mockResolvedValue({ ...row, state: 'VIC' })
    const user = userEvent.setup()
    show()
    await screen.findByDisplayValue('Priya Sharma')
    await user.click(screen.getByRole('radio', { name: 'WA' }))
    expect(zone()).toHaveValue('Australia/Perth')
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  })

  it('keeps a zone that is not the state's default when the state changes', async () => {
    api.get.mockResolvedValue({ ...row, state: 'NSW', timeZoneId: 'Australia/Brisbane' })
    const user = userEvent.setup()
    show()
    await screen.findByDisplayValue('Priya Sharma')
    expect(zone()).toHaveValue('Australia/Brisbane')
    await user.click(screen.getByRole('radio', { name: 'VIC' }))
    expect(zone()).toHaveValue('Australia/Brisbane')
  })

  it('sends the row's own null zone when only the address changed, and the picked zone when it was picked', async () => {
    api.get.mockResolvedValue({ ...row, state: 'VIC' })
    const user = userEvent.setup()
    show()
    const address = await screen.findByRole('textbox', { name: 'Address' })
    await user.type(address, ' B')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
    expect(api.put.mock.calls[0][1]).toMatchObject({ timeZoneId: null })

    await user.selectOptions(zone(), 'Australia/Perth')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
    expect(api.put.mock.calls[1][1]).toMatchObject({ timeZoneId: 'Australia/Perth' })
  })

  it('leads the hint with "Changed by someone else." after a refused save reseeds the zone', async () => {
    api.get.mockResolvedValue({ ...row, state: 'NSW', timeZoneId: 'Australia/Sydney' })
    api.put.mockRejectedValue({ response: { status: 409, data: { code: 'PROVIDER_SETTINGS_CHANGED' } } })
    const user = userEvent.setup()
    show()
    await user.type(await screen.findByRole('textbox', { name: 'Address' }), ' B')
    api.get.mockResolvedValue({ ...row, state: 'NSW', timeZoneId: 'Australia/Perth', updatedAt: '2026-10-23T02:00:00.000000Z' })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(zone()).toHaveValue('Australia/Perth'))
    expect(zone()).toHaveAccessibleDescription('Changed by someone else. ' + ZONE_HINT)
  })

  it('says why the server refused a zone', async () => {
    api.get.mockResolvedValue({ ...row, state: 'NSW', timeZoneId: 'Australia/Sydney' })
    api.put.mockRejectedValue({ response: { status: 400, data: { success: false, errors: ['Choose a time zone from the list.'] } } })
    const user = userEvent.setup()
    show()
    await screen.findByDisplayValue('Priya Sharma')
    await user.selectOptions(zone(), 'Australia/Perth')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved. Choose a time zone from the list.')
  })

  it('is a disabled select with no Save for a Coordinator, still showing the zone', async () => {
    api.get.mockResolvedValue({ ...row, state: 'NSW', timeZoneId: 'Australia/Brisbane' })
    const router = createMemoryRouter([{ path: '/settings', element: <OrganisationProfileSection {...frame} readOnly /> }], { initialEntries: ['/settings'] })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
    await screen.findByDisplayValue('Priya Sharma')
    expect(zone()).toBeDisabled()
    expect(zone()).toHaveValue('Australia/Brisbane')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })
})
