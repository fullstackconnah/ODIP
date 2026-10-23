import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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
    participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: V1,
    invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false, ...overrides,
  }
}

// The row's version: the server moves it on every save, and refuses a PUT whose expectedUpdatedAt is not the current one (409).
const V1 = '2026-10-23T01:00:00.123456Z'
const V2 = '2026-10-23T01:05:00.654321Z'
const CHANGED_BY_OTHER = 'Settings were changed by someone else. Reload and try again.'

/** The fake server's row: what the next GET returns, and what a PUT merges the sent fields into. Null: the organisation has no row. */
let server: ProviderSettingsDto | null

beforeEach(() => {
  server = makeSettings()
  mockApiGet.mockReset().mockImplementation(async (url: string) => (url === '/provider-settings' ? server : []))
  mockApiPut.mockReset().mockImplementation(async (_url: string, body: Partial<ProviderSettingsDto> & { expectedUpdatedAt?: string }) => {
    const { expectedUpdatedAt, ...fields } = body
    if (expectedUpdatedAt && expectedUpdatedAt !== server?.updatedAt) throw { response: { status: 409, data: { success: false, errors: [CHANGED_BY_OTHER] } } }
    server = { ...(server ?? ({} as ProviderSettingsDto)), ...fields, updatedAt: `${new Date().toISOString().slice(0, -1)}000Z` }
    return server.updatedAt   // the PUT answers the row's new version
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

/** The row as the server held it, as a section PUTs it back: every field except the two modes and the four numbering fields, which go only when changed (an override is a change). */
function rowWithoutModes(row: ProviderSettingsDto, overrides: Partial<ProviderSettingsDto> = {}) {
  const body: Partial<ProviderSettingsDto> & { expectedUpdatedAt?: string } = { ...row }
  delete body.participantReadinessMode
  delete body.medicationCompetencyMode
  delete body.employmentHeroConnected
  delete body.nextInvoiceDisplayNumber   // computed on GET (Xero PR1); never written
  delete body.invoicesIssued
  delete body.invoiceNumberPrefix   // numbering is sent only by the section that changed it
  delete body.creditNotePrefix
  delete body.invoiceStartNumber
  delete body.paymentTermsDays
  // The version the row was loaded at goes back as expectedUpdatedAt (never as updatedAt).
  body.expectedUpdatedAt = row.updatedAt
  delete (body as { updatedAt?: string }).updatedAt
  return { ...body, ...overrides }
}

const saveButton = () => screen.getByRole('button', { name: 'Save changes' })

describe('Organisation profile', () => {
  it('shows the identity fields from the row, in two groups', async () => {
    renderSection('organisation')
    expect(await screen.findByLabelText('Organisation name')).toHaveValue('Sunrise Support Services')
    expect(screen.getByLabelText('ABN')).toHaveValue('51824753556')
    expect(screen.getByLabelText('NDIS registration number')).toHaveValue('4050012345')
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('12 Wattle St, Brisbane QLD 4000')
    expect(screen.getByRole('radio', { name: 'QLD' })).toBeChecked()
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

  it('a second save before the refetch lands keeps the first save: the cache holds what was saved', async () => {
    const user = userEvent.setup()
    renderSection('organisation')
    const name = await screen.findByLabelText('Organisation name')
    await user.clear(name)
    await user.type(name, 'Sunrise Care')
    // From here every GET of the row hangs: the refetch after the first save never lands.
    mockApiGet.mockImplementation((url: string) => (url === '/provider-settings' ? new Promise(() => {}) : Promise.resolve([])))
    await user.click(saveButton())
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    const putVersion = server?.updatedAt
    expect(putVersion).not.toBe(V1)

    const abn = screen.getByLabelText('ABN')
    await user.clear(abn)
    await user.type(abn, '12345678901')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    // The first save moved the version and the refetch that would say to what never lands, so the second save carries the version the first PUT answered.
    expect(putBody(1)).toEqual({ ...rowWithoutModes(makeSettings(), { organisationName: 'Sunrise Care', abn: '12345678901' }), expectedUpdatedAt: putVersion })
  })

  it('never writes back the Employment Hero flag the GET computes', async () => {
    const user = userEvent.setup()
    server = makeSettings({ employmentHeroConnected: true })
    renderSection('organisation')
    await user.type(await screen.findByLabelText('Organisation name'), '!')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).not.toHaveProperty('employmentHeroConnected')
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
    expect(saveButton()).toBeDisabled() // no state chosen yet
    await user.click(screen.getByRole('radio', { name: 'WA' }))
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual({ organisationName: 'Sunrise Care', abn: '51824753556', registrationNumber: '4050012345', address: '1 Test St', state: 'WA' })
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
    screen.getAllByRole('radio').forEach(r => expect(r).toBeDisabled())
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

  it("a save from an older form is refused in the section's words, reseeds from the refetched row keeping the edit, marks what moved, and the retry sends what the screen shows", async () => {
    const user = userEvent.setup()
    renderSection('billing')
    const bsb = await screen.findByLabelText('BSB')
    await user.clear(bsb)
    await user.type(bsb, '063-000')
    // Another Admin saves a new account number after this form loaded.
    server = makeSettings({ accountNumber: '99999999', updatedAt: V2 })

    await user.click(saveButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Not saved. Someone else changed these settings. Their changes are shown and your edits kept; save again.')
    expect(putBody()).toMatchObject({ expectedUpdatedAt: V1, bsb: '063-000' })
    expect(server?.bsb).toBe('064-000')
    // The refetch lands: the untouched field shows the other Admin's value and says so in its hint, the edited one keeps what was typed.
    await waitFor(() => expect(screen.getByLabelText('Account number')).toHaveValue('99999999'))
    expect(screen.getByLabelText('Account number')).toHaveAccessibleDescription('Changed by someone else.')
    expect(screen.getByLabelText('BSB')).toHaveValue('063-000')
    expect(screen.getByLabelText('BSB')).toHaveAccessibleDescription('6 digits.')
    expect(saveButton()).toBeEnabled()

    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(putBody(1)).toMatchObject({ expectedUpdatedAt: V2, bsb: '063-000', accountNumber: '99999999' })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Account number')).not.toHaveAccessibleDescription()
    expect(screen.getByLabelText('Account number')).toHaveValue('99999999')
    expect(server).toMatchObject({ bsb: '063-000', accountNumber: '99999999' })
  })

  it('after a refused save, an edit to the same field the other Admin changed keeps the typed value and the hint still says so until it is edited', async () => {
    const user = userEvent.setup()
    renderSection('billing')
    const account = await screen.findByLabelText('Account number')
    await user.clear(account)
    await user.type(account, '12345679')
    server = makeSettings({ accountNumber: '99999999', bsb: '063-000', updatedAt: V2 })

    await user.click(saveButton())

    await waitFor(() => expect(screen.getByLabelText('BSB')).toHaveValue('063-000'))
    expect(screen.getByLabelText('Account number')).toHaveValue('12345679')
    expect(screen.getByLabelText('BSB')).toHaveAccessibleDescription('Changed by someone else. 6 digits.')
    expect(screen.getByLabelText('Account number')).toHaveAccessibleDescription('Changed by someone else.')
    await user.type(screen.getByLabelText('BSB'), '1')
    expect(screen.getByLabelText('BSB')).toHaveAccessibleDescription('6 digits.')
    await user.clear(screen.getByLabelText('BSB'))
    await user.type(screen.getByLabelText('BSB'), '063-000')
    await user.click(saveButton())
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(putBody(1)).toMatchObject({ expectedUpdatedAt: V2, bsb: '063-000', accountNumber: '12345679' })
  })

  it('hides the bank account from a Coordinator, and has no Save', async () => {
    mockUsePermissions.mockReturnValue(SETTINGS_PERMS.Coordinator)
    renderSection('billing')
    expect(await screen.findByRole('checkbox', { name: 'Registered for GST' })).toBeDisabled()
    expect(screen.queryByLabelText('Account name')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })
})

// Xero PR1, SHAPE section 4: invoice numbering and payment terms live in Billing details, on the same shared row.
describe('Billing details: invoice numbers and payment terms', () => {
  const prefix = () => screen.getByLabelText('Invoice prefix')
  const startNumber = () => screen.getByLabelText('First invoice number')
  const daysToPay = () => screen.getByLabelText('Days to pay')
  async function open() {
    renderSection('billing')
    await screen.findByLabelText('Invoice prefix')
  }
  async function retype(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
    await user.clear(field)
    if (text) await user.type(field, text)
  }

  it('shows the defaults in two new groups between the bank account and tax, with their hints', async () => {
    await open()
    expect(prefix()).toHaveValue('INV-')
    expect(screen.getByLabelText('Credit note prefix')).toHaveValue('CN-')
    expect(startNumber()).toHaveValue(1)
    expect(daysToPay()).toHaveValue(14)
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Bank account', 'Invoice numbers', 'Payment terms', 'Tax and claiming', 'Invoice note'])
    expect(screen.getByText('Printed before the number, as in INV-0042. New invoices only.')).toBeInTheDocument()
    expect(screen.getByText('As in CN-0007. New credit notes only.')).toBeInTheDocument()
    expect(startNumber()).toHaveAccessibleDescription("Carry on from your old system's numbers. It can't change once an invoice is issued.")
    expect(screen.getByText("Each invoice is due this many days after it's issued. 0 means due on issue.")).toBeInTheDocument()
    expect(screen.getByText("The bank account on your invoices, how they're numbered and when they're due, your GST and PACE status, and the note printed at the foot of every invoice.")).toBeInTheDocument()
  })

  it.each([
    ['Invoice prefix', '', 'Enter a prefix, such as INV-.'],
    ['Invoice prefix', 'IN V', 'No spaces.'],
    ['Invoice prefix', 'INV/', 'Use letters, digits, - _ or . only.'],
    ['Credit note prefix', 'CN/', 'Use letters, digits, - _ or . only.'],
    ['First invoice number', '0', 'Enter a whole number from 1 to 99,999,999.'],
    ['First invoice number', '1.5', 'Enter a whole number from 1 to 99,999,999.'],
    ['First invoice number', '100000000', 'Enter a whole number from 1 to 99,999,999.'],
    ['Days to pay', '366', 'Enter a whole number of days from 0 to 365.'],
    ['Days to pay', '', 'Enter a whole number of days from 0 to 365.'],
  ])('%s "%s" says "%s" and holds Save', async (label, text, words) => {
    const user = userEvent.setup()
    await open()
    await retype(user, screen.getByLabelText(label), text)
    expect(screen.getByText(words)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(screen.getByText('Fix 1 field to save.')).toBeInTheDocument()
  })

  it('a prefix is at most 10 characters', async () => {
    await open()
    expect(prefix()).toHaveAttribute('maxLength', '10')
    expect(screen.getByLabelText('Credit note prefix')).toHaveAttribute('maxLength', '10')
  })

  it('saves the whole row with the numbering fields changed, as numbers, and never the two read-only fields', async () => {
    const user = userEvent.setup()
    await open()
    await retype(user, prefix(), 'OAS-')
    await retype(user, startNumber(), '1001')
    await retype(user, daysToPay(), '30')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual(rowWithoutModes(makeSettings(), { invoiceNumberPrefix: 'OAS-', invoiceStartNumber: 1001, paymentTermsDays: 30 }))
    expect(putBody()).not.toHaveProperty('nextInvoiceDisplayNumber')
    expect(putBody()).not.toHaveProperty('invoicesIssued')
  })

  it('after the first invoice the starting number cell reads "Next invoice", read-only, set by the invoices issued', async () => {
    server = makeSettings({ invoicesIssued: true, nextInvoiceDisplayNumber: 'INV-0043', invoiceStartNumber: 42 })
    await open()
    const next = screen.getByLabelText('Next invoice')
    expect(next).toHaveValue('INV-0043')
    expect(next).toHaveAttribute('readonly')
    expect(next.closest('[class*="bg-transparent"]')).not.toBeNull()   // the locked look: no Field Grey fill (SHAPE 4)
    expect(screen.getByText('Set by the invoices already issued.')).toBeInTheDocument()
    expect(screen.queryByLabelText('First invoice number')).not.toBeInTheDocument()
    expect(prefix()).not.toHaveAttribute('readonly')
  })

  it('the starting number cell reserves the longer hint in both states, so it keeps its height when it flips (SHAPE C10)', async () => {
    const longHint = "Carry on from your old system's numbers. It can't change once an invoice is issued."
    // The field and the reserve share one cell: the field's wrapper's parent.
    const reserve = (input: HTMLElement) => input.closest('.grid > *')!.parentElement!.querySelector(':scope > [aria-hidden="true"]')
    server = makeSettings({ invoicesIssued: true, nextInvoiceDisplayNumber: 'INV-0043', invoiceStartNumber: 42 })
    await open()
    expect(reserve(screen.getByLabelText('Next invoice'))).toHaveTextContent(longHint)
    expect(reserve(screen.getByLabelText('Next invoice'))).toHaveClass('invisible')
  })

  it("an invoice issued between load and save: shows the server's words, keeps what was typed, flips the cell, and the retry is accepted", async () => {
    const user = userEvent.setup()
    await open()
    await retype(user, startNumber(), '1001')
    await retype(user, daysToPay(), '30')
    // Another person submits a claim meanwhile: the server now holds an invoice, and refuses a changed starting number.
    server = makeSettings({ invoicesIssued: true, nextInvoiceDisplayNumber: 'INV-0002' })
    mockApiPut.mockRejectedValueOnce({ response: { status: 409, data: { success: false, errors: ["An invoice has been issued, so the starting number can't change now."] } } })
    await user.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent("Not saved. An invoice has been issued, so the starting number can't change now.")
    expect(daysToPay()).toHaveValue(30)
    expect(await screen.findByLabelText('Next invoice')).toHaveValue('INV-0002')

    await user.click(saveButton())
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    // The typed start number is dropped once the cell flips: the row's own value goes back, which the server reads as unchanged.
    expect(putBody(1)).toEqual(rowWithoutModes(makeSettings({ invoicesIssued: true }), { paymentTermsDays: 30, invoiceStartNumber: 1 }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('a save from another section sends none of the numbering fields from its cached row, so it cannot put back what another Admin set', async () => {
    const user = userEvent.setup()
    await open()
    // The cached row still holds the numbering as loaded (another Admin may have changed it since); a bank-details save must not echo it.
    await user.clear(screen.getByLabelText('BSB'))
    await user.type(screen.getByLabelText('BSB'), '063-000')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual(rowWithoutModes(makeSettings(), { bsb: '063-000' }))
    for (const k of ['invoiceNumberPrefix', 'creditNotePrefix', 'invoiceStartNumber', 'paymentTermsDays']) expect(putBody()).not.toHaveProperty(k)
  })

  it('after the first invoice, saving Organisation profile sends no numbering field', async () => {
    const user = userEvent.setup()
    server = makeSettings({ invoicesIssued: true, nextInvoiceDisplayNumber: 'INV-0043', invoiceStartNumber: 42 })
    renderSection('organisation')
    const name = await screen.findByLabelText('Organisation name')
    await user.type(name, '!')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual(rowWithoutModes(makeSettings({ invoiceStartNumber: 42 }), { organisationName: 'Sunrise Support Services!' }))
  })

  it('is read-only for a Coordinator, with no Save', async () => {
    mockUsePermissions.mockReturnValue(SETTINGS_PERMS.Coordinator)
    await open()
    expect(prefix()).toHaveAttribute('readonly')
    expect(startNumber()).toHaveAttribute('readonly')
    expect(daysToPay()).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })
})

describe('Safety checks', () => {
  const readiness = () => screen.getByRole('radiogroup', { name: 'Participant readiness check' })
  const medication = () => screen.getByRole('radiogroup', { name: 'Medication competency check' })
  const radio = (group: HTMLElement, name: 'Warn only' | 'Enforce') => within(group).getByRole('radio', { name })
  const managerName = () => screen.getByLabelText('Manager name') as HTMLInputElement
  async function open() {
    renderSection('safety')
    await screen.findByLabelText('Manager name')
  }

  it('gives each check its own block: when it applies, both modes in words, and the current mode chosen', async () => {
    server = makeSettings({ participantReadinessMode: 'Enforce' })
    await open()
    expect(screen.getByRole('heading', { level: 3, name: 'Participant readiness check' })).toBeInTheDocument()
    expect(screen.getByText('Before a participant is rostered, booked or activated.')).toBeInTheDocument()
    expect(screen.getByText(/Participants must be fully ready first, including a signed service agreement\./)).toBeInTheDocument()
    expect(radio(readiness(), 'Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(radio(medication(), 'Warn only')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/The dose is refused\./)).toBeInTheDocument()
    expect(managerName()).toHaveValue('Priya Sharma')
    expect(screen.getByLabelText('Manager phone')).toHaveValue('0412 345 007')
  })

  it('keeps the warning that Enforce would block everyone while signed agreements cannot be recorded', async () => {
    await open()
    expect(screen.getByText(/Signed agreements can.t be recorded yet, so Enforce would block every participant/)).toBeInTheDocument()
  })

  it('says a picked mode is not saved yet, and what it will do from the save', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(radio(readiness(), 'Enforce'))
    expect(screen.getByText('Not saved yet. From when you save: Participants must be fully ready first, including a signed service agreement.')).toBeInTheDocument()
  })

  it('editing only the manager name sends neither mode: the body is the row with the new name', async () => {
    const user = userEvent.setup()
    server = makeSettings({ participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })
    await open()

    await user.clear(managerName())
    await user.type(managerName(), 'Alex Morgan')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual(rowWithoutModes(makeSettings(), { managerName: 'Alex Morgan' }))
    expect(server).toMatchObject({ participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce', managerName: 'Alex Morgan' })
  })

  it('a section that went stale does not revert a mode another Admin set, and shows the truth after its save', async () => {
    const user = userEvent.setup()
    await open()
    expect(radio(readiness(), 'Warn only')).toHaveAttribute('aria-checked', 'true')
    server = makeSettings({ participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })   // another Admin, meanwhile

    await user.clear(managerName())
    await user.type(managerName(), 'Alex Morgan')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).not.toHaveProperty('participantReadinessMode')
    expect(putBody()).not.toHaveProperty('medicationCompetencyMode')
    expect(server).toMatchObject({ participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })
    await waitFor(() => expect(radio(readiness(), 'Enforce')).toHaveAttribute('aria-checked', 'true'))
  })

  it('asks once before tightening the readiness check, then sends it with the row', async () => {
    const user = userEvent.setup()
    await open()

    await user.click(radio(readiness(), 'Enforce'))
    await user.click(saveButton())
    const dialog = screen.getByRole('alertdialog', { name: 'Turn on Enforce for the readiness check?' })
    expect(dialog).toHaveTextContent("From now on, a participant who isn't fully ready can't be rostered, booked or activated.")
    expect(mockApiPut).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Turn on Enforce' }))

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual({ ...rowWithoutModes(makeSettings()), participantReadinessMode: 'Enforce' })
  })

  it('keeps the edit unsaved when the confirm is cancelled', async () => {
    const user = userEvent.setup()
    await open()

    await user.click(radio(medication(), 'Enforce'))
    await user.click(saveButton())
    await user.click(within(screen.getByRole('alertdialog', { name: 'Turn on Enforce for medication competency?' })).getByRole('button', { name: 'Cancel' }))

    expect(mockApiPut).not.toHaveBeenCalled()
    expect(radio(medication(), 'Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  })

  it('asks once for both when both are tightened, and sends both', async () => {
    const user = userEvent.setup()
    await open()

    await user.click(radio(readiness(), 'Enforce'))
    await user.click(radio(medication(), 'Enforce'))
    await user.click(saveButton())
    const dialog = screen.getByRole('alertdialog', { name: 'Turn on Enforce for both checks?' })
    expect(dialog).toHaveTextContent("can't be rostered, booked or activated")
    expect(dialog).toHaveTextContent("Check your team's competencies first.")
    await user.click(within(dialog).getByRole('button', { name: 'Turn on Enforce for both' }))

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual({ ...rowWithoutModes(makeSettings()), participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })
  })

  it('says the tightened check is saved as soon as the save lands, without waiting for the refetch', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(radio(readiness(), 'Enforce'))
    mockApiGet.mockImplementation((url: string) => (url === '/provider-settings' ? new Promise(() => {}) : Promise.resolve([])))
    await user.click(saveButton())
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Turn on Enforce' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'))
    expect(screen.queryByText(/^Not saved yet./)).not.toBeInTheDocument()
    expect(radio(readiness(), 'Enforce')).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the medication mode another Admin has since set, once the row refetches', async () => {
    const { queryClient } = renderSection('safety')
    await screen.findByLabelText('Manager name')
    expect(radio(medication(), 'Warn only')).toHaveAttribute('aria-checked', 'true')

    server = makeSettings({ medicationCompetencyMode: 'Enforce' })   // another Admin, meanwhile
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['provider-settings'] }) })

    await waitFor(() => expect(radio(medication(), 'Enforce')).toHaveAttribute('aria-checked', 'true'))
    expect(screen.queryByText(/^Not saved yet./)).not.toBeInTheDocument()
  })

  it('loosens without asking: Enforce back to Warn only is a deliberate change, and is sent', async () => {
    const user = userEvent.setup()
    server = makeSettings({ participantReadinessMode: 'Enforce' })
    await open()

    await user.click(radio(readiness(), 'Warn only'))
    await user.click(saveButton())

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toMatchObject({ participantReadinessMode: 'Warn' })
  })

  it('sends a mode once: after its own change saved, a later unrelated save sends no mode', async () => {
    const user = userEvent.setup()
    await open()

    await user.click(radio(medication(), 'Enforce'))
    await user.click(saveButton())
    await user.click(screen.getByRole('button', { name: 'Turn on Enforce' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    await user.type(managerName(), '!')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(putBody(0)).toHaveProperty('medicationCompetencyMode', 'Enforce')
    expect(putBody(1)).not.toHaveProperty('medicationCompetencyMode')
    expect(putBody(1)).not.toHaveProperty('participantReadinessMode')
  })

  it('sends no mode when one was changed and changed back before saving', async () => {
    const user = userEvent.setup()
    await open()

    await user.click(radio(readiness(), 'Enforce'))
    await user.click(radio(readiness(), 'Warn only'))
    await user.click(radio(medication(), 'Enforce'))
    await user.click(radio(medication(), 'Warn only'))
    await user.type(managerName(), '!')
    await user.click(saveButton())

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putBody()).toEqual(rowWithoutModes(makeSettings(), { managerName: 'Priya Sharma!' }))
  })

  it('keeps both choices after a failed save, and the retry sends both', async () => {
    const user = userEvent.setup()
    mockApiPut.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    await open()

    await user.click(radio(readiness(), 'Enforce'))
    await user.click(radio(medication(), 'Enforce'))
    await user.click(saveButton())
    await user.click(screen.getByRole('button', { name: 'Turn on Enforce for both' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved. Check your connection and try again.')
    expect(radio(readiness(), 'Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(radio(medication(), 'Enforce')).toHaveAttribute('aria-checked', 'true')

    await user.click(saveButton())
    await user.click(screen.getByRole('button', { name: 'Turn on Enforce for both' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(putBody(1)).toEqual({ ...rowWithoutModes(makeSettings()), participantReadinessMode: 'Enforce', medicationCompetencyMode: 'Enforce' })
  })

  it("shows the server's own words for a refused save, and keeps the choice", async () => {
    const user = userEvent.setup()
    mockApiPut.mockRejectedValueOnce({ response: { status: 400, data: { success: false, errors: ['Choose a tenant to view as before changing the participant readiness check.'] } } })
    await open()

    await user.click(radio(readiness(), 'Enforce'))
    await user.click(saveButton())
    await user.click(screen.getByRole('button', { name: 'Turn on Enforce' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved. Choose a tenant to view as before changing the participant readiness check.')
    expect(radio(readiness(), 'Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(server?.participantReadinessMode).toBe('Warn')
  })

  it('with no row yet: reads Warn only for both, locked, under the profile note, with no Save', async () => {
    server = null
    mockApiGet.mockImplementation(async (url: string) => (url === '/provider-settings' ? undefined : []))
    await open()

    expect(screen.getByText('Fill in the organisation profile first. These settings are saved with it.')).toBeInTheDocument()
    expect(radio(readiness(), 'Warn only')).toHaveAttribute('aria-checked', 'true')
    expect(radio(readiness(), 'Enforce')).toBeDisabled()
    expect(radio(medication(), 'Enforce')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('is locked for a Coordinator: the value reads, a click changes nothing, and there is no Save', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue(SETTINGS_PERMS.Coordinator)
    server = makeSettings({ participantReadinessMode: 'Enforce' })
    await open()

    expect(readiness()).toHaveAttribute('aria-disabled', 'true')
    await user.click(radio(readiness(), 'Warn only'))
    expect(radio(readiness(), 'Enforce')).toHaveAttribute('aria-checked', 'true')
    expect(managerName()).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(mockApiPut).not.toHaveBeenCalled()
  })

  it('offers no control until the row has loaded, so it never shows a value it has not read', () => {
    mockApiGet.mockImplementation((url: string) => (url === '/provider-settings' ? new Promise(() => {}) : Promise.resolve([])))
    renderSection('safety')
    expect(screen.getByText('Loading safety checks section…')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })
})
