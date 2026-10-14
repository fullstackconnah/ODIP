import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ProviderSettingsDto } from '@/api/types'
import { SETTINGS_PERMS } from '@/test/fixtures/settingsPermissions'
import SettingsPage from '@/pages/SettingsPage'

// Organisation profile, Billing details and Safety checks share one provider settings row and one PUT that overwrites every text and flag
// field it is sent. The fake server below follows that contract (it applies what it is sent, and leaves the rest alone), so each test
// proves the outcome on the server: what a section sends, and what it must never send (the other sections' fields, the two modes).
const { mockApiGet, mockApiPut, mockUsePermissions, screenSize } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPut: vi.fn(), mockUsePermissions: vi.fn(), screenSize: { belowMd: false } }))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  // The tenant and user panels the page always mounts read through apiClient directly; an empty answer keeps them quiet.
  const apiClient = { get: vi.fn(async () => ({ data: { data: [] } })), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
  return {
    ...actual,
    apiClient,
    apiGet: mockApiGet,
    apiGetWithDefault: async (url: string, fallback: unknown) => (await mockApiGet(url)) ?? fallback,
    apiPut: mockApiPut,
  }
})
vi.mock('@/lib/permissions', () => ({ usePermissions: mockUsePermissions }))
// Desktop (the rail beside the section) unless a test says otherwise; jsdom would read as a phone.
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => screenSize.belowMd }))

function makeSettings(overrides: Partial<ProviderSettingsDto> = {}): ProviderSettingsDto {
  return {
    id: 'ps-1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sunrise Support Services', address: '12 Wattle St, Brisbane QLD 4000',
    state: 'QLD', gstRegistered: true, isPaceProvider: false, bankAccountName: 'Sunrise Support', bsb: '064-000', accountNumber: '12345678',
    invoiceFooterNotes: 'Thank you for choosing Sunrise.', managerName: 'Priya Sharma', managerPhone: '0412 345 007',
    participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', ...overrides,
  }
}

/** The fake server's row: what the next GET returns, and what a PUT merges the sent fields into. Null: the organisation has no row. */
let server: ProviderSettingsDto | null

beforeEach(() => {
  server = makeSettings()
  mockApiGet.mockReset().mockImplementation(async (url: string) => (url === '/provider-settings' ? server : []))
  mockApiPut.mockReset().mockImplementation(async (_url: string, body: Partial<ProviderSettingsDto>) => {
    server = { ...(server ?? ({} as ProviderSettingsDto)), ...body }
    return true
  })
  mockUsePermissions.mockReturnValue(SETTINGS_PERMS.Admin)
  screenSize.belowMd = false
})

afterEach(() => vi.restoreAllMocks())

