import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import ParticipantsHubPage from './ParticipantsHubPage'

// L2-02: ParticipantsHubPage rendered only the three tables' bodies, so the Active/Archived toggle and the #146 search and status
// filters lived in standalone page headers that no route reaches any more. Archiving became a one-way door, and the register had
// no search. Wire level: the real hub, real tables and a real query client over a mocked HTTP layer.
const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiGet: mockApiGet }
})

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1', firstName: 'Jamie', lastName: 'Smith', fullName: 'Jamie Smith', maskedNdisNumber: null, ndisNumber: null, planType: 'SelfManaged',
  region: 'QLD', mobilityAidWheelchair: false, isHighSupport: false, supportRatio: 'SharedSupport', isRepeatClient: false,
  isActive: true, isDraft: false, serviceStreams: 'None', hasActiveMedications: false, intakeCompletedAt: null, ...overrides,
})
const paged = (items: unknown[]) => ({ items, totalCount: items.length, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false })
const apiError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { success: false, errors: ['boom'] } } })

type Params = Record<string, string> | undefined
const listCalls = () => mockApiGet.mock.calls.filter(([url]) => url === '/participants').map(([, params]) => params as Params)

/** Serves each view its own rows: Active is isActive=true, Archived isActive=false, Drafts isDraft=true. */
function serve({ active = [] as unknown[], archived = [] as unknown[], drafts = [] as unknown[], worklist = [] as unknown[], enquiries = [] as unknown[] } = {}) {
  mockApiGet.mockImplementation(async (url: string, params?: Record<string, string>) => {
    if (url === '/participants/alerts') return []
    if (url === '/participants') return paged(params?.isDraft === 'true' ? drafts : params?.isActive === 'false' ? archived : active)
    if (url === '/inquiries/onboarding-worklist') return worklist
    if (url === '/inquiries') return enquiries
    throw new Error(`unexpected GET ${url}`)
  })
}

function renderHub(path = '/participants') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/participants" element={<ParticipantsHubPage />} />
          <Route path="/participants/:id/intake" element={<p>Intake wizard destination</p>} />
          <Route path="/participants/:id/profile" element={<p>Profile wizard destination</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  serve({ active: [row()] })
})

afterEach(() => {
  localStorage.clear()
  mockApiGet.mockReset()
  onlineManager.setOnline(true)
})

