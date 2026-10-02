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

/** Serves each view its own rows: Active is isActive=true, Archived isActive=false. Drafts are not a register view any more: they are on the Enquiries and Onboarding tabs. */
function serve({ active = [] as unknown[], archived = [] as unknown[], worklist = [] as unknown[], enquiries = [] as unknown[] } = {}) {
  mockApiGet.mockImplementation(async (url: string, params?: Record<string, string>) => {
    if (url === '/participants/alerts') return []
    if (url === '/participants') return paged(params?.isActive === 'false' ? archived : active)
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
          <Route path="/onboarding/:id" element={<p>Onboarding checklist destination</p>} />
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
  it('shows the Active / Archived views, no Drafts view, and a search box on the participants tab', async () => {
    renderHub()

    await screen.findByText('Jamie Smith')
    const views = screen.getByRole('radiogroup', { name: /participant list view/i })
    expect(within(views).getAllByRole('radio').map(r => r.getAttribute('aria-label') ?? r.textContent)).toEqual(['Active', 'Archived'])
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

  it('never asks the register for drafts: they are on the Enquiries and Onboarding tabs now', async () => {
    const user = userEvent.setup()
    renderHub()
    await screen.findByText('Jamie Smith')
    await user.click(screen.getByRole('radio', { name: 'Archived' }))
    await waitFor(() => expect(listCalls().at(-1)).toMatchObject({ isActive: 'false', isDraft: 'false' }))

    // Active and Archived both ask for finalised participants only. A draft is never listed here, so there is no draft row to resume from the register.
    expect(listCalls().every(params => params?.isDraft === 'false')).toBe(true)
  })

  it('lists a draft intake started without an enquiry on the Enquiries tab, so dropping the Drafts view loses nobody', async () => {
    serve({
      enquiries: [{
        id: 'd1', participantId: 'd1', firstName: 'Dana', lastName: 'Draft', phone: '0411 111 111', email: null, source: '', provenance: null, createdAt: '2026-09-02',
        participantIsDraft: true, participantIsActive: false, participantIntakeCompletedAt: null, isDirectIntake: true,
      }],
    })
    const user = userEvent.setup()
    renderHub('/participants?tab=enquiries')

    expect(await screen.findByText('Dana Draft')).toBeInTheDocument()
    expect(screen.getByText('Draft intake')).toBeInTheDocument()
    // A draft is resumed, not archived or switched on: the next step is the intake wizard.
    await user.click(screen.getByRole('button', { name: 'Resume intake' }))
    expect(screen.getByText('Intake wizard destination')).toBeInTheDocument()
  })

  it('lists a participant whose intake is complete on the Onboarding tab, with their checklist one click away', async () => {
    serve({
      worklist: [{ participantId: 'w2', fullName: 'Ira Intake', stage: 'Onboarding incomplete', nextAction: 'Validate profile essentials', completedSteps: 1, totalSteps: 5, reasons: ['Profile requires date of birth.'] }],
      enquiries: [{ id: 'e2', participantId: 'w2', firstName: 'Ira', lastName: 'Intake', phone: null, email: null, source: 'Phone', provenance: null, createdAt: '2026-09-02', participantIsDraft: true, participantIsActive: false, participantIntakeCompletedAt: '2026-09-20T03:00:00' }],
    })
    const user = userEvent.setup()
    renderHub('/participants?tab=onboarding')

    expect(await screen.findByText('Ira Intake')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open onboarding for Ira Intake' }))
    expect(screen.getByText('Onboarding checklist destination')).toBeInTheDocument()
  })

  it('does not repeat that participant on the Enquiries tab: their enquiry has moved on to onboarding', async () => {
    serve({
      enquiries: [{ id: 'e2', participantId: 'w2', firstName: 'Ira', lastName: 'Intake', phone: null, email: null, source: 'Phone', provenance: null, createdAt: '2026-09-02', participantIsDraft: true, participantIsActive: false, participantIntakeCompletedAt: '2026-09-20T03:00:00' }],
    })
    renderHub('/participants?tab=enquiries')

    expect(await screen.findByText('No open enquiries')).toBeInTheDocument()
    expect(screen.queryByText('Ira Intake')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open onboarding/i })).not.toBeInTheDocument()
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

  it('shows loading, not "No participants in onboarding", while the browser reports offline and the worklist has not loaded (review F-1, same class)', async () => {
    onlineManager.setOnline(false)
    renderHub('/participants?tab=onboarding')

    expect(await screen.findByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('No participants in onboarding')).not.toBeInTheDocument()
  })

  it('shows loading, not "No open enquiries", while the browser reports offline and the list has not loaded (review F-1, same class)', async () => {
    onlineManager.setOnline(false)
    renderHub('/participants?tab=enquiries')

    expect(await screen.findByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('No open enquiries')).not.toBeInTheDocument()
  })

  it('shows the enquiries search, and no status filter: the tab already says which stage it is', async () => {
    serve({ enquiries: [{ id: 'e1', firstName: 'Eve', lastName: 'Enquiry', phone: '0400', email: null, source: 'Phone', provenance: null, participantId: null, createdAt: '2026-09-01' }] })
    renderHub('/participants?tab=enquiries')

    await screen.findByText('Eve Enquiry')
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /search enquiries/i })).toBeInTheDocument()
  })
})