function renderSection(section: 'organisation' | 'billing' | 'safety', queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const router = createMemoryRouter([{ path: '/settings', element: <SettingsPage /> }], { initialEntries: [`/settings?section=${section}`] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { queryClient, router }
}

/** The body of the Nth PUT /provider-settings (the first by default). */
function putBody(nth = 0): Record<string, unknown> {
  const call = mockApiPut.mock.calls[nth]
  expect(call[0]).toBe('/provider-settings')
  return call[1] as Record<string, unknown>
}

/** The row as the server held it, as a section PUTs it back: every field except the two modes, which go only when changed. */
function rowWithoutModes(row: ProviderSettingsDto, overrides: Partial<ProviderSettingsDto> = {}) {
  const body: Partial<ProviderSettingsDto> = { ...row, ...overrides }
  delete body.participantReadinessMode
  delete body.medicationCompetencyMode
  return body
}

const saveButton = () => screen.getByRole('button', { name: 'Save changes' })

describe('Organisation profile', () => {
  it('shows the identity fields from the row, in two groups', async () => {
    renderSection('organisation')
    expect(await screen.findByLabelText('Organisation name')).toHaveValue('Sunrise Support Services')
    expect(screen.getByLabelText('ABN')).toHaveValue('51824753556')
    expect(screen.getByLabelText('NDIS registration number')).toHaveValue('4050012345')
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('12 Wattle St, Brisbane QLD 4000')
    expect(screen.getByRole('button', { name: /State/ })).toHaveTextContent('QLD')
    expect(screen.getByRole('heading', { level: 3, name: 'Name and registration' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Address' })).toBeInTheDocument()
  })

  it('on a phone opens as a screen of its own with a Back link, and saves the same way', async () => {
    const user = userEvent.setup()
    screenSize.belowMd = true
    renderSection('organisation')
    const name = await screen.findByLabelText('Organisation name')
    expect(screen.getByRole('link', { name: 'Back to settings' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Settings' })).not.toBeInTheDocument()

    await user.type(name, '!')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual(rowWithoutModes(makeSettings(), { organisationName: 'Sunrise Support Services!' }))
  })

  it('sends the row as the server holds it with only the changed field replaced, and never a mode', async () => {
    const user = userEvent.setup()
    server = makeSettings({ participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })
    renderSection('organisation')
    const name = await screen.findByLabelText('Organisation name')

    await user.clear(name)
    await user.type(name, 'Sunrise Care')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual(rowWithoutModes(makeSettings(), { organisationName: 'Sunrise Care' }))
    expect(server).toMatchObject({ organisationName: 'Sunrise Care', participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('starts from the row as it is when the section opens, not from an older copy in the cache', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
    queryClient.setQueryData(['provider-settings'], makeSettings({ bsb: '000-000' }))   // what this browser saw earlier
    renderSection('organisation', queryClient)                                          // the server meanwhile holds 064-000
    const name = await screen.findByLabelText('Organisation name')

    await user.type(name, '!')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toMatchObject({ bsb: '064-000', organisationName: 'Sunrise Support Services!' })
  })

  it('opens as an empty form for an organisation with no row (the API sends no data), and its first save sends only what was typed', async () => {
    const user = userEvent.setup()
    server = null
    mockApiGet.mockImplementation(async (url: string) => (url === '/provider-settings' ? undefined : []))
    renderSection('organisation')

    const name = await screen.findByLabelText('Organisation name')
    expect(name).toHaveValue('')
    expect(screen.queryByText(/could not load|couldn.t load/i)).not.toBeInTheDocument()
    await user.type(name, 'Sunrise Care')
    await user.type(screen.getByLabelText('ABN'), '51824753556')
    await user.type(screen.getByLabelText('NDIS registration number'), '4050012345')
    await user.type(screen.getByRole('textbox', { name: 'Address' }), '1 Test St')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual({ organisationName: 'Sunrise Care', abn: '51824753556', registrationNumber: '4050012345', address: '1 Test St' })
  })

  it('says which fields the server needs when it refuses a blank one without a message', async () => {
    const user = userEvent.setup()
    mockApiPut.mockRejectedValueOnce({ response: { status: 400, data: { errors: { ABN: ['The ABN field is required.'] } } } })
    renderSection('organisation')
    await user.clear(await screen.findByLabelText('ABN'))
    await user.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved. Fill in the registration number, ABN, organisation name and address.')
    expect(screen.getByLabelText('ABN')).toHaveValue('')
    expect(saveButton()).toBeEnabled()
  })

  it('is locked for a Coordinator: values readable in read-only fields, State disabled, a note, and no Save', async () => {
    mockUsePermissions.mockReturnValue(SETTINGS_PERMS.Coordinator)
    renderSection('organisation')
    const abn = await screen.findByLabelText('ABN')
    expect(abn).toHaveAttribute('readonly')
    expect(abn).toHaveValue('51824753556')
    expect(screen.getByRole('button', { name: /State/ })).toBeDisabled()
    expect(screen.getByText(/only an admin can change these/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })
})

describe('Billing details', () => {
  it('keeps untouched nulls null and every other section field as the server sent it', async () => {
    const user = userEvent.setup()
    server = makeSettings({ bankAccountName: null, invoiceFooterNotes: null })
    renderSection('billing')

    await user.click(await screen.findByRole('checkbox', { name: 'Registered for GST' }))
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual(rowWithoutModes(makeSettings({ bankAccountName: null, invoiceFooterNotes: null }), { gstRegistered: false }))
  })

  it('names its groups and fields in the words of the brief, and gives the invoice note three rows', async () => {
    renderSection('billing')
    expect(await screen.findByLabelText('Account name')).toHaveValue('Sunrise Support')
    expect(screen.getByLabelText('BSB')).toHaveValue('064-000')
    expect(screen.getByLabelText('Account number')).toHaveValue('12345678')
    expect(screen.getByRole('checkbox', { name: /PACE provider/ })).not.toBeChecked()
    const note = screen.getByLabelText('Note at the foot of every invoice')
    expect(note).toHaveAttribute('rows', '3')
    expect(note).toHaveClass('h-auto')
    for (const group of ['Bank account', 'Tax and claiming', 'Invoice note']) expect(screen.getByRole('heading', { level: 3, name: group })).toBeInTheDocument()
  })

  it('waits for the organisation profile when its required fields are blank: a note with a link, locked fields, no Save', async () => {
    server = makeSettings({ abn: '' })
    renderSection('billing')
    expect(await screen.findByText('Fill in the organisation profile first. These settings are saved with it.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Organisation profile' })).toHaveAttribute('href', '/settings?section=organisation')
    expect(screen.getByRole('checkbox', { name: 'Registered for GST' })).toBeDisabled()
    expect(screen.getByLabelText('Account name')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('keeps the edited bank details and says why when a save fails, having sent the row with only that change', async () => {
    const user = userEvent.setup()
    mockApiPut.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    renderSection('billing')
    const bsb = await screen.findByLabelText('BSB')

    await user.clear(bsb)
    await user.type(bsb, '063-000')
    await user.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved. Check your connection and try again.')
    expect(screen.getByLabelText('BSB')).toHaveValue('063-000')
    expect(saveButton()).toBeEnabled()
    expect(putBody()).toEqual(rowWithoutModes(makeSettings(), { bsb: '063-000' }))
    expect(server?.bsb).toBe('064-000')
  })

  it('hides the bank account from a Coordinator, and has no Save', async () => {
    mockUsePermissions.mockReturnValue(SETTINGS_PERMS.Coordinator)
    renderSection('billing')
    expect(await screen.findByRole('checkbox', { name: 'Registered for GST' })).toBeDisabled()
    expect(screen.queryByLabelText('Account name')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })
})
