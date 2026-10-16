import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import InquiryFormPage from './InquiryFormPage'

// Wire level: only the HTTP helpers are mocked, so the real hooks, the real form and a real query client run, and every assertion
// is on the method, URL and FULL body that would leave the browser.
const { mockApiGet, mockApiPost, mockApiPut, mockApiDeleteRaw } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPost: vi.fn(), mockApiPut: vi.fn(), mockApiDeleteRaw: vi.fn() }))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiGet: mockApiGet, apiPost: mockApiPost, apiPut: mockApiPut, apiDeleteRaw: mockApiDeleteRaw }
})

const apiError = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { success: false, errors: [message] } } })

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'i1', firstName: 'Rowan', lastName: 'Blake', phone: '0400 000 999', email: 'rowan@example.com', source: 'Web',
  provenance: 'Referred by Dr Patel, Brisbane', participantId: null, createdAt: '2026-09-20T01:00:00',
  ...overrides,
})

const STAFF = [{ id: 'dana', fullName: 'Dana Smith', role: 'Coordinator', isActive: true }, { id: 'sam', fullName: 'Sam Lee', role: 'Admin', isActive: true }]
// GETs answer by URL, as the server does: the staff list for Who's going, and one enquiry by id (a 404 otherwise).
function serve(byUrl: Record<string, unknown> = {}) {
  mockApiGet.mockImplementation(async (url: string) => {
    if (url === '/staff') return STAFF
    if (url in byUrl) return byUrl[url]
    throw apiError(404, 'Inquiry not found')
  })
}
const detail = (overrides: Record<string, unknown> = {}) => ({ ...stored(), timeZoneId: 'Australia/Sydney', contacts: [], ...overrides })
const maria = { role: 'Guardian', firstName: 'Maria', lastName: 'Lopez', phone: '0412 345 678', email: 'maria@example.com', relationship: 'Mother', notes: 'Works nights' }
const tom = { role: 'EmergencyContact', firstName: 'Tom', lastName: 'Ng', phone: null, email: null, relationship: null, notes: null }
const firstName = () => screen.getByLabelText(/^First name/, { selector: '#inquiry-first-name' })
const lastName = () => screen.getByLabelText(/^Last name/, { selector: '#inquiry-last-name' })

/** The Enquiries tab, as far as the form can see: where it went, and the summary it carried there as router state. */
function TabProbe() {
  const state = useLocation().state as { enquiryNotice?: { title: string; message: string } } | null
  return <><p>Enquiries tab destination</p><p data-testid="notice">{state?.enquiryNotice ? `${state.enquiryNotice.title}: ${state.enquiryNotice.message}` : ''}</p></>
}

function renderForm(path = '/participants/new-inquiry', queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/participants/new-inquiry" element={<InquiryFormPage />} />
          <Route path="/participants" element={<TabProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator', id: 'dana', fullName: 'Dana Smith' }))
  serve()
  mockApiPost.mockResolvedValue(detail({ id: 'inq-9', provenance: null }))
  mockApiPut.mockResolvedValue(stored())
})

afterEach(() => {
  localStorage.clear()
  mockApiGet.mockReset(); mockApiPost.mockReset(); mockApiPut.mockReset(); mockApiDeleteRaw.mockReset()
  onlineManager.setOnline(true)
})

describe('InquiryFormPage (wire) — capturing an enquiry', () => {
  it('sends null, not "", for an email, phone or provenance the coordinator left blank (the API rejected "" as a bad email)', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(/first name/i), 'Ava')
    await user.type(screen.getByLabelText(/last name/i), 'Ng')
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1))
    expect(mockApiPost).toHaveBeenCalledWith('/inquiries', {
      firstName: 'Ava', lastName: 'Ng', phone: null, email: null, source: 'Phone', provenance: null, contacts: [],
    })
    // Kept from the old InquiryFormPage.test.tsx (plan check S6): a plain success goes back to the Enquiries tab, with its summary.
    expect(await screen.findByText('Enquiries tab destination')).toBeInTheDocument()
    expect(screen.getByTestId('notice')).toHaveTextContent('Enquiry captured: Rowan Blake is on the Enquiries list.')
  })

  it('has a provenance / referral notes field, and sends what is typed in it, trimmed', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(/first name/i), 'Ava')
    await user.type(screen.getByLabelText(/last name/i), 'Ng')
    await user.type(screen.getByLabelText(/provenance or referral notes/i), '  Referred by Dr Patel  ')
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1))
    expect(mockApiPost.mock.calls[0][1]).toMatchObject({ provenance: 'Referred by Dr Patel' })
  })

  it('does not send an enquiry with no name: the browser stops it, because the name fields really are required', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    expect(screen.getByLabelText(/first name/i)).toHaveAttribute('required')
    expect(screen.getByLabelText(/first name/i)).toHaveAttribute('autocomplete', 'given-name')
    expect(screen.getByRole('link', { name: /back to enquiries/i })).toHaveAttribute('href', '/participants?tab=enquiries')
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('shows the server\'s own message when the enquiry is refused, and keeps what was typed', async () => {
    mockApiPost.mockRejectedValue(apiError(400, 'A tenant context is required.'))
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(/first name/i), 'Ava')
    await user.type(screen.getByLabelText(/last name/i), 'Ng')
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A tenant context is required.')
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Ava')
    expect(screen.queryByText('Enquiries tab destination')).not.toBeInTheDocument()
  })

  it('falls back to a plain message when the failure carries no server text', async () => {
    mockApiPost.mockRejectedValue(new Error('Network Error'))
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(/first name/i), 'Ava')
    await user.type(screen.getByLabelText(/last name/i), 'Ng')
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not capture this enquiry. Check the details and try again.')
  })
})

