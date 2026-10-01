import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InquiryFormPage from './InquiryFormPage'

// Wire level: only the HTTP helpers are mocked, so the real hooks, the real form and a real query client run, and every assertion
// is on the method, URL and FULL body that would leave the browser.
const { mockApiGet, mockApiPost, mockApiPut } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPost: vi.fn(), mockApiPut: vi.fn() }))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiGet: mockApiGet, apiPost: mockApiPost, apiPut: mockApiPut }
})

const apiError = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { success: false, errors: [message] } } })

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'i1', firstName: 'Rowan', lastName: 'Blake', phone: '0400 000 999', email: 'rowan@example.com', source: 'Web',
  provenance: 'Referred by Dr Patel, Brisbane', participantId: null, createdAt: '2026-09-20T01:00:00',
  ...overrides,
})

function renderForm(path = '/participants/new-inquiry') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/participants/new-inquiry" element={<InquiryFormPage />} />
          <Route path="/participants" element={<p>Enquiries tab destination</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mockApiGet.mockResolvedValue([])
  mockApiPost.mockResolvedValue(stored())
  mockApiPut.mockResolvedValue(stored())
})

afterEach(() => {
  localStorage.clear()
  mockApiGet.mockReset(); mockApiPost.mockReset(); mockApiPut.mockReset()
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
      firstName: 'Ava', lastName: 'Ng', phone: null, email: null, source: 'Phone', provenance: null,
    })
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
    let arrive!: (rows: unknown[]) => void
    mockApiGet.mockReturnValue(new Promise(resolve => { arrive = resolve }))
    renderForm('/participants/new-inquiry?id=i1')

    expect(screen.getByRole('status')).toHaveTextContent(/loading enquiry/i)
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save enquiry' })).not.toBeInTheDocument()

    arrive([stored()])
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue('Rowan'))
    expect(screen.getByLabelText(/last name/i)).toHaveValue('Blake')
    expect(screen.getByLabelText('Phone')).toHaveValue('0400 000 999')
    expect(screen.getByLabelText('Email')).toHaveValue('rowan@example.com')
    expect(screen.getByLabelText('Source')).toHaveValue('Web')
    expect(screen.getByLabelText(/provenance or referral notes/i)).toHaveValue('Referred by Dr Patel, Brisbane')
  })

  it('saves the loaded email, source and provenance with only the name changed: a cold edit never overwrites them with blanks', async () => {
    mockApiGet.mockResolvedValue([stored()])
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
      provenance: 'Referred by Dr Patel, Brisbane',
    })
  })

  it('says so when there is no such enquiry, with a way back', async () => {
    mockApiGet.mockResolvedValue([stored({ id: 'someone-else' })])
    renderForm('/participants/new-inquiry?id=i1')

    expect(await screen.findByText(/enquiry not found/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument()
  })

  it('says the enquiry could not be loaded, with a retry, when the list request fails: not "not found", not a blank form', async () => {
    mockApiGet.mockRejectedValueOnce(apiError(500, 'boom'))
    const user = userEvent.setup()
    renderForm('/participants/new-inquiry?id=i1')

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load this enquiry/i)
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument()

    mockApiGet.mockResolvedValue([stored()])
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue('Rowan'))
  })
})
