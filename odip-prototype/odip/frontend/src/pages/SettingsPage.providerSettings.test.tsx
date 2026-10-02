import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsPage from './SettingsPage'
import type { ProviderSettingsDto } from '@/api/types'

// The Provider Settings tab seeds its form from the GET and PUTs the WHOLE form back, so it also carries the readiness check
// (`participantReadinessMode`) as it was when the tab loaded. The server changes the mode whenever that field is present in the body,
// so a stale tab saving an unrelated field (a manager name) would silently revert a mode another admin has since set. The tab
// therefore sends the mode only when the user deliberately picks a different one.
//
// These tests run the real hooks against a fake server at the `@/api/client` boundary, and the fake server follows the contract:
// it applies the fields it is sent and leaves the rest (the mode included) alone. That way a test proves the outcome on the server,
// not just the shape of the payload.
const { mockApiGet, mockApiPut, mockUsePermissions } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPut: vi.fn(),
  mockUsePermissions: vi.fn(),
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  // The tenant and user panels the page always mounts read through `apiClient` directly; an empty page keeps them quiet (no real request).
  const apiClient = { get: vi.fn(async () => ({ data: { data: [] } })), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
  return { ...actual, apiGet: mockApiGet, apiPut: mockApiPut, apiClient }
})

vi.mock('@/lib/permissions', () => ({
  usePermissions: mockUsePermissions,
}))

function makeSettings(overrides: Partial<ProviderSettingsDto> = {}): ProviderSettingsDto {
  return {
    id: 'ps-1',
    registrationNumber: '4050012345',
    abn: '51824753556',
    organisationName: 'Sunrise Support Services',
    address: '12 Wattle St, Brisbane QLD 4000',
    state: 'QLD',
    gstRegistered: true,
    isPaceProvider: false,
    bankAccountName: 'Sunrise Support',
    bsb: '064-000',
    accountNumber: '12345678',
    invoiceFooterNotes: 'Thank you for choosing Sunrise.',
    managerName: 'Priya Sharma',
    managerPhone: '0412 345 007',
    participantReadinessMode: 'Warn',
    medicationCompetencyMode: 'Warn',
    ...overrides,
  }
}

/** The fake server's row: what the next GET returns, and what a PUT merges the sent fields into. */
let server: ProviderSettingsDto | null

const HELPER_TEXT =
  'Warn only: staff can roster, book and activate participants who are not fully ready, and the gaps show as warnings. Enforce: participants must be fully ready first, including a signed service agreement. Signed agreements cannot be recorded yet, so Enforce would block participants with no way to clear it. Keep Warn only for now.'

function renderProviderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/settings', element: <SettingsPage /> }], { initialEntries: ['/settings'] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { queryClient }
}

async function openProviderSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: /provider settings/i }))
  // The form seeds from the GET, so wait for a loaded value before touching anything.
  await screen.findByDisplayValue('Sunrise Support Services')
}

const readinessGroup = () => screen.getByRole('radiogroup', { name: 'Participant readiness check' })
const modeRadio = (name: 'Warn only' | 'Enforce') => screen.getByRole('radio', { name })
// The button reads 'Saved!' for two seconds after a successful save, so a second save in the same test finds it under that name.
const saveButton = () => screen.getByRole('button', { name: /^(Save Settings|Saved!)$/ })
const managerNameInput = () => screen.getByText('Manager Name').nextElementSibling as HTMLInputElement

/** The body of the Nth PUT /provider-settings (the first by default). */
function putBody(nth = 0): Record<string, unknown> {
  const call = mockApiPut.mock.calls[nth]
  expect(call[0]).toBe('/provider-settings')
  return call[1] as Record<string, unknown>
}

/** The loaded row as the form PUTs it back: every field, minus the two mode checks (each is sent only when the user changed it). */
function loadedBodyWithoutMode(overrides: Partial<ProviderSettingsDto> = {}) {
  const row: Partial<ProviderSettingsDto> = { ...makeSettings(), ...overrides }
  delete row.participantReadinessMode
  delete row.medicationCompetencyMode
  return row
}