describe('InquiryFormPage (wire) — editing an enquiry opened cold', () => {
  it('shows a loading state until the enquiry has arrived, never a blank form that saves over the stored one', async () => {
    let arrive!: (row: unknown) => void
    const pending = new Promise(resolve => { arrive = resolve })
    mockApiGet.mockImplementation(async (url: string) => (url === '/staff' ? STAFF : pending))
    renderForm('/participants/new-inquiry?id=i1')

    expect(screen.getByRole('status')).toHaveTextContent(/loading enquiry/i)
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save enquiry' })).not.toBeInTheDocument()

    arrive(detail())
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue('Rowan'))
    expect(screen.getByLabelText(/last name/i)).toHaveValue('Blake')
    expect(screen.getByLabelText('Phone')).toHaveValue('0400 000 999')
    expect(screen.getByLabelText('Email')).toHaveValue('rowan@example.com')
    expect(screen.getByLabelText('Source')).toHaveValue('Web')
    expect(screen.getByLabelText(/provenance or referral notes/i)).toHaveValue('Referred by Dr Patel, Brisbane')
  })

  it('saves the loaded email, source and provenance with only the name changed: a cold edit never overwrites them with blanks', async () => {
    serve({ '/inquiries/i1': detail() })
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')

    const first = await screen.findByLabelText(/first name/i)
    await waitFor(() => expect(first).toHaveValue('Rowan'))
    await user.clear(first)
    await user.type(first, 'Ro')
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(mockApiPut).toHaveBeenCalledWith('/inquiries/i1', {
      firstName: 'Ro', lastName: 'Blake', phone: '0400 000 999', email: 'rowan@example.com', source: 'Web',
      provenance: 'Referred by Dr Patel, Brisbane', contacts: [],
    })
    expect(await screen.findByTestId('notice')).toHaveTextContent("Enquiry saved: Rowan Blake's changes are saved.")
  })

  it('shows loading, not "Enquiry not found", while the browser reports offline and the request has not run (review F-1)', async () => {
    onlineManager.setOnline(false)
    renderForm('/participants/new-inquiry?id=i1')

    expect(await screen.findByRole('status')).toHaveTextContent(/loading enquiry/i)
    expect(screen.queryByText(/enquiry not found/i)).not.toBeInTheDocument()
  })

  it('says so when there is no such enquiry, with a way back', async () => {
    serve({ '/inquiries/someone-else': detail({ id: 'someone-else' }) })
    renderForm('/participants/new-inquiry?id=i1')

    expect(await screen.findByText(/enquiry not found/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument()
  })

  it('says the enquiry could not be loaded, with a retry, when the list request fails: not "not found", not a blank form', async () => {
    serve({ '/inquiries/i1': detail() })
    const served = mockApiGet.getMockImplementation()!
    mockApiGet.mockImplementationOnce(async () => { throw apiError(500, 'boom') })
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load this enquiry/i)
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument()

    mockApiGet.mockImplementation(served)
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue('Rowan'))
  })
})

