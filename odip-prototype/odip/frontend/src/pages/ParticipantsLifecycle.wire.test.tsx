import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ParticipantsHubPage from './ParticipantsHubPage'
import OnboardingDetailPage from './OnboardingDetailPage'
import IntakeWizardPage from './intake/IntakeWizardPage'
import ProfileWizardPage from './profile/ProfileWizardPage'

// The participant lifecycle end to end: enquiry -> draft intake -> intake complete (Onboarding tab) -> active (Active participants tab).
// The real hub, tables, Intake wizard, onboarding checklist and Profile wizard run over a real query client (with the app's 30s staleTime, so a
// missing cache invalidation shows up as a stale tab) against a small in-memory server that applies the rules of the real controllers. Only the
// HTTP helpers are mocked. The server's own rules are held by ParticipantHubFlowTests on the backend (the same sequence through the real
// controllers); this holds the screens to the contract those rules produce.
const { mockApiGet, mockApiPost, mockApiPostRaw, mockApiPutRaw, mockApiPatchRaw } = vi.hoisted(() => ({
  mockApiGet: vi.fn(), mockApiPost: vi.fn(), mockApiPostRaw: vi.fn(), mockApiPutRaw: vi.fn(), mockApiPatchRaw: vi.fn(),
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiGet: mockApiGet, apiPost: mockApiPost, apiPostRaw: mockApiPostRaw, apiPutRaw: mockApiPutRaw, apiPatchRaw: mockApiPatchRaw }
})

type Mode = 'Warn' | 'Enforce'
type FakeParticipant = {
  id: string; firstName: string; lastName: string; phone: string | null; email: string | null
  isDraft: boolean; isActive: boolean; intakeCompletedAt: string | null
}
type FakeInquiry = { id: string; firstName: string; lastName: string; phone: string | null; source: string; participantId: string | null; createdAt: string }

const INTAKE_DONE_AT = '2026-10-02T03:00:00Z'
const httpError = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { success: false, errors: [message] } } })
const paged = (items: unknown[]) => ({ items, totalCount: items.length, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false })

