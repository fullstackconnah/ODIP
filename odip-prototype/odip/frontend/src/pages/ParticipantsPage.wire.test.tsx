import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ParticipantsPage from './ParticipantsPage'

// Wire level: only the HTTP helpers are mocked, so the real hooks, the real page and a real query client run, and every
// assertion is on the method, URL and FULL body that would leave the browser (a hook-level mock cannot prove any of them).
const { mockApiGet, mockApiPostRaw, mockApiPutRaw, mockApiDeleteRaw } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPostRaw: vi.fn(),
  mockApiPutRaw: vi.fn(),
  mockApiDeleteRaw: vi.fn(),
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    apiGet: mockApiGet,
    apiPostRaw: mockApiPostRaw,
    apiPutRaw: mockApiPutRaw,
    apiDeleteRaw: mockApiDeleteRaw,
  }
})

const participant = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  firstName: 'Jamie',
  lastName: 'Smith',
  fullName: 'Jamie Smith',
  maskedNdisNumber: null,
  ndisNumber: null,
  planType: 'SelfManaged',
  region: 'QLD',
  mobilityAidWheelchair: false,
  isHighSupport: false,
  supportRatio: 'SharedSupport',
  isRepeatClient: false,
  isActive: true,
  isDraft: false,
  serviceStreams: 'None',
  hasActiveMedications: false,
  ...overrides,
})

const paged = (items: unknown[]) => ({ items, totalCount: items.length, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false })

/** An axios-shaped failure: the API's envelope sits on `response.data`, exactly where `extractErrorMessage` reads it. */
const apiError = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { success: false, errors: [message] } },
  })

const statusResult = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: { id: 'p1', isActive: false, isDraft: false, changed: true, warnings: [], ...overrides },
})

/** The Active view is `isActive=true`, the Archived view `isActive=false`: serve each its own rows. */
function serveLists({ active = [] as unknown[], archived = [] as unknown[] } = {}) {
  mockApiGet.mockImplementation(async (url: string, params?: Record<string, string>) => {
    if (url === '/participants/alerts') return []
    if (url === '/participants') return paged(params?.isActive === 'false' ? archived : active)
    throw new Error(`unexpected GET ${url}`)
  })
}

const participantListCalls = () => mockApiGet.mock.calls.filter(([url]) => url === '/participants')

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/participants']}>
        <Routes>
          <Route path="/participants" element={<ParticipantsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openStatusDialog(user: ReturnType<typeof userEvent.setup>, name = 'Jamie Smith') {
  await user.click(await screen.findByRole('button', { name: `Change status for ${name}` }))
  return screen.getByRole('alertdialog')
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  serveLists({ active: [participant()] })
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mockApiGet.mockReset()
  mockApiPostRaw.mockReset()
  mockApiPutRaw.mockReset()
  mockApiDeleteRaw.mockReset()
})

