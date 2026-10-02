import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import ProfileWizardPage from './ProfileWizardPage'

// Wire level. "Complete Profile" used to send the whole form to the full-record PUT /participants/{id} (with isDraft: false and the
// participant's own isActive), which replaced every field and let an edit reactivate an archived participant. Each step is already saved
// by its own PATCH, so completing is now one POST that carries no profile field. And re-saving an earlier step refetched the participant
// and reset the whole form, discarding what had been typed on later steps (L2-15).
const { mockApiGet, mockApiPatchRaw, mockApiPostRaw, mockApiPutRaw, mockApiPut } = vi.hoisted(() => ({
  mockApiGet: vi.fn(), mockApiPatchRaw: vi.fn(), mockApiPostRaw: vi.fn(), mockApiPutRaw: vi.fn(), mockApiPut: vi.fn(),
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiGet: mockApiGet, apiPatchRaw: mockApiPatchRaw, apiPostRaw: mockApiPostRaw, apiPutRaw: mockApiPutRaw, apiPut: mockApiPut }
})

const apiError = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { success: false, errors: [message] } } })

const base = {
  id: 'participant-1', firstName: 'Jamie', lastName: 'Rivers', fullName: 'Jamie Rivers', preferredName: '', phone: '', email: '',
  addressStreet: '', addressSuburb: '', addressState: '', addressPostcode: '', ndisNumber: 'NDIS-123', planType: 'SelfManaged', fundingSource: 'Ndis',
  isActive: false, isRepeatClient: false, mobilityAidWheelchair: false, mobilityAidWalker: false, isHighSupport: false, isIntensiveSupport: false,
  supportRatio: 'OneToOne', overnightSupport: 'None', overnightRatio: 'OneToOne', hasRestrictivePracticeFlag: false, serviceStreams: 'InHomeSupport',
  hasActiveMedications: false, isDraft: true, intakeCompletedAt: '2026-09-20T03:00:00', mobilitySupportOptions: [], otherDiagnoses: [],
  hidpaSupportCategories: 'None', requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
  requiresStandingMachine: false, createdAt: '2026-01-01T00:00:00Z', consents: [], healthConditions: [], adlAssessments: [],
  checklistItems: [], communityAccessRiskItems: [],
}

let revision = 0
/** The server stamps updatedAt on every PATCH, so every refetch yields a new object, as the real API does. */
function serve(participant: unknown = null) {
  mockApiGet.mockImplementation(async (url: string) => {
    if (url === '/participants/participant-1') {
      if (participant instanceof Error) throw participant
      return { ...base, ...(participant as object ?? {}), updatedAt: `2026-10-01T00:00:${String(revision++).padStart(2, '0')}Z` }
    }
    return []
  })
}

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/participants/:id/profile', element: <ProfileWizardPage /> },
    { path: '/participants/:id', element: <p>Participant detail</p> },
    { path: '/participants', element: <p>Participants list</p> },
  ], { initialEntries: ['/participants/participant-1/profile'] })
  return render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
}

const stepNav = () => screen.getByRole('navigation', { name: /profile wizard steps/i })
const expectStep = (label: RegExp) => within(stepNav()).findByRole('button', { name: label, current: 'step' })
const next = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^next$/i }))

beforeEach(() => {
  revision = 0
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  serve()
  mockApiPatchRaw.mockResolvedValue({ success: true, data: { id: 'participant-1' } })
  mockApiPostRaw.mockResolvedValue({ success: true, data: { id: 'participant-1', isDraft: false } })
})

afterEach(() => {
  localStorage.clear()
  for (const mock of [mockApiGet, mockApiPatchRaw, mockApiPostRaw, mockApiPutRaw, mockApiPut]) mock.mockReset()
  onlineManager.setOnline(true)
})

async function walkToReview(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: /profile/i })
  for (let i = 0; i < 6; i++) await next(user)
  await expectStep(/review/i)
}