describe('InquiryFormPage (wire) — contacts', () => {
  it('sends the contacts in the enquiry POST: in order, a blank row dropped, blanks as null', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(firstName(), 'Ana')
    await user.type(lastName(), 'Lopez')
    await user.click(screen.getByRole('button', { name: 'Add contact' }))
    const first = screen.getByRole('group', { name: 'Contact 1' })
    await user.type(within(first).getByLabelText(/^First name/), ' Maria ')
    await user.type(within(first).getByLabelText(/^Last name/), 'Lopez')
    await user.selectOptions(within(first).getByLabelText(/^Role/), 'Guardian')
    await user.type(within(first).getByLabelText(/^Relationship/), 'Mother')
    await user.click(screen.getByRole('button', { name: 'Add contact' }))   // left blank: dropped, never refused
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1))
    expect(mockApiPost).toHaveBeenCalledWith('/inquiries', {
      firstName: 'Ana', lastName: 'Lopez', phone: null, email: null, source: 'Phone', provenance: null,
      contacts: [{ role: 'Guardian', firstName: 'Maria', lastName: 'Lopez', relationship: 'Mother', phone: null, email: null, notes: null }],
    })
  })

  it('Add the enquirer as a contact copies only the phone and email into a new row, focuses its First name, then hides', async () => {
    const user = userEvent.setup()
    renderForm()
    expect(screen.queryByRole('button', { name: 'Add the enquirer as a contact' })).not.toBeInTheDocument()
    await user.type(firstName(), 'Kai')
    await user.type(lastName(), 'Lopez')
    await user.type(screen.getByLabelText(/^Phone/, { selector: '#inquiry-phone' }), '0412 555 010')
    await user.type(screen.getByLabelText(/^Email/, { selector: '#inquiry-email' }), 'maria@example.com')
    await user.click(screen.getByRole('button', { name: 'Add the enquirer as a contact' }))

    const row = screen.getByRole('group', { name: 'Contact 1' })
    expect(within(row).getByLabelText(/^Phone/)).toHaveValue('0412 555 010')
    expect(within(row).getByLabelText(/^Email/)).toHaveValue('maria@example.com')
    expect(within(row).getByLabelText(/^First name/)).toHaveValue('')
    expect(within(row).getByLabelText(/^Last name/)).toHaveValue('')
    expect(within(row).getByLabelText(/^First name/)).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Add the enquirer as a contact' })).not.toBeInTheDocument()
  })

  it('a contact with a first name but no last name is stopped here, with its message on that field, and nothing is sent', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(firstName(), 'Ana')
    await user.type(lastName(), 'Lopez')
    await user.click(screen.getByRole('button', { name: 'Add contact' }))
    const row = screen.getByRole('group', { name: 'Contact 1' })
    await user.type(within(row).getByLabelText(/^First name/), 'Maria')
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    const last = within(row).getByLabelText(/^Last name/)
    expect(await within(row).findByText('Add their last name.')).toBeInTheDocument()
    expect(last).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(last).toHaveFocus())
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('a contact the server refuses: the reason on that row\'s field, the banner, every value kept', async () => {
    mockApiPost.mockRejectedValue(Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true, response: { status: 400, data: { title: 'One or more validation errors occurred.', status: 400, errors: { 'contacts[0].phone': ['Enter a phone number, like 0412 345 678.'] } } },
    }))
    const user = userEvent.setup()
    renderForm()
    await user.type(firstName(), 'Ana')
    await user.type(lastName(), 'Lopez')
    await user.click(screen.getByRole('button', { name: 'Add contact' }))
    const row = screen.getByRole('group', { name: 'Contact 1' })
    await user.type(within(row).getByLabelText(/^First name/), 'Maria')
    await user.type(within(row).getByLabelText(/^Last name/), 'Lopez')
    await user.type(within(row).getByLabelText(/^Phone/), '12ab')
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    expect(await within(row).findByText('Enter a phone number, like 0412 345 678.')).toBeInTheDocument()
    expect(within(row).getByLabelText(/^Phone/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Could not capture this enquiry. Check the details and try again.')).toBeInTheDocument()
    expect(within(row).getByLabelText(/^Phone/)).toHaveValue('12ab')
    expect(firstName()).toHaveValue('Ana')
    expect(screen.queryByText('Enquiries tab destination')).not.toBeInTheDocument()
  })

  it('editing loads the stored contacts; removing one PUTs the list without it', async () => {
    // updatedAt is the version the PUT sends back, so a save from a form loaded before another save is refused (deep review S2).
    serve({ '/inquiries/i1': detail({ contacts: [maria, tom], updatedAt: '2026-10-16T01:02:03.456789Z' }) })
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    const mariaRow = await screen.findByRole('group', { name: 'Contact 1' })
    expect(within(mariaRow).getByLabelText(/^First name/)).toHaveValue('Maria')

    await user.click(screen.getByRole('button', { name: 'Remove Maria Lopez' }))
    expect(within(screen.getByRole('group', { name: 'Contact 1' })).getByLabelText(/^First name/)).toHaveFocus()
    expect(within(screen.getByRole('group', { name: 'Contact 1' })).getByLabelText(/^First name/)).toHaveValue('Tom')
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(mockApiPut).toHaveBeenCalledWith('/inquiries/i1', {
      firstName: 'Rowan', lastName: 'Blake', phone: '0400 000 999', email: 'rowan@example.com', source: 'Web', provenance: 'Referred by Dr Patel, Brisbane',
      contacts: [{ role: 'EmergencyContact', firstName: 'Tom', lastName: 'Ng', relationship: null, phone: null, email: null, notes: null }],
      expectedUpdatedAt: '2026-10-16T01:02:03.456789Z',
    })
  })

  it('a converted enquiry says where its contacts are, links there, and its PUT carries no contacts', async () => {
    serve({ '/inquiries/i1': detail({ participantId: 'p-1' }) })
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')

    expect(await screen.findByText(/Contacts are on Rowan's intake now\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the intake' })).toHaveAttribute('href', '/participants/p-1/intake')
    expect(screen.queryByRole('button', { name: 'Add contact' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(mockApiPut.mock.calls[0][1]).not.toHaveProperty('contacts')
  })

  it('never mounts from a cached copy: it waits for this visit\'s own load, then shows those contacts (plan check S2)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    queryClient.setQueryData(['participant-inquiries', 'i1'], detail({ contacts: [maria] }))
    let arrive!: (row: unknown) => void
    const pending = new Promise(resolve => { arrive = resolve })
    mockApiGet.mockImplementation(async (url: string) => (url === '/staff' ? STAFF : pending))
    renderForm('/participants/new-inquiry?id=i1', queryClient)

    expect(screen.getByRole('status')).toHaveTextContent(/loading enquiry/i)
    expect(screen.queryByRole('group', { name: 'Contact 1' })).not.toBeInTheDocument()
    arrive(detail({ contacts: [maria, tom] }))
    const second = await screen.findByRole('group', { name: 'Contact 2' })
    expect(within(second).getByLabelText(/^First name/)).toHaveValue('Tom')
  })
})