beforeEach(() => {
  server = makeSettings()
  mockApiGet.mockReset()
  mockApiPut.mockReset()
  mockApiGet.mockImplementation(async (url: string) => (url === '/provider-settings' ? server : []))
  mockApiPut.mockImplementation(async (_url: string, body: Partial<ProviderSettingsDto>) => {
    server = { ...(server as ProviderSettingsDto), ...body }
    return server
  })
  mockUsePermissions.mockReturnValue({ isSuperAdmin: false, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Provider Settings — the readiness check control', () => {
  it('is labelled "Participant readiness check", offers Warn only and Enforce, and explains both in the helper text', async () => {
    const user = userEvent.setup()
    renderProviderSettings()
    await openProviderSettings(user)

    expect(screen.getByRole('heading', { name: 'Participant readiness check' })).toBeInTheDocument()
    expect(within(readinessGroup()).getAllByRole('radio').map(r => r.textContent)).toEqual(['Warn only', 'Enforce'])
    expect(screen.getByText(HELPER_TEXT)).toBeInTheDocument()
  })

  it('shows the organisation\'s current mode: Warn only for Warn, Enforce for Enforce', async () => {
    const user = userEvent.setup()
    server = makeSettings({ participantReadinessMode: 'Enforce' })
    renderProviderSettings()
    await openProviderSettings(user)

    expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(modeRadio('Warn only')).toHaveAttribute('aria-checked', 'false')
  })

  it('treats an organisation with no settings row yet as Warn only', async () => {
    const user = userEvent.setup()
    server = null
    renderProviderSettings()
    await user.click(screen.getByRole('tab', { name: /provider settings/i }))

    await waitFor(() => expect(modeRadio('Warn only')).toBeEnabled())
    expect(modeRadio('Warn only')).toHaveAttribute('aria-checked', 'true')
    expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'false')
  })

  it('does the same for the response the API really sends for an organisation with no row: no `data` at all (null is not written), which TanStack Query treats as an error state', async () => {
    const user = userEvent.setup()
    // TanStack logs "Query data cannot be undefined" for this shape; it is the API's real response, so the noise is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApiGet.mockImplementation(async (url: string) => (url === '/provider-settings' ? undefined : []))
    renderProviderSettings()
    await user.click(screen.getByRole('tab', { name: /provider settings/i }))

    await waitFor(() => expect(modeRadio('Enforce')).toBeEnabled())
    expect(modeRadio('Warn only')).toHaveAttribute('aria-checked', 'true')
    await user.click(modeRadio('Enforce'))
    expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(modeRadio('Warn only')).toHaveAttribute('aria-checked', 'false')
  })

  it('is editable for a user who can edit provider settings', async () => {
    const user = userEvent.setup()
    renderProviderSettings()
    await openProviderSettings(user)

    expect(readinessGroup()).not.toHaveAttribute('aria-disabled')
    expect(modeRadio('Warn only')).toBeEnabled()
    expect(modeRadio('Enforce')).toBeEnabled()
    expect(saveButton()).toBeInTheDocument()
  })

  it('is visible but locked for a user who cannot edit provider settings: the value reads, a click changes nothing, and there is no Save', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isSuperAdmin: false, canEditProviderSettings: false, showBankDetails: false, canManageNotifications: false })
    server = makeSettings({ participantReadinessMode: 'Enforce' })
    renderProviderSettings()
    await openProviderSettings(user)

    expect(readinessGroup()).toHaveAttribute('aria-disabled', 'true')
    expect(modeRadio('Warn only')).toBeDisabled()
    expect(modeRadio('Enforce')).toBeDisabled()
    expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'true')
    await user.click(modeRadio('Warn only'))
    expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('button', { name: 'Save Settings' })).not.toBeInTheDocument()
    expect(mockApiPut).not.toHaveBeenCalled()
  })

  it('is locked while the settings are still loading, so it never offers a value it has not read yet', async () => {
    const user = userEvent.setup()
    mockApiGet.mockImplementation((url: string) => (url === '/provider-settings' ? new Promise(() => {}) : Promise.resolve([])))
    renderProviderSettings()
    await user.click(screen.getByRole('tab', { name: /provider settings/i }))

    expect(modeRadio('Warn only')).toBeDisabled()
    expect(modeRadio('Enforce')).toBeDisabled()
  })
})