/** Who is where before the test starts: one finalised participant, one draft intake nobody enquired about, and one open enquiry. */
function createServer(mode: Mode) {
  const participants: FakeParticipant[] = [
    { id: 'p-alex', firstName: 'Alex', lastName: 'Active', phone: null, email: null, isDraft: false, isActive: true, intakeCompletedAt: '2026-08-01T00:00:00Z' },
    { id: 'p-dana', firstName: 'Dana', lastName: 'Direct', phone: '0411 111 111', email: null, isDraft: true, isActive: false, intakeCompletedAt: null },
  ]
  const inquiries: FakeInquiry[] = [
    { id: 'enq-ada', firstName: 'Ada', lastName: 'Lovelace', phone: '0400 000 001', source: 'Phone', participantId: null, createdAt: '2026-09-01' },
  ]
  const calls: string[] = []
  const name = (p: FakeParticipant) => `${p.firstName} ${p.lastName}`
  const find = (id: string) => {
    const participant = participants.find(p => p.id === id)
    if (!participant) throw httpError(404, 'Participant not found')
    return participant
  }

  // ParticipantInquiriesController.GetAll: every enquiry with where its participant has got to, plus the drafts no enquiry started.
  const enquiryFeed = () => [
    ...inquiries.map(inquiry => {
      const p = participants.find(x => x.id === inquiry.participantId)
      return { ...inquiry, email: null, provenance: null, ...(p ? { participantIsDraft: p.isDraft, participantIsActive: p.isActive, participantIntakeCompletedAt: p.intakeCompletedAt } : {}) }
    }),
    ...participants.filter(p => p.isDraft && !p.intakeCompletedAt && !inquiries.some(i => i.participantId === p.id)).map(p => ({
      id: p.id, participantId: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone, email: p.email, source: '', provenance: null,
      createdAt: '2026-09-15', participantIsDraft: true, participantIsActive: p.isActive, participantIntakeCompletedAt: null, isDirectIntake: true,
    })),
  ]
  // ParticipantStages.InOnboarding: intake complete, still a draft, not active. By the participant's flags, not by any onboarding row.
  const inOnboarding = () => participants.filter(p => p.isDraft && !p.isActive && p.intakeCompletedAt)
  const worklist = () => inOnboarding().map(p => ({
    participantId: p.id, fullName: name(p), stage: 'Onboarding incomplete', nextAction: 'Validate profile essentials', completedSteps: 1, totalSteps: 5,
    reasons: ['Profile requires date of birth.'],
  }))
  const checklist = (id: string) => ({
    participantId: id, intakeComplete: true, profileComplete: false, serviceTypeConfirmed: false, serviceAgreementSigned: false, isReady: false,
    reasons: ['Profile requires date of birth.'],
  })
  const listRow = (p: FakeParticipant) => ({
    id: p.id, firstName: p.firstName, lastName: p.lastName, preferredName: null, fullName: name(p), maskedNdisNumber: null, ndisNumber: null, planType: 'SelfManaged',
    region: 'QLD', isRepeatClient: false, isActive: p.isActive, isDraft: p.isDraft, intakeCompletedAt: p.intakeCompletedAt, mobilityAidWheelchair: false,
    isHighSupport: false, supportRatio: 'SharedSupport', serviceStreams: 'None', hasActiveMedications: false,
  })
  // What both wizards read for one participant: the same shape as the wizards' own wire-test fixtures.
  const detail = (p: FakeParticipant) => ({
    ...listRow(p), phone: p.phone ?? '', email: p.email ?? '', preferredName: '', addressStreet: '', addressSuburb: '', addressState: '', addressPostcode: '',
    ndisNumber: '430000007', fundingSource: 'Ndis', mobilityAidWalker: false, isIntensiveSupport: false, overnightSupport: 'None', overnightRatio: 'OneToOne',
    requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false, requiresStandingMachine: false,
    hasRestrictivePracticeFlag: false, mobilitySupportOptions: [], otherDiagnoses: [], hidpaSupportCategories: 'None', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z', consents: [], healthConditions: [], adlAssessments: [], checklistItems: [], communityAccessRiskItems: [],
  })

  mockApiGet.mockImplementation(async (url: string, params?: Record<string, string>) => {
    calls.push(`GET ${url}`)
    if (url === '/inquiries') return enquiryFeed()
    if (url === '/inquiries/onboarding-worklist') return worklist()
    const checklistMatch = /^\/inquiries\/([^/]+)\/onboarding$/.exec(url)
    if (checklistMatch) return checklist(checklistMatch[1])
    if (url === '/participants') {
      const rows = participants.filter(p => (params?.isActive === undefined || String(p.isActive) === params.isActive) && (params?.isDraft === undefined || String(p.isDraft) === params.isDraft))
      return paged(rows.map(listRow))
    }
    const participantMatch = /^\/participants\/([^/]+)$/.exec(url)
    if (participantMatch && participantMatch[1] !== 'alerts') return detail(find(participantMatch[1]))
    return [] // alerts, contacts, risks, people, staff
  })

  // ParticipantInquiriesController.Convert: a draft participant, linked to the enquiry. Not on the Onboarding tab until its intake is complete.
  mockApiPost.mockImplementation(async (url: string) => {
    calls.push(`POST ${url}`)
    const convert = /^\/inquiries\/([^/]+)\/convert$/.exec(url)
    if (!convert) throw new Error(`unexpected POST ${url}`)
    const inquiry = inquiries.find(i => i.id === convert[1])!
    const participant: FakeParticipant = { id: 'p-ada', firstName: inquiry.firstName, lastName: inquiry.lastName, phone: inquiry.phone, email: null, isDraft: true, isActive: false, intakeCompletedAt: null }
    participants.push(participant)
    inquiry.participantId = participant.id
    return { ...inquiry, email: null, provenance: null, participantIsDraft: true, participantIsActive: false, participantIntakeCompletedAt: null }
  })

  // ParticipantsController.SaveIntake: completing stamps IntakeCompletedAt and never touches IsDraft or IsActive.
  mockApiPutRaw.mockImplementation(async (url: string, body: { completeIntake?: boolean }) => {
    calls.push(`PUT ${url}`)
    const intake = /^\/participants\/([^/]+)\/intake$/.exec(url)
    if (!intake) throw new Error(`unexpected PUT ${url}`)
    const participant = find(intake[1])
    if (body.completeIntake) participant.intakeCompletedAt ??= INTAKE_DONE_AT
    return { success: true, data: { id: participant.id, fullName: name(participant), isDraft: participant.isDraft, isActive: participant.isActive, intakeCompletedAt: participant.intakeCompletedAt } }
  })
  mockApiPatchRaw.mockImplementation(async (url: string) => {
    calls.push(`PATCH ${url}`)
    return { success: true, data: { id: url.split('/')[2] } }
  })

  // ParticipantsController.CompleteProfile / ChangeStatus / Restore: a draft is finalised only by complete-profile, which activates in Warn mode and
  // not in Enforce (no signed-agreement evidence exists). The status endpoint refuses a draft, and refuses activation under Enforce.
  mockApiPostRaw.mockImplementation(async (url: string, body: { isActive?: boolean }) => {
    calls.push(`POST ${url}`)
    const completeProfile = /^\/participants\/([^/]+)\/complete-profile$/.exec(url)
    if (completeProfile) {
      const participant = find(completeProfile[1])
      if (participant.isDraft) {
        if (!participant.intakeCompletedAt) throw httpError(400, "Complete the participant's intake before completing their profile.")
        participant.isDraft = false
        participant.isActive = mode === 'Warn'
      }
      return { success: true, data: { id: participant.id, fullName: name(participant), isDraft: participant.isDraft, isActive: participant.isActive, intakeCompletedAt: participant.intakeCompletedAt } }
    }
    const status = /^\/participants\/([^/]+)\/(status|restore)$/.exec(url)
    if (status) {
      const participant = find(status[1])
      if (participant.isDraft) throw httpError(400, 'A draft participant cannot be activated. Complete their intake and profile first.')
      if ((status[2] === 'restore' || body.isActive) && mode === 'Enforce') throw httpError(400, 'This participant cannot be activated until their signed service agreement evidence is recorded.')
      participant.isActive = status[2] === 'restore' ? true : !!body.isActive
      return { success: true, data: { id: participant.id, isActive: participant.isActive, isDraft: participant.isDraft, changed: true, warnings: [] } }
    }
    throw new Error(`unexpected POST ${url}`)
  })

  return { calls, participants }
}