describe('ParticipantsPage (wire) — Change status', () => {
  it('POSTs {isActive:false} to /participants/{id}/status, never PUTs the participant, and confirms with the server\'s warnings', async () => {
    mockApiPostRaw.mockResolvedValue(
      statusResult({ warnings: ['3 upcoming shifts still reference this participant. They were not cancelled.'] }),
    )
    const user = userEvent.setup()
    renderPage()

    const dialog = await openStatusDialog(user)
    await user.click(within(dialog).getByRole('button', { name: /set jamie smith as inactive/i }))

    await waitFor(() => expect(mockApiPostRaw).toHaveBeenCalledTimes(1))
    expect(mockApiPostRaw).toHaveBeenCalledWith('/participants/p1/status', { isActive: false })
    // The full-record PUT is what answered 400 "First name is required." and closed the dialog without a word.
    expect(mockApiPutRaw).not.toHaveBeenCalled()

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('Jamie Smith is now Inactive')
    expect(notice).toHaveTextContent('3 upcoming shifts still reference this participant. They were not cancelled.')
  })

  it('refreshes the register once the change is saved', async () => {
    mockApiPostRaw.mockResolvedValue(statusResult())
    const user = userEvent.setup()
    renderPage()

    const dialog = await openStatusDialog(user)
    const before = participantListCalls().length
    await user.click(within(dialog).getByRole('button', { name: /set jamie smith as inactive/i }))

    await waitFor(() => expect(participantListCalls().length).toBeGreaterThan(before))
  })

  it('sends the typed reason, and omits it when the field is blank or only spaces', async () => {
    mockApiPostRaw.mockResolvedValue(statusResult())
    const user = userEvent.setup()
    renderPage()

    let dialog = await openStatusDialog(user)
    const reason = within(dialog).getByLabelText(/reason/i)
    expect(reason).toHaveAttribute('maxlength', '500')
    await user.type(reason, 'Moved interstate')
    await user.click(within(dialog).getByRole('button', { name: /set jamie smith as inactive/i }))
    await waitFor(() => expect(mockApiPostRaw).toHaveBeenCalledTimes(1))
    expect(mockApiPostRaw).toHaveBeenLastCalledWith('/participants/p1/status', { isActive: false, reason: 'Moved interstate' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    dialog = await openStatusDialog(user)
    await user.type(within(dialog).getByLabelText(/reason/i), '   ')
    await user.click(within(dialog).getByRole('button', { name: /set jamie smith as inactive/i }))
    await waitFor(() => expect(mockApiPostRaw).toHaveBeenCalledTimes(2))
    expect(mockApiPostRaw).toHaveBeenLastCalledWith('/participants/p1/status', { isActive: false })
  })

  it('keeps the dialog open with the confirm button disabled while the request is in flight', async () => {
    let settle!: (value: unknown) => void
    mockApiPostRaw.mockReturnValue(new Promise(resolve => { settle = resolve }))
    const user = userEvent.setup()
    renderPage()

    const dialog = await openStatusDialog(user)
    await user.click(within(dialog).getByRole('button', { name: /set jamie smith as inactive/i }))

    const confirm = await within(screen.getByRole('alertdialog')).findByRole('button', { name: /set jamie smith as inactive/i })
    await waitFor(() => expect(confirm).toBeDisabled())
    expect(confirm).toHaveTextContent('Processing...')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    settle(statusResult())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('keeps the dialog open and shows the server\'s message when the change is refused, with the typed reason intact, then lets the coordinator retry', async () => {
    mockApiPostRaw.mockRejectedValueOnce(apiError(400, 'A draft participant cannot be activated. Complete their intake and profile first.'))
    const user = userEvent.setup()
    renderPage()

    const dialog = await openStatusDialog(user)
    await user.type(within(dialog).getByLabelText(/reason/i), 'Moved interstate')
    await user.click(within(dialog).getByRole('button', { name: /set jamie smith as inactive/i }))

    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent(
      'A draft participant cannot be activated. Complete their intake and profile first.',
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(within(screen.getByRole('alertdialog')).getByLabelText(/reason/i)).toHaveValue('Moved interstate')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    mockApiPostRaw.mockResolvedValueOnce(statusResult())
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /set jamie smith as inactive/i }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mockApiPostRaw).toHaveBeenCalledTimes(2)
    expect(mockApiPostRaw).toHaveBeenLastCalledWith('/participants/p1/status', { isActive: false, reason: 'Moved interstate' })
  })

  it('falls back to a plain message when the failure carries no server text', async () => {
    mockApiPostRaw.mockRejectedValueOnce(new Error('Network Error'))
    const user = userEvent.setup()
    renderPage()

    const dialog = await openStatusDialog(user)
    await user.click(within(dialog).getByRole('button', { name: /set jamie smith as inactive/i }))

    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent(
      "Could not change this participant's status. Please try again.",
    )
  })

  it('reactivates an archived participant with {isActive:true}', async () => {
    serveLists({ archived: [participant({ isActive: false })] })
    mockApiPostRaw.mockResolvedValue(statusResult({ isActive: true }))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('radio', { name: 'Archived' }))
    const dialog = await openStatusDialog(user)
    await user.click(within(dialog).getByRole('button', { name: /set jamie smith as active/i }))

    await waitFor(() => expect(mockApiPostRaw).toHaveBeenCalledTimes(1))
    expect(mockApiPostRaw).toHaveBeenCalledWith('/participants/p1/status', { isActive: true })
    expect(mockApiPutRaw).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Jamie Smith is now Active'))
  })
})

describe('ParticipantsPage (wire) — Archive and Restore', () => {
  it('restores through POST /participants/{id}/restore with an empty body, and never PUTs the list row back', async () => {
    serveLists({ archived: [participant({ isActive: false })] })
    mockApiPostRaw.mockResolvedValue(statusResult({ isActive: true }))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('radio', { name: 'Archived' }))
    await user.click(await screen.findByRole('button', { name: 'Restore' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Restore "Jamie Smith"?')
    const before = participantListCalls().length
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(mockApiPostRaw).toHaveBeenCalledTimes(1))
    // Spreading the list row into a PUT is what wiped the participant's profile and left them inactive.
    expect(mockApiPostRaw).toHaveBeenCalledWith('/participants/p1/restore', {})
    expect(mockApiPutRaw).not.toHaveBeenCalled()
    await waitFor(() => expect(participantListCalls().length).toBeGreaterThan(before))
  })

  it('shows the server\'s message above the table when the restore is refused, and lets it be dismissed', async () => {
    serveLists({ archived: [participant({ isActive: false })] })
    mockApiPostRaw.mockRejectedValue(apiError(404, 'Participant not found'))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('radio', { name: 'Archived' }))
    await user.click(await screen.findByRole('button', { name: 'Restore' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Participant not found')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the server\'s message when archiving is refused', async () => {
    mockApiDeleteRaw.mockRejectedValue(apiError(409, 'This participant cannot be archived right now.'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Archive' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(mockApiDeleteRaw).toHaveBeenCalledWith('/participants/p1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('This participant cannot be archived right now.')
  })
})