describe('Provider Settings — the stale-tab trap (the mode is sent only when the user changed it)', () => {
  it('editing only the manager name sends NO participantReadinessMode, and the full body is the loaded row with the new name', async () => {
    const user = userEvent.setup()
    renderProviderSettings()
    await openProviderSettings(user)

    await user.clear(managerNameInput())
    await user.type(managerNameInput(), 'Alex Morgan')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    const body = putBody()
    expect(body).not.toHaveProperty('participantReadinessMode')
    expect(body).toEqual(loadedBodyWithoutMode({ managerName: 'Alex Morgan' }))
  })

  it('a tab that went stale does not revert a mode another admin set: the server is still on Enforce after an unrelated save', async () => {
    const user = userEvent.setup()
    renderProviderSettings()
    await openProviderSettings(user)
    expect(modeRadio('Warn only')).toHaveAttribute('aria-checked', 'true')

    // Another admin switches the organisation to Enforce while this tab sits there still showing what it loaded.
    server = makeSettings({ participantReadinessMode: 'Enforce' })

    await user.clear(managerNameInput())
    await user.type(managerNameInput(), 'Alex Morgan')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).not.toHaveProperty('participantReadinessMode')
    expect(server?.participantReadinessMode).toBe('Enforce')
    expect(server?.managerName).toBe('Alex Morgan')
    // The save refetches, and the control now tells the truth instead of the stale value it was loaded with.
    await waitFor(() => expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'true'))
    expect(modeRadio('Warn only')).toHaveAttribute('aria-checked', 'false')
  })

  it('changing the control to Enforce and saving sends participantReadinessMode: Enforce together with every other field', async () => {
    const user = userEvent.setup()
    renderProviderSettings()
    await openProviderSettings(user)

    await user.click(modeRadio('Enforce'))
    expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'true')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual({ ...loadedBodyWithoutMode(), participantReadinessMode: 'Enforce' })
    expect(server?.participantReadinessMode).toBe('Enforce')
    await screen.findByText('Saved!')
    expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'true')
  })

  it('switching from Enforce back to Warn only is sent too: Warn is a deliberate change, not the absence of one', async () => {
    const user = userEvent.setup()
    server = makeSettings({ participantReadinessMode: 'Enforce' })
    renderProviderSettings()
    await openProviderSettings(user)

    await user.click(modeRadio('Warn only'))
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual({ ...loadedBodyWithoutMode(), participantReadinessMode: 'Warn' })
    expect(server?.participantReadinessMode).toBe('Warn')
  })

  it('changing the control and changing it back before saving sends no mode at all', async () => {
    const user = userEvent.setup()
    renderProviderSettings()
    await openProviderSettings(user)

    await user.click(modeRadio('Enforce'))
    await user.click(modeRadio('Warn only'))
    await user.type(managerNameInput(), '!')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).not.toHaveProperty('participantReadinessMode')
  })

  it('after the user\'s own change has been saved, a later unrelated save sends no mode again, and cannot revert someone else\'s next change', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderProviderSettings()
    await openProviderSettings(user)

    await user.click(modeRadio('Enforce'))
    await user.click(saveButton())
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody(0)).toHaveProperty('participantReadinessMode', 'Enforce')
    await screen.findByText('Saved!')

    // Another admin now flips the organisation back to Warn, and this tab refetches.
    server = makeSettings({ participantReadinessMode: 'Warn' })
    await queryClient.invalidateQueries({ queryKey: ['provider-settings'] })
    await waitFor(() => expect(modeRadio('Warn only')).toHaveAttribute('aria-checked', 'true'))

    await user.type(managerNameInput(), '!')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(putBody(1)).not.toHaveProperty('participantReadinessMode')
    expect(server?.participantReadinessMode).toBe('Warn')
  })
})

describe('Provider Settings — a refused save', () => {
  it('shows the server\'s own 400 message in the error box, not a generic line, and keeps the user\'s choice', async () => {
    const user = userEvent.setup()
    mockApiPut.mockRejectedValueOnce({
      response: { status: 400, data: { success: false, errors: ['Choose a tenant to view as before changing the participant readiness check.'] } },
    })
    renderProviderSettings()
    await openProviderSettings(user)

    await user.click(modeRadio('Enforce'))
    await user.click(saveButton())

    expect(await screen.findByText('Choose a tenant to view as before changing the participant readiness check.')).toBeInTheDocument()
    expect(screen.queryByText(/validation failed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/failed to save/i)).not.toBeInTheDocument()
    expect(putBody()).toEqual({ ...loadedBodyWithoutMode(), participantReadinessMode: 'Enforce' })
    // The choice survives, the server was not changed, and the user can fix things and try again.
    expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(server?.participantReadinessMode).toBe('Warn')
    expect(saveButton()).toBeEnabled()
  })

  it('still sends the choice on the retry once the problem is fixed', async () => {
    const user = userEvent.setup()
    mockApiPut.mockRejectedValueOnce({ response: { status: 400, data: { success: false, errors: ['Not allowed right now.'] } } })
    renderProviderSettings()
    await openProviderSettings(user)

    await user.click(modeRadio('Enforce'))
    await user.click(saveButton())
    expect(await screen.findByText('Not allowed right now.')).toBeInTheDocument()

    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(putBody(1)).toEqual({ ...loadedBodyWithoutMode(), participantReadinessMode: 'Enforce' })
    expect(server?.participantReadinessMode).toBe('Enforce')
    expect(screen.queryByText('Not allowed right now.')).not.toBeInTheDocument()
  })

  it('keeps the existing wording for a 403 and the existing fallback for a 400 with no message', async () => {
    const user = userEvent.setup()
    mockApiPut
      .mockRejectedValueOnce({ response: { status: 403, data: {} } })
      .mockRejectedValueOnce({ response: { status: 400, data: { success: false } } })
    renderProviderSettings()
    await openProviderSettings(user)

    await user.click(saveButton())
    expect(await screen.findByText(/admin role is required to update provider settings/i)).toBeInTheDocument()

    await user.click(saveButton())
    expect(await screen.findByText(/validation failed — check registration number, abn, organisation name and address are filled in/i)).toBeInTheDocument()
  })
})