function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/participants', element: <ParticipantsHubPage /> },
    { path: '/participants/:id/intake', element: <IntakeWizardPage /> },
    { path: '/participants/:id/profile', element: <ProfileWizardPage /> },
    { path: '/onboarding/:id', element: <OnboardingDetailPage /> },
    { path: '/participants/:id', element: <p>Participant detail</p> },
  ], { initialEntries: [path] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

const next = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^next$/i }))
const tab = (name: string) => screen.getByRole('tab', { name })
/** The table row for a name, once it is on screen: a tab's table is fetched when the tab opens, so it may not be there yet. */
const findRow = async (text: string) => (await screen.findByText(text)).closest('tr') as HTMLElement

/** Enquiries tab -> Start intake -> the Intake wizard, to the end: lands on the Onboarding tab. */
async function startAndCompleteIntake(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(await findRow('Ada Lovelace')).getByRole('button', { name: 'Start intake' }))
  await screen.findByDisplayValue('Ada')
  for (let i = 0; i < 8; i++) await next(user)
  await user.click(await screen.findByRole('button', { name: /complete intake/i }))
}

/** Onboarding tab -> the checklist -> Edit profile -> the Profile wizard, to the end. */
async function openChecklistAndCompleteProfile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Open onboarding for Ada Lovelace' }))
  await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 })
  await user.click(screen.getAllByRole('link', { name: 'Edit profile' })[0])
  await screen.findByRole('heading', { name: /profile/i })
  for (let i = 0; i < 6; i++) await next(user)
  await user.click(await screen.findByRole('button', { name: /complete profile/i }))
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
})

afterEach(() => {
  localStorage.clear()
  for (const mock of [mockApiGet, mockApiPost, mockApiPostRaw, mockApiPutRaw, mockApiPatchRaw]) mock.mockReset()
})

