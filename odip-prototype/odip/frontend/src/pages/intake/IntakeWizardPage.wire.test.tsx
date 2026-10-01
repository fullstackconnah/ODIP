import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import IntakeWizardPage from './IntakeWizardPage'

// Wire level: only the HTTP helpers are mocked. Resuming an intake used to PUT the wizard's 61 keys to the full-record
// PUT /participants/{id}, which nulled every field the wizard does not carry (gender, diagnoses, allergies, key identifiers...), and
// stripped the contacts and risk entries the coordinator had just added before sending. Both now go to PUT /participants/{id}/intake.
const { mockApiGet, mockApiPostRaw, mockApiPutRaw } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPostRaw: vi.fn(), mockApiPutRaw: vi.fn() }))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiGet: mockApiGet, apiPostRaw: mockApiPostRaw, apiPutRaw: mockApiPutRaw }
})

const apiError = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { success: false, errors: [message] } } })

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: 'draft-1', firstName: 'Jamie', lastName: 'Rivers', fullName: 'Jamie Rivers', isDraft: true, isActive: false, intakeCompletedAt: null,
  ndisNumber: '430000007', planType: 'SelfManaged', fundingSource: 'Ndis', isRepeatClient: false, serviceStreams: '',
  mobilityAidWheelchair: false, mobilityAidWalker: false, isHighSupport: false, isIntensiveSupport: false, overnightSupport: 'None',
  overnightRatio: 'OneToOne', requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
  requiresStandingMachine: false, supportRatio: 'SharedSupport', ...overrides,
})

function serve(participant: unknown = draft()) {
  mockApiGet.mockImplementation(async (url: string) => {
    if (url === '/participants/draft-1') {
      if (participant instanceof Error) throw participant
      return participant
    }
    return [] // contact roles, risk entries, people
  })
}

function renderWizard(path = '/participants/draft-1/intake') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/participants/new', element: <IntakeWizardPage /> },
    { path: '/participants/:id/intake', element: <IntakeWizardPage /> },
    { path: '/participants/:id', element: <p>Participant detail</p> },
    { path: '/participants', element: <p>Participants list</p> },
  ], { initialEntries: [path] })
  return render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
}

const stepNav = () => screen.getByRole('navigation', { name: /intake wizard steps/i })
const expectStep = (label: RegExp) => within(stepNav()).findByRole('button', { name: label, current: 'step' })
const next = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^next$/i }))

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  serve()
  mockApiPutRaw.mockResolvedValue({ success: true, data: { id: 'draft-1', fullName: 'Jamie Rivers', isDraft: true, isActive: false } })
  mockApiPostRaw.mockResolvedValue({ success: true, data: { id: 'new-1', fullName: 'Jamie Rivers' } })
})

afterEach(() => {
  localStorage.clear()
  mockApiGet.mockReset(); mockApiPostRaw.mockReset(); mockApiPutRaw.mockReset()
})