describe('Provider Settings — the two mode controls together (participant readiness and medication competency)', () => {
  const competencyControl = () => screen.getByRole('button', { name: /medication competency check/i })

  async function pickCompetency(user: ReturnType<typeof userEvent.setup>, label: 'Warn only' | 'Enforce') {
    await user.click(competencyControl())
    await user.click(screen.getByRole('option', { name: label }))
  }

  it('shows both controls, each reading its own stored value', async () => {
    const user = userEvent.setup()
    server = makeSettings({ participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Warn' })
    renderProviderSettings()
    await openProviderSettings(user)

    expect(screen.getByRole('heading', { name: 'Participant readiness check' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Medication Competency' })).toBeInTheDocument()
    expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(competencyControl()).toHaveTextContent('Warn only')
  })

  it('editing only the manager name sends neither mode, whatever either is set to on the server', async () => {
    const user = userEvent.setup()
    server = makeSettings({ participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })
    renderProviderSettings()
    await openProviderSettings(user)

    await user.clear(managerNameInput())
    await user.type(managerNameInput(), 'Alex Morgan')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).not.toHaveProperty('participantReadinessMode')
    expect(putBody()).not.toHaveProperty('medicationCompetencyMode')
    expect(putBody()).toEqual(loadedBodyWithoutMode({ managerName: 'Alex Morgan' }))
    expect(server?.participantReadinessMode).toBe('Enforce')
    expect(server?.medicationCompetencyMode).toBe('Enforce')
  })

  it('changing only the competency check sends only that mode, and leaves the readiness check on the server alone', async () => {
    const user = userEvent.setup()
    server = makeSettings({ participantReadinessMode: 'Enforce' })
    renderProviderSettings()
    await openProviderSettings(user)

    await pickCompetency(user, 'Enforce')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual({ ...loadedBodyWithoutMode(), medicationCompetencyMode: 'Enforce' })
    expect(server?.medicationCompetencyMode).toBe('Enforce')
    expect(server?.participantReadinessMode).toBe('Enforce')
  })

  it('changing only the readiness check sends only that mode, and leaves the competency check on the server alone', async () => {
    const user = userEvent.setup()
    server = makeSettings({ medicationCompetencyMode: 'Enforce' })
    renderProviderSettings()
    await openProviderSettings(user)

    await user.click(modeRadio('Enforce'))
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual({ ...loadedBodyWithoutMode(), participantReadinessMode: 'Enforce' })
    expect(server?.participantReadinessMode).toBe('Enforce')
    expect(server?.medicationCompetencyMode).toBe('Enforce')
  })

  it('changing both sends both together with every other field', async () => {
    const user = userEvent.setup()
    renderProviderSettings()
    await openProviderSettings(user)

    await user.click(modeRadio('Enforce'))
    await pickCompetency(user, 'Enforce')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual({ ...loadedBodyWithoutMode(), participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })
    expect(server?.participantReadinessMode).toBe('Enforce')
    expect(server?.medicationCompetencyMode).toBe('Enforce')
    await screen.findByText('Saved!')
  })

  it('a tab that went stale cannot revert either mode another admin set: an unrelated save sends neither', async () => {
    const user = userEvent.setup()
    renderProviderSettings()
    await openProviderSettings(user)

    // Another admin switches both checks to Enforce while this tab sits there still showing what it loaded (Warn and Warn).
    server = makeSettings({ participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })
    await user.clear(managerNameInput())
    await user.type(managerNameInput(), 'Alex Morgan')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).not.toHaveProperty('participantReadinessMode')
    expect(putBody()).not.toHaveProperty('medicationCompetencyMode')
    expect(server?.participantReadinessMode).toBe('Enforce')
    expect(server?.medicationCompetencyMode).toBe('Enforce')
  })

  it('after a rejected save both choices survive, and the retry sends both', async () => {
    const user = userEvent.setup()
    mockApiPut.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    renderProviderSettings()
    await openProviderSettings(user)

    await user.click(modeRadio('Enforce'))
    await pickCompetency(user, 'Enforce')
    await user.click(saveButton())
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()
    expect(modeRadio('Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(competencyControl()).toHaveTextContent('Enforce')

    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(putBody(1)).toEqual({ ...loadedBodyWithoutMode(), participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })
    expect(server?.participantReadinessMode).toBe('Enforce')
    expect(server?.medicationCompetencyMode).toBe('Enforce')
  })
})