describe('ProfileWizardPage (wire) — completing the profile', () => {
  it('finalises through POST /participants/{id}/complete-profile with an empty body, never the full-record PUT', async () => {
    const user = userEvent.setup()
    renderWizard()
    await walkToReview(user)

    await user.click(screen.getByRole('button', { name: /complete profile/i }))

    await waitFor(() => expect(mockApiPostRaw).toHaveBeenCalledTimes(1))
    expect(mockApiPostRaw).toHaveBeenCalledWith('/participants/participant-1/complete-profile', {})
    expect(mockApiPutRaw).not.toHaveBeenCalled()
    expect(await screen.findByText('Participant detail')).toBeInTheDocument()
  })

  it('shows the server\'s own reason when completing is refused, and stays on the wizard', async () => {
    mockApiPostRaw.mockRejectedValue(apiError(400, "Complete the participant's intake before completing their profile."))
    const user = userEvent.setup()
    renderWizard()
    await walkToReview(user)

    await user.click(screen.getByRole('button', { name: /complete profile/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Complete the participant's intake before completing their profile.")
    expect(screen.queryByText('Participant detail')).not.toBeInTheDocument()
  })
})

// Review F-5: Complete Profile used to PATCH every step whenever the form was dirty. One edited field meant up to seven PATCHes, a refusal in
// a step nobody touched blocked completion, and untouched sections were rewritten from the form's copy. Now only a step whose fields differ from
// what was last known to match the server is saved.
describe('ProfileWizardPage (wire) — Complete Profile saves only the steps that changed (review F-5)', () => {
  const railTo = (name: RegExp) => within(stepNav()).getByRole('button', { name })

  /** Reaches Review with every step saved by its own Next, then edits the Medical step through the rail (which does not save the step it leaves). */
  async function editMedicalFromReview(user: ReturnType<typeof userEvent.setup>) {
    await walkToReview(user)
    await user.click(railTo(/medical detail/i))
    await expectStep(/medical detail/i)
    await user.type(screen.getByLabelText('Medical Summary'), 'Allergic to peanuts, carries an EpiPen')
    await user.click(railTo(/review/i))
    await expectStep(/review/i)
  }

  it('sends no PATCH at all when nothing has changed since the last save', async () => {
    const user = userEvent.setup()
    renderWizard()
    await walkToReview(user)
    mockApiPatchRaw.mockClear()

    await user.click(screen.getByRole('button', { name: /complete profile/i }))

    await waitFor(() => expect(mockApiPostRaw).toHaveBeenCalledTimes(1))
    expect(mockApiPatchRaw).not.toHaveBeenCalled()
  })

  it('saves only the step that was edited after its save, then finalises', async () => {
    const user = userEvent.setup()
    renderWizard()
    await editMedicalFromReview(user)
    mockApiPatchRaw.mockClear()

    await user.click(screen.getByRole('button', { name: /complete profile/i }))

    await waitFor(() => expect(mockApiPostRaw).toHaveBeenCalledTimes(1))
    expect(mockApiPatchRaw).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mockApiPatchRaw.mock.calls[0][1])).toContain('Allergic to peanuts, carries an EpiPen')
    expect(mockApiPostRaw).toHaveBeenCalledWith('/participants/participant-1/complete-profile', {})
  })

  it('is not blocked by a refusal in a step the user never touched', async () => {
    const user = userEvent.setup()
    renderWizard()
    await editMedicalFromReview(user)
    // From here on the server refuses every PATCH except the one that carries the edit.
    mockApiPatchRaw.mockReset()
    mockApiPatchRaw.mockImplementation(async (_url: string, body: unknown) => {
      if (!JSON.stringify(body).includes('Allergic to peanuts')) throw apiError(400, 'Some other section was refused.')
      return { success: true, data: { id: 'participant-1' } }
    })

    await user.click(screen.getByRole('button', { name: /complete profile/i }))

    await waitFor(() => expect(mockApiPostRaw).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Some other section was refused.')).not.toBeInTheDocument()
  })

  it('does not finalise when the step that WAS edited is refused, and says why', async () => {
    const user = userEvent.setup()
    renderWizard()
    await editMedicalFromReview(user)
    mockApiPatchRaw.mockReset()
    mockApiPatchRaw.mockRejectedValue(apiError(400, 'Medical summary is too long.'))

    await user.click(screen.getByRole('button', { name: /complete profile/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Medical summary is too long.')
    expect(mockApiPostRaw).not.toHaveBeenCalled()
  })
})

describe('ProfileWizardPage (wire) — saving an earlier step keeps what was typed on a later one (L2-15)', () => {
  it('does not reset the form to the server\'s copy when a PATCH makes the participant refetch', async () => {
    const user = userEvent.setup()
    renderWizard()
    await screen.findByRole('heading', { name: /profile/i })
    await next(user); await expectStep(/cultural depth/i)
    await next(user); await expectStep(/medical detail/i)
    await user.type(screen.getByLabelText('Medical Summary'), 'Allergic to peanuts, carries an EpiPen')

    // Back to the first step (the rail does not save the step it leaves), then re-save it.
    await user.click(within(stepNav()).getByRole('button', { name: /key identifiers/i }))
    await expectStep(/key identifiers/i)
    const patchesBefore = mockApiPatchRaw.mock.calls.length
    await next(user)
    await waitFor(() => expect(mockApiPatchRaw.mock.calls.length).toBeGreaterThan(patchesBefore))
    await expectStep(/cultural depth/i)
    // Let the refetch the PATCH triggered land and be applied.
    await waitFor(() => expect(mockApiGet.mock.calls.filter(([u]) => u === '/participants/participant-1').length).toBeGreaterThan(2))

    await user.click(within(stepNav()).getByRole('button', { name: /medical detail/i }))
    await expectStep(/medical detail/i)
    expect(screen.getByLabelText('Medical Summary')).toHaveValue('Allergic to peanuts, carries an EpiPen')
  })
})

describe('ProfileWizardPage (wire) — when the participant cannot be loaded', () => {
  it('says the participant could not be loaded, with a retry, instead of "Loading..." for ever', async () => {
    serve(apiError(500, 'boom'))
    const user = userEvent.setup()
    renderWizard()

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load this participant/i)
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()

    serve()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('heading', { name: /profile/i })).toBeInTheDocument()
  })

  it('shows loading, not "Participant not found", while the browser reports offline and the request has not run (review F-1)', async () => {
    onlineManager.setOnline(false)
    renderWizard()

    expect(await screen.findByRole('status')).toHaveTextContent(/loading participant/i)
    expect(screen.queryByText('Participant not found')).not.toBeInTheDocument()
  })

  it('says the participant was not found, with a way back, when the server answers 404', async () => {
    serve(apiError(404, 'Participant not found'))
    renderWizard()

    expect(await screen.findByText('Participant not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to participants/i })).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
  })
})