describe('InquiryFormPage (wire) — the intake visit', () => {
  // 2030, so the times never pass: 23:00Z is 10:00 am on Wed 16 Oct 2030 in Sydney.
  const START = '2030-10-15T23:00:00Z'
  const problem = (status: number, errors: Record<string, string[]>) =>
    Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data: { status, errors } } })
  const booked = {
    intakeStartsAt: START, intakeDurationMinutes: 90, intakeLocation: '12 Smith St', intakeStaffUserId: 'sam', intakeStaffName: 'Sam Lee', intakeStaffFirstName: 'Sam',
    intakeNotes: 'Gate code', intakeInviteSentAt: '2026-10-14T03:05:00Z',
  }

  async function fillNewVisit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/^First name/), 'Ana')
    await user.type(screen.getByLabelText(/^Last name/), 'Lopez')
    await user.type(screen.getByLabelText(/^Email/), 'ana@example.com')
    await user.click(screen.getByRole('checkbox', { name: /book the intake visit now/i }))
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2030-10-16' } })
    fireEvent.change(screen.getByLabelText(/^Start time/), { target: { value: '10:00' } })
    await user.type(screen.getByLabelText(/^Where/), 'Library')
  }

  it('a refused booking: the enquiry is saved once, the page is in edit mode with every entry and the reason, and the retry PUTs (one POST in all)', async () => {
    const saved = detail({ id: 'inq-9', firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.com', phone: null, provenance: null, source: 'Phone' })
    mockApiPost.mockResolvedValue(saved)
    mockApiPut.mockImplementation(async (url: string) => {
      if (url.endsWith('/intake-booking')) throw problem(409, { staffUserId: ['Dana Smith is on a shift 9:00 – 10:30 am on Wed 16 Oct.'] })
      return saved
    })
    const user = userEvent.setup()
    renderForm()
    await fillNewVisit(user)
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    expect(await screen.findByText("Enquiry saved. The visit isn't booked yet.")).toBeInTheDocument()
    expect(mockApiPut).toHaveBeenCalledWith('/inquiries/inq-9/intake-booking',
      { startsAt: START, durationMinutes: 90, location: 'Library', staffUserId: 'dana', notes: null })
    const whoField = screen.getByText('Dana Smith is on a shift 9:00 – 10:30 am on Wed 16 Oct.').closest('[data-field="staffUserId"]')!
    await waitFor(() => expect(whoField.contains(document.activeElement)).toBe(true))   // SHAPE 4: focus on Who's going
    expect(screen.getByLabelText(/^Where/)).toHaveValue('Library')
    expect(screen.getByRole('button', { name: 'Save enquiry' })).toBeInTheDocument()   // edit mode, no remount
    expect(screen.getByRole('button', { name: 'Back to enquiries' })).toBeInTheDocument()
    expect(screen.queryByText('Enquiries tab destination')).not.toBeInTheDocument()

    mockApiPut.mockImplementation(async (url: string) => (url.endsWith('/intake-booking')
      ? { ...saved, intakeStartsAt: START, intakeDurationMinutes: 90, intakeLocation: 'Library', intakeStaffUserId: 'dana', intakeStaffName: 'Dana Smith', intakeInviteSentAt: '2030-10-01T00:00:00Z' }
      : saved))
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))
    await screen.findByText('Enquiries tab destination')
    expect(mockApiPost).toHaveBeenCalledTimes(1)
    expect(mockApiPut).toHaveBeenCalledWith('/inquiries/inq-9', expect.objectContaining({ firstName: 'Ana', email: 'ana@example.com', contacts: [] }))
    expect(screen.getByTestId('notice')).toHaveTextContent('Enquiry captured: Intake visit booked for Wed 16 Oct 2030, 10:00 am with Dana Smith. Invite sent to ana@example.com.')
  })

  it('books the visit after capturing: POST, then the booking PUT with the instant and the signed-in coordinator going, then back to the tab', async () => {
    const saved = detail({ id: 'inq-9', firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.com', provenance: null, source: 'Phone' })
    mockApiPost.mockResolvedValue(saved)
    mockApiPut.mockResolvedValue({ ...saved, intakeStartsAt: START, intakeStaffName: 'Dana Smith', intakeInviteError: 'NotConfigured' })
    const user = userEvent.setup()
    renderForm()
    await fillNewVisit(user)
    expect(screen.getByText(/Saving books the visit and emails an invite with a calendar file to/)).toHaveTextContent('ana@example.com')
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    await screen.findByText('Enquiries tab destination')
    expect(mockApiPost).toHaveBeenCalledTimes(1)
    expect(mockApiPut).toHaveBeenCalledTimes(1)
    expect(mockApiPut).toHaveBeenCalledWith('/inquiries/inq-9/intake-booking', { startsAt: START, durationMinutes: 90, location: 'Library', staffUserId: 'dana', notes: null })
    expect(mockApiPut.mock.calls[0][1]).not.toHaveProperty('contactEmail')
    expect(screen.getByTestId('notice')).toHaveTextContent('Enquiry saved, invite not sent:')
  })

  it('while the box is ticked the Email is required', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText(/^First name/), 'Ana')
    await user.type(screen.getByLabelText(/^Last name/), 'Lopez')
    await user.click(screen.getByRole('checkbox', { name: /book the intake visit now/i }))
    expect(screen.getByText('Add an email above. The invite goes there.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    const email = screen.getByLabelText(/^Email/)
    expect(await screen.findByText('Add an email to send the invite to.')).toBeInTheDocument()
    expect(email).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(email).toHaveFocus())
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('a second press while saving sends nothing more', async () => {
    mockApiPost.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText(/^First name/), 'Ana')
    await user.type(screen.getByLabelText(/^Last name/), 'Lopez')
    const save = screen.getByRole('button', { name: 'Capture enquiry' })
    await user.click(save)
    await user.click(save)
    await user.keyboard('{Enter}')

    expect(mockApiPost).toHaveBeenCalledTimes(1)
    expect(save).toHaveTextContent('Saving…')
    expect(save).toHaveAttribute('aria-disabled', 'true')
  })

  it('editing a booked enquiry with no change to the visit makes no booking call', async () => {
    serve({ '/inquiries/i1': detail(booked) })
    mockApiPut.mockResolvedValue(detail(booked))
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    expect(await screen.findByText(/Invite sent to rowan@example\.com on/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel visit' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /book the intake visit now/i })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/^First name/), 'n')
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))

    await screen.findByText('Enquiries tab destination')
    expect(mockApiPut).toHaveBeenCalledTimes(1)
    expect(mockApiPut.mock.calls[0][0]).toBe('/inquiries/i1')
  })

  it('a notes-only change PUTs the stored visit with the new notes and says nothing about an invite', async () => {
    serve({ '/inquiries/i1': detail(booked) })
    mockApiPut.mockResolvedValue(detail(booked))
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    const notes = await screen.findByLabelText(/^Notes for your team/)
    await user.type(notes, ' 4321')
    expect(screen.queryByText(/Saving emails an updated invite/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))

    await screen.findByText('Enquiries tab destination')
    expect(mockApiPut).toHaveBeenCalledWith('/inquiries/i1/intake-booking',
      { startsAt: START, durationMinutes: 90, location: '12 Smith St', staffUserId: 'sam', notes: 'Gate code 4321' })
  })

  it('a time change says the save emails an updated invite', async () => {
    serve({ '/inquiries/i1': detail(booked) })
    renderForm('/participants/new-inquiry?id=i1')
    fireEvent.change(await screen.findByLabelText(/^Start time/), { target: { value: '11:00' } })

    expect(screen.getByText(/Saving emails an updated invite to/)).toHaveTextContent('Saving emails an updated invite to rowan@example.com.')
  })

  it('Cancel visit: the dialog, the DELETE, then the notice in the card, the box unticked, other entries kept', async () => {
    serve({ '/inquiries/i1': detail(booked) })
    mockApiDeleteRaw.mockResolvedValue({ success: true, data: { inquiry: detail(), cancellationEmail: 'Sent' } })
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    const first = await screen.findByLabelText(/^First name/)
    await user.clear(first)
    await user.type(first, 'Ro')
    await user.click(screen.getByRole('button', { name: 'Cancel visit' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel visit' }))

    expect(mockApiDeleteRaw).toHaveBeenCalledWith('/inquiries/i1/intake-booking')
    const notice = await screen.findByText("We've emailed Rowan Blake a cancellation.")
    expect(screen.getByText('Intake visit cancelled')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement?.contains(notice)).toBe(true))
    expect(screen.getByRole('checkbox', { name: /book the intake visit now/i })).not.toBeChecked()
    expect(screen.getByLabelText(/^First name/)).toHaveValue('Ro')
  })

  it('Send again: a changed email on a visit whose invite went out offers the box; ticked, Save PUTs and then resends', async () => {
    serve({ '/inquiries/i1': detail(booked) })
    mockApiPut.mockResolvedValue(detail({ ...booked, email: 'new@example.com' }))
    mockApiPost.mockResolvedValue(detail({ ...booked, email: 'new@example.com', intakeInviteSentAt: '2030-10-02T00:00:00Z' }))
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    const email = await screen.findByLabelText(/^Email/)
    await user.clear(email)
    await user.type(email, 'new@example.com')
    const box = screen.getByRole('checkbox', { name: 'Send the invite again to new@example.com' })
    expect(screen.getByText("The invite went to rowan@example.com. Saving won't resend it unless you tick this.")).toBeInTheDocument()
    await user.click(box)
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))

    await screen.findByText('Enquiries tab destination')
    expect(mockApiPut).toHaveBeenCalledTimes(1)
    expect(mockApiPut).toHaveBeenCalledWith('/inquiries/i1', expect.objectContaining({ email: 'new@example.com' }))
    expect(mockApiPost).toHaveBeenCalledWith('/inquiries/i1/intake-booking/send')
    expect(mockApiPut.mock.invocationCallOrder[0]).toBeLessThan(mockApiPost.mock.invocationCallOrder[0])
    expect(screen.getByTestId('notice')).toHaveTextContent('Invite sent again to new@example.com.')
  })

  it('a passed visit is a record: the passed line and no Cancel visit', async () => {
    serve({ '/inquiries/i1': detail({ ...booked, intakeStartsAt: '2026-01-05T23:00:00Z' }) })
    renderForm('/participants/new-inquiry?id=i1')

    expect(await screen.findByText("This visit's time has passed. To book another time, change the date and time.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel visit' })).not.toBeInTheDocument()
  })
})

describe('InquiryFormPage (wire) — close and reopen (spec addendum)', () => {
  it('Close enquiry from the form says unsaved changes are discarded, POSTs the close, then goes to the tab with the closed notice', async () => {
    serve({ '/inquiries/i1': detail({ updatedAt: '2026-10-16T00:00:00.5Z' }) })
    mockApiPost.mockResolvedValue({ inquiry: detail({ closedAt: '2026-10-16T01:00:00Z', closeOutcome: 'DeclinedByUs' }), cancellationEmail: 'NoVisit' })
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    const first = await screen.findByLabelText(/^First name/)
    await user.type(first, 'n')
    await user.click(screen.getByRole('button', { name: 'Close enquiry' }))

    const dialog = screen.getByRole('alertdialog', { name: "Close Rowan Blake's enquiry?" })
    expect(dialog).toHaveTextContent("Changes you haven't saved on this page are discarded.")
    await user.selectOptions(within(dialog).getByLabelText(/^Why is it closing/), 'Declined by us')
    await user.click(within(dialog).getByRole('button', { name: 'Close enquiry' }))

    await screen.findByText('Enquiries tab destination')
    expect(mockApiPost).toHaveBeenCalledWith('/inquiries/i1/close', { outcome: 'DeclinedByUs', note: null, expectedUpdatedAt: '2026-10-16T00:00:00.5Z' })
    expect(mockApiPut).not.toHaveBeenCalled()
    expect(screen.getByTestId('notice')).toHaveTextContent("Enquiry closed: Rowan Blake's enquiry is closed: Declined by us.")
  })

  it('a form with no changes does not warn about discarding any', async () => {
    serve({ '/inquiries/i1': detail() })
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    await screen.findByLabelText(/^First name/)
    await user.click(screen.getByRole('button', { name: 'Close enquiry' }))

    expect(screen.getByRole('alertdialog')).not.toHaveTextContent("Changes you haven't saved")
  })

  it('a closed enquiry opens read-only, and Reopen turns it into the edit form in place', async () => {
    serve({ '/inquiries/i1': detail({ closedAt: '2026-10-16T01:00:00Z', closeOutcome: 'NotGoingAhead', closeNote: 'Chose a closer provider', updatedAt: '2026-10-16T01:00:00.25Z' }) })
    mockApiPost.mockResolvedValue(detail())
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')

    expect(await screen.findByRole('heading', { level: 1, name: 'Closed enquiry' })).toBeInTheDocument()
    expect(screen.getByText('Closed on Fri 16 Oct: Not going ahead.')).toBeInTheDocument()
    expect(screen.getByText('Chose a closer provider')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save enquiry' })).not.toBeInTheDocument()
    expect(screen.getByText('Contacts were deleted when this enquiry closed.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reopen enquiry' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reopen enquiry' }))

    expect(mockApiPost).toHaveBeenCalledWith('/inquiries/i1/reopen', { expectedUpdatedAt: '2026-10-16T01:00:00.25Z' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit enquiry' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^First name/)).toHaveValue('Rowan')
    const reopened = screen.getByText('Reopened. Add the contacts again below.')
    await waitFor(() => expect(document.activeElement?.contains(reopened)).toBe(true))
  })

  it('there is no Close enquiry on a new enquiry or a converted one', async () => {
    renderForm()
    expect(screen.queryByRole('button', { name: 'Close enquiry' })).not.toBeInTheDocument()
    cleanup()
    serve({ '/inquiries/i1': detail({ participantId: 'p-1' }) })
    renderForm('/participants/new-inquiry?id=i1')
    await screen.findByLabelText(/^First name/)
    expect(screen.queryByRole('button', { name: 'Close enquiry' })).not.toBeInTheDocument()
  })

  it('the contacts hint says contacts are deleted if the enquiry is closed', () => {
    renderForm()
    expect(screen.getByText("Family, guardians and anyone else to keep in touch with. They move to the participant's record when intake starts, and are deleted if the enquiry is closed.")).toBeInTheDocument()
  })
})

describe('InquiryFormPage (wire) — someone else saved first (PR 1 version check)', () => {
  it('a 409 "changed by someone else" shows the error Callout above the actions, keeps the typed values, and stays', async () => {
    serve({ '/inquiries/i1': detail({ updatedAt: '2026-10-16T01:02:03.456789Z' }) })
    mockApiPut.mockRejectedValue(Object.assign(new Error('Request failed with status code 409'), {
      isAxiosError: true, response: { status: 409, data: { success: false, errors: ['Someone else just changed this enquiry. Reload and try again.'] } },
    }))
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    const first = await screen.findByLabelText(/^First name/)
    await user.clear(first)
    await user.type(first, 'Ro')
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))

    const callout = await screen.findByText('Someone else just changed this enquiry. Reload and try again.')
    await waitFor(() => expect(document.activeElement?.contains(callout)).toBe(true))
    // Above the actions (SHAPE section 6): the Callout comes before the Save button in the page.
    expect(callout.compareDocumentPosition(screen.getByRole('button', { name: 'Save enquiry' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByLabelText(/^First name/)).toHaveValue('Ro')
    expect(screen.queryByText('Enquiries tab destination')).not.toBeInTheDocument()
  })
})

describe('InquiryFormPage (wire) — every booking write carries the version the form holds (ODIP-REVIEW-268)', () => {
  const START = '2030-10-15T23:00:00Z'
  const booked = {
    intakeStartsAt: START, intakeDurationMinutes: 90, intakeLocation: '12 Smith St', intakeStaffUserId: 'sam', intakeStaffName: 'Sam Lee', intakeStaffFirstName: 'Sam',
    intakeNotes: 'Gate code', intakeInviteSentAt: '2026-10-14T03:05:00Z',
  }
  const V1 = '2026-10-16T01:00:00.000001Z', V2 = '2026-10-16T01:05:00.000002Z', V3 = '2026-10-16T01:06:00.000003Z'

  it('Cancel visit sends v1; its checked answer (v2) is what the next Save sends, with the unsaved edit kept', async () => {
    serve({ '/inquiries/i1': detail({ ...booked, updatedAt: V1 }) })
    mockApiDeleteRaw.mockResolvedValue({ success: true, data: { inquiry: detail({ updatedAt: V2 }), cancellationEmail: 'Sent' } })
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    const first = await screen.findByLabelText(/^First name/)
    await user.clear(first)
    await user.type(first, 'Ro')
    await user.click(screen.getByRole('button', { name: 'Cancel visit' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel visit' }))

    expect(mockApiDeleteRaw).toHaveBeenCalledWith(`/inquiries/i1/intake-booking?expectedUpdatedAt=${encodeURIComponent(V1)}`)
    await screen.findByText('Intake visit cancelled')
    expect(screen.getByLabelText(/^First name/)).toHaveValue('Ro')
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(mockApiPut).toHaveBeenCalledWith('/inquiries/i1', expect.objectContaining({ firstName: 'Ro', expectedUpdatedAt: V2 }))
  })

  it('a 409 from Cancel visit says someone else changed it, keeps the edits and the visit', async () => {
    serve({ '/inquiries/i1': detail({ ...booked, updatedAt: V1 }) })
    mockApiDeleteRaw.mockRejectedValue(Object.assign(new Error('Request failed with status code 409'), {
      isAxiosError: true, response: { status: 409, data: { success: false, errors: ['Someone else just changed this visit. Reload and try again.'] } },
    }))
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    const first = await screen.findByLabelText(/^First name/)
    await user.type(first, 'n')
    await user.click(screen.getByRole('button', { name: 'Cancel visit' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel visit' }))

    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent('Someone else just changed this visit. Reload and try again.')
    expect(screen.getByLabelText(/^First name/)).toHaveValue('Rowann')
    expect(screen.queryByText('Intake visit cancelled')).not.toBeInTheDocument()
  })

  it('the save chain: the booking PUT sends the version the enquiry PUT returned', async () => {
    serve({ '/inquiries/i1': detail({ ...booked, updatedAt: V1 }) })
    mockApiPut.mockImplementation(async (url: string) => (url.endsWith('/intake-booking') ? detail({ ...booked, intakeStartsAt: '2030-10-16T00:00:00Z', updatedAt: V3 }) : detail({ ...booked, email: 'new@example.com', updatedAt: V2 })))
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')
    fireEvent.change(await screen.findByLabelText(/^Start time/), { target: { value: '11:00' } })
    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))

    await screen.findByText('Enquiries tab destination')
    expect(mockApiPut.mock.calls[0]).toEqual(['/inquiries/i1', expect.objectContaining({ expectedUpdatedAt: V1 })])
    expect(mockApiPut.mock.calls[1]).toEqual(['/inquiries/i1/intake-booking', expect.objectContaining({ expectedUpdatedAt: V2 })])
  })
})

describe('InquiryFormPage (wire) — a new enquiry\'s visit is checked in the provider\'s zone (ODIP-REVIEW-268, second finding)', () => {
  // 06:30Z is 2:30 pm in Perth (UTC+8, no daylight saving) on Fri 16 Oct 2026, and 5:30 pm in Sydney.
  const NOW_PERTH_1430 = new Date('2026-10-16T06:30:00Z')
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW_PERTH_1430) })
  afterEach(() => { vi.useRealTimers() })

  async function bookAt(time: string) {
    serve({ '/inquiries': [{ ...stored({ id: 'other' }), timeZoneId: 'Australia/Perth' }] })
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText(/^First name/), 'Ana')
    await user.type(screen.getByLabelText(/^Last name/), 'Lopez')
    await user.type(screen.getByLabelText(/^Email/), 'ana@example.com')
    await user.click(screen.getByRole('checkbox', { name: /book the intake visit now/i }))
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-16' } })
    fireEvent.change(screen.getByLabelText(/^Start time/), { target: { value: time } })
    await user.type(screen.getByLabelText(/^Where/), 'Library')
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))
  }

  it('3:00 pm Perth, booked at 2:30 pm Perth, is upcoming: the enquiry is sent', async () => {
    await bookAt('15:00')
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1))
    expect(screen.queryByText("Choose a time that hasn't passed.")).not.toBeInTheDocument()
  })

  it('2:00 pm Perth has passed: refused here, nothing sent', async () => {
    await bookAt('14:00')
    expect(await screen.findByText("Choose a time that hasn't passed.")).toBeInTheDocument()
    expect(mockApiPost).not.toHaveBeenCalled()
  })
})