describe('IntakeWizardPage (wire) — resuming a draft', () => {
  it('saves a draft through PUT /participants/{id}/intake with the wizard payload, never through the full-record PUT', async () => {
    const user = userEvent.setup()
    renderWizard()
    await screen.findByDisplayValue('Jamie')

    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    await waitFor(() => expect(mockApiPutRaw).toHaveBeenCalledTimes(1))
    const [url, body] = mockApiPutRaw.mock.calls[0]
    expect(url).toBe('/participants/draft-1/intake')
    expect(body).toMatchObject({ firstName: 'Jamie', lastName: 'Rivers', ndisNumber: '430000007', isDraft: true, completeIntake: false })
    // The collections are sent too (empty here): the server creates the new rows and skips the ones it already has.
    expect(body).toHaveProperty('contactRoles', [])
    expect(body).toHaveProperty('riskEntries', [])
    expect(body).not.toHaveProperty('completionRequestId')
    expect(mockApiPutRaw.mock.calls.map(([u]) => u)).not.toContain('/participants/draft-1')
    expect(await screen.findByText('Participant detail')).toBeInTheDocument()
  })

  it('sends the contact and the risk entry added while resuming, instead of silently dropping them', async () => {
    const user = userEvent.setup()
    renderWizard()
    await screen.findByDisplayValue('Jamie')
    await next(user); await expectStep(/ndis & funding/i)
    await next(user); await expectStep(/^3\s*contacts|contacts/i)

    await user.click(screen.getByRole('button', { name: /add contact/i }))
    await user.click(screen.getByRole('radio', { name: 'New person' }))
    const contactForm = screen.getByRole('radio', { name: 'New person' }).closest('div')!.parentElement!.parentElement!
    await user.type(within(contactForm).getByLabelText(/first name/i), 'Pat')
    await user.type(within(contactForm).getByLabelText(/last name/i), 'Parent')
    for (let i = 0; i < 5; i++) await next(user)
    await expectStep(/risks/i)
    await user.click(screen.getByRole('button', { name: /add risk entry/i }))
    await user.type(screen.getByLabelText(/^description/i), 'Wanders at night')
    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    await waitFor(() => expect(mockApiPutRaw).toHaveBeenCalledTimes(1))
    const body = mockApiPutRaw.mock.calls[0][1]
    expect(body.contactRoles).toEqual([expect.objectContaining({ newPersonFirstName: 'Pat', newPersonLastName: 'Parent', personId: null, status: 'Active' })])
    expect(body.riskEntries).toEqual([expect.objectContaining({ description: 'Wanders at night' })])
  })

  it('completes with one completion request id, and a retry after a failure re-sends the same one', async () => {
    mockApiPutRaw.mockRejectedValueOnce(apiError(500, 'Server hiccup'))
    const user = userEvent.setup()
    renderWizard()
    await screen.findByDisplayValue('Jamie')
    for (let i = 0; i < 8; i++) await next(user)
    await expectStep(/review/i)

    await user.click(screen.getByRole('button', { name: /complete intake/i }))
    await waitFor(() => expect(mockApiPutRaw).toHaveBeenCalledTimes(1))
    await user.click(await screen.findByRole('button', { name: /complete intake/i }))

    await waitFor(() => expect(mockApiPutRaw).toHaveBeenCalledTimes(2))
    const [first, second] = mockApiPutRaw.mock.calls.map(([, b]) => b)
    expect(first).toMatchObject({ isDraft: true, completeIntake: true, completionRequestId: expect.any(String) })
    expect(second.completionRequestId).toBe(first.completionRequestId)
  })

  it('shows the server\'s own reason when Complete Intake is refused, and stays on the wizard', async () => {
    mockApiPutRaw.mockRejectedValue(apiError(400, 'Plan Manager contacts are only available for plan-managed participants.'))
    const user = userEvent.setup()
    renderWizard()
    await screen.findByDisplayValue('Jamie')
    for (let i = 0; i < 8; i++) await next(user)
    await user.click(screen.getByRole('button', { name: /complete intake/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Plan Manager contacts are only available for plan-managed participants.')
    expect(screen.queryByText('Participants list')).not.toBeInTheDocument()
    expect(screen.queryByText(/failed to save this participant's intake details/i)).not.toBeInTheDocument()
  })

  it('falls back to a plain message when Complete Intake fails with no server text', async () => {
    mockApiPutRaw.mockRejectedValue(new Error('Network Error'))
    const user = userEvent.setup()
    renderWizard()
    await screen.findByDisplayValue('Jamie')
    for (let i = 0; i < 8; i++) await next(user)
    await user.click(screen.getByRole('button', { name: /complete intake/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save this participant's intake details/i)
  })
})

describe('IntakeWizardPage (wire) — creating a participant', () => {
  it('still creates through POST /participants and completes with a completion request id', async () => {
    const user = userEvent.setup()
    renderWizard('/participants/new')
    await user.type(screen.getByLabelText(/first name/i), 'Jamie')
    await user.type(screen.getByLabelText(/last name/i), 'Rivers')
    for (let i = 0; i < 8; i++) await next(user)
    await user.click(screen.getByRole('button', { name: /complete intake/i }))

    await waitFor(() => expect(mockApiPostRaw).toHaveBeenCalledTimes(1))
    expect(mockApiPostRaw.mock.calls[0][0]).toBe('/participants')
    expect(mockApiPostRaw.mock.calls[0][1]).toMatchObject({ isDraft: true, completeIntake: true, completionRequestId: expect.any(String) })
    expect(mockApiPutRaw).not.toHaveBeenCalled()
  })
})

describe('IntakeWizardPage (wire) — when the participant cannot be loaded', () => {
  it('says the participant could not be loaded, with a retry, instead of "Loading..." for ever', async () => {
    serve(apiError(500, 'boom'))
    const user = userEvent.setup()
    renderWizard()

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load this participant/i)
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()

    serve()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByDisplayValue('Jamie')).toBeInTheDocument()
  })

  it('says the participant was not found, with a way back, when the server answers 404', async () => {
    serve(apiError(404, 'Participant not found'))
    renderWizard()

    expect(await screen.findByText('Participant not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to participants/i })).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
  })
})