describe('ParticipantsHubPage (wire) — the register has its controls back', () => {
  it('shows the Active / Drafts / Archived views and a search box on the participants tab', async () => {
    renderHub()

    await screen.findByText('Jamie Smith')
    const views = screen.getByRole('radiogroup', { name: /participant list view/i })
    expect(within(views).getAllByRole('radio').map(r => r.getAttribute('aria-label') ?? r.textContent)).toEqual(['Active', 'Drafts', 'Archived'])
    expect(screen.getByRole('radio', { name: 'Active' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: /search participants/i })).toBeInTheDocument()
  })

  it('sends the typed search to the server, which owns the (now case-insensitive) match', async () => {
    const user = userEvent.setup()
    renderHub()
    await screen.findByText('Jamie Smith')

    await user.type(screen.getByRole('textbox', { name: /search participants/i }), 'jam')

    await waitFor(() => expect(listCalls().at(-1)).toMatchObject({ search: 'jam', isActive: 'true', isDraft: 'false', operationalOnly: 'true' }))
  })

  it('lists archived participants under Archived, and offers Restore, so Archive is no longer a one-way door', async () => {
    serve({ active: [row()], archived: [row({ id: 'p9', fullName: 'Robin Archived', isActive: false })] })
    const user = userEvent.setup()
    renderHub()
    await screen.findByText('Jamie Smith')

    await user.click(screen.getByRole('radio', { name: 'Archived' }))

    expect(await screen.findByText('Robin Archived')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    // Not narrowed by the onboarding stage rule: a participant archived after onboarding must still be findable here.
    expect(listCalls().at(-1)).toMatchObject({ isActive: 'false', isDraft: 'false' })
    expect(listCalls().at(-1)).not.toHaveProperty('operationalOnly')
  })

  it('lists drafts under Drafts, so a draft with no onboarding row appears in a tab', async () => {
    serve({
      active: [row()],
      drafts: [
        row({ id: 'd1', fullName: 'Dana Draft', isDraft: true, isActive: false, intakeCompletedAt: null }),
        row({ id: 'd2', fullName: 'Ira Intake', isDraft: true, isActive: false, intakeCompletedAt: '2026-09-20T03:00:00' }),
      ],
    })
    const user = userEvent.setup()
    renderHub()
    await screen.findByText('Jamie Smith')

    await user.click(screen.getByRole('radio', { name: 'Drafts' }))

    expect(await screen.findByText('Dana Draft')).toBeInTheDocument()
    expect(listCalls().at(-1)).toMatchObject({ isDraft: 'true' })
    expect(listCalls().at(-1)).not.toHaveProperty('operationalOnly')
    // A draft is resumed, not archived or switched on: the next step depends on where its intake stands.
    await user.click(screen.getByRole('button', { name: 'Resume intake for Dana Draft' }))
    expect(screen.getByText('Intake wizard destination')).toBeInTheDocument()
  })

  it('points a draft whose intake is complete at its profile, and offers no status change or archive on a draft', async () => {
    serve({ drafts: [row({ id: 'd2', fullName: 'Ira Intake', isDraft: true, isActive: false, intakeCompletedAt: '2026-09-20T03:00:00' })] })
    const user = userEvent.setup()
    renderHub()
    await user.click(await screen.findByRole('radio', { name: 'Drafts' }))
    await screen.findByText('Ira Intake')

    expect(screen.queryByRole('button', { name: /change status/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue profile for Ira Intake' }))
    expect(screen.getByText('Profile wizard destination')).toBeInTheDocument()
  })

  it('says the register could not be loaded, with a retry, instead of "No participants yet" (L5-12)', async () => {
    mockApiGet.mockImplementation(async (url: string) => {
      if (url === '/participants/alerts') return []
      throw apiError(500)
    })
    renderHub()

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load participants/i)
    expect(screen.queryByText('No participants yet')).not.toBeInTheDocument()

    serve({ active: [row()] })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Jamie Smith')).toBeInTheDocument()
  })

  it('shows loading, not "No participants yet", while the browser reports offline and the first request has not run (review F-1)', async () => {
    // TanStack Query pauses a request while offline: isLoading false, isError false, data undefined. That is not an empty register.
    onlineManager.setOnline(false)
    renderHub()

    expect(await screen.findByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('No participants yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Add participant' })).not.toBeInTheDocument()
  })

  it('still says "No participants yet" for a register that loaded and is empty', async () => {
    serve({ active: [] })
    renderHub()

    expect(await screen.findByText('No participants yet')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ParticipantsHubPage (wire) — the other two tabs have their search and filter back', () => {
  it('shows the onboarding search once the worklist has rows', async () => {
    serve({ worklist: [{ participantId: 'w1', fullName: 'Wren Worklist', stage: 'Intake incomplete', nextAction: 'Complete intake', completedSteps: 0, totalSteps: 5, reasons: ['Intake PDF completion is required.'] }] })
    renderHub('/participants?tab=onboarding')

    await screen.findByText('Wren Worklist')
    expect(screen.getByRole('textbox', { name: /search participants, stages or gates/i })).toBeInTheDocument()
  })

  it('shows the enquiries status filter and search', async () => {
    serve({ enquiries: [{ id: 'e1', firstName: 'Eve', lastName: 'Enquiry', phone: '0400', email: null, source: 'Phone', provenance: null, participantId: null, createdAt: '2026-09-01' }] })
    renderHub('/participants?tab=enquiries')

    await screen.findByText('Eve Enquiry')
    expect(screen.getByRole('radiogroup', { name: /filter enquiries by status/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /search enquiries/i })).toBeInTheDocument()
  })
})