describe('Participants lifecycle (wire) — readiness in Warn mode', () => {
  it('takes an enquiry from the Enquiries tab, through intake, onboarding and the Profile wizard, to the Active participants tab', async () => {
    const server = createServer('Warn')
    const user = userEvent.setup()
    renderApp('/participants?tab=enquiries')

    // 1. Enquiries: the open enquiry, and the intake nobody enquired about. The finalised participant is not an enquiry.
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(await findRow('Ada Lovelace')).getByText('New')).toBeInTheDocument()
    expect(within(await findRow('Dana Direct')).getByText('Draft intake')).toBeInTheDocument()
    expect(within(await findRow('Dana Direct')).getByRole('button', { name: 'Resume intake' })).toBeInTheDocument()
    expect(screen.queryByText('Alex Active')).not.toBeInTheDocument()

    // 2. Start intake, then complete it in the wizard: the participant is on the Onboarding tab, with a one-off confirmation.
    await startAndCompleteIntake(user)
    expect(await screen.findByText('Intake complete — Ada Lovelace is now in onboarding.')).toBeInTheDocument()
    expect(tab('Onboarding')).toHaveAttribute('aria-selected', 'true')
    expect(within(await findRow('Ada Lovelace')).getByText('Validate profile essentials')).toBeInTheDocument()
    expect(server.calls).toContain('PUT /participants/p-ada/intake')

    // 3. Their enquiry has moved on: it is not an open enquiry any more, and they are not an active participant yet.
    await user.click(tab('Enquiries'))
    expect(await screen.findByText('Dana Direct')).toBeInTheDocument()
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    await user.click(tab('Active participants'))
    expect(await screen.findByText('Alex Active')).toBeInTheDocument()
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()

    // 4. Complete onboarding: the checklist, then the Profile wizard's Complete Profile. They land on the Active tab, confirmed and highlighted.
    await user.click(tab('Onboarding'))
    await openChecklistAndCompleteProfile(user)
    expect(await screen.findByText('Ada Lovelace is now an active participant.')).toBeInTheDocument()
    expect(tab('Active participants')).toHaveAttribute('aria-selected', 'true')
    expect(within(await findRow('Ada Lovelace')).getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Alex Active')).toBeInTheDocument()
    // The finalising call is complete-profile with an empty body. A draft cannot be activated through the status endpoint, so it was never used.
    expect(mockApiPostRaw).toHaveBeenCalledWith('/participants/p-ada/complete-profile', {})
    expect(server.calls.filter(call => /\/(status|restore)$/.test(call))).toEqual([])

    // 5. And they have left Onboarding.
    await user.click(tab('Onboarding'))
    expect(await screen.findByText('No participants in onboarding')).toBeInTheDocument()
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
  }, 60_000)

  it('lists a draft intake nobody enquired about on the Enquiries tab, then on Onboarding once its intake is complete', async () => {
    createServer('Warn')
    const user = userEvent.setup()
    renderApp('/participants?tab=enquiries')

    await screen.findByText('Dana Direct')
    await user.click(within(await findRow('Dana Direct')).getByRole('button', { name: 'Resume intake' }))
    await screen.findByDisplayValue('Dana')
    for (let i = 0; i < 8; i++) await next(user)
    await user.click(await screen.findByRole('button', { name: /complete intake/i }))

    expect(await screen.findByText('Intake complete — Dana Direct is now in onboarding.')).toBeInTheDocument()
    expect(within(await findRow('Dana Direct')).getByText('Validate profile essentials')).toBeInTheDocument()
    // Their intake is done, so nothing of theirs is left on the Enquiries tab, and Ada's enquiry is still open there.
    await user.click(tab('Enquiries'))
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByText('Dana Direct')).not.toBeInTheDocument()
  }, 60_000)
})

describe('Participants lifecycle (wire) — readiness in Enforce mode', () => {
  it('finalises the participant on Complete Profile but does not activate them: no hand-off to the Active tab, and the server says why', async () => {
    createServer('Enforce')
    const user = userEvent.setup()
    const router = renderApp('/participants?tab=enquiries')
    await screen.findByText('Ada Lovelace')

    await startAndCompleteIntake(user)
    await screen.findByText('Intake complete — Ada Lovelace is now in onboarding.')
    await openChecklistAndCompleteProfile(user)

    // Not activated, so no hand-off to the Active tab: they stay on their own record.
    expect(await screen.findByText('Participant detail')).toBeInTheDocument()
    expect(mockApiPostRaw).toHaveBeenCalledWith('/participants/p-ada/complete-profile', {})

    // Finalised, so they have left Onboarding; not active, so they are not on the Active tab either.
    await router.navigate('/participants?tab=onboarding')
    expect(await screen.findByText('No participants in onboarding')).toBeInTheDocument()
    await user.click(tab('Active participants'))
    expect(await screen.findByText('Alex Active')).toBeInTheDocument()
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()

    // The Archived view lists every finalised participant who is not active, so nobody is lost. Restore reaches the same refusal as the status endpoint.
    await user.click(screen.getByRole('radio', { name: 'Archived' }))
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    await user.click(within(await findRow('Ada Lovelace')).getByRole('button', { name: 'Restore' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This participant cannot be activated until their signed service agreement evidence is recorded.')
  }, 60_000)
})
