import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
    serve({ '/inquiries/i1': detail({ contacts: [maria, tom] }) })
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
