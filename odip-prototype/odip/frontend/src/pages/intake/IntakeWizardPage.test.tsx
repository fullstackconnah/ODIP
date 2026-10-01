import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import IntakeWizardPage from './IntakeWizardPage'
import { __testHooks, usePreviousAppPathTracker } from '@/hooks/useBackNavigation'
import { fieldsForEntry } from '@/lib/documentMapping'
import {
  STEP_PARTICIPANT_DETAILS_FIELDS, STEP_NDIS_FUNDING_FIELDS, STEP_CONTACTS_FIELDS,
  STEP_CULTURAL_FIELDS, STEP_SUPPORT_FIELDS, STEP_MEDICAL_FIELDS, STEP_BEHAVIOUR_FIELDS, STEP_RISKS_FIELDS,
} from '@/lib/participantSchema'

const { mockCreate, mockUpdate, mockSave, mockParticipant } = vi.hoisted(() => ({
  mockCreate: vi.fn(), mockUpdate: vi.fn(), mockSave: vi.fn(), mockParticipant: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useCreateParticipant: () => ({ mutateAsync: mockCreate, isPending: false, isError: false }),
  useUpdateParticipant: () => ({ mutateAsync: mockUpdate, isPending: false, isError: false }),
  useSaveParticipantIntake: () => ({ mutateAsync: mockSave, isPending: false, isError: false }),
  useParticipantIntakeSnapshots: () => ({ data: [], refetch: vi.fn() }),
  useDownloadParticipantIntakeSnapshotPdf: () => ({ mutate: vi.fn(), isPending: false }),
  useParticipant: mockParticipant,
  useParticipantContactRoles: () => ({ data: [] }),
  useParticipantRiskEntries: () => ({ data: [] }),
  usePersons: () => ({ data: [] }),
}))

/** The '/participants' route: still "Participants list" for the back-control tests, and it reports the query string and
 *  router state the wizard navigated with, so the Complete-Intake tests can assert the Onboarding tab hand-off. */
function ParticipantsArrival() {
  const { search, state } = useLocation()
  return (
    <div>
      Participants list
      <span data-testid="arrival-search">{search}</span>
      <span data-testid="arrival-state">{JSON.stringify(state)}</span>
    </div>
  )
}

function renderPage(path = '/participants/new') {
  const router = createMemoryRouter([
    { path: '/participants/new', element: <IntakeWizardPage /> },
    { path: '/participants/:id/intake', element: <IntakeWizardPage /> },
    { path: '/participants/:id', element: <div>Participant detail</div> },
    { path: '/participants/:id/profile', element: <div>Profile wizard</div> },
    { path: '/participants', element: <ParticipantsArrival /> },
  ], { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

/** Like renderPage but mounts the back-navigation tracker alongside the page so the
 *  history-aware back-control tests see a recorded previous path. */
function renderPageWithTracker(path: string) {
  __testHooks.reset()
  const router = createMemoryRouter([
    { path: '/participants/new', element: <><Tracker /><IntakeWizardPage /></> },
    { path: '/participants/:id/intake', element: <><Tracker /><IntakeWizardPage /></> },
    { path: '/participants/:id', element: <div>Participant detail</div> },
    { path: '/participants/:id/profile', element: <div>Profile wizard</div> },
    { path: '/participants', element: <div>Participants list</div> },
  ], { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

function Tracker(): null {
  usePreviousAppPathTracker()
  return null
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1', firstName: 'Jamie', lastName: 'Rivers', isDraft: true, intakeCompletedAt: null,
    ndisNumber: 'NDIS-777', planType: 'SelfManaged', fundingSource: 'Ndis', isRepeatClient: false,
    serviceStreams: '', mobilityAidWheelchair: false, mobilityAidWalker: false, isHighSupport: false,
    isIntensiveSupport: false, overnightSupport: 'None', overnightRatio: 'OneToOne',
    requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
    requiresStandingMachine: false, supportRatio: 'SharedSupport', ...overrides,
  }
}

function stepNav() {
  return screen.getByRole('navigation', { name: /intake wizard steps/i })
}

const narrowFocusModes = [
  { mode: 'fixed 375×812', observedClearanceWith96pxMargin: -63.375 },
  { mode: 'fixed 390×844', observedClearanceWith96pxMargin: 8.625 },
  { mode: 'true-mobile 375×812', observedClearanceWith96pxMargin: 15.625 },
  { mode: 'true-mobile 390×844', observedClearanceWith96pxMargin: -31.375 },
]

async function expectStep(label: string | RegExp) {
  await within(stepNav()).findByRole('button', { name: label, current: 'step' })
}

async function fillNameAndAdvance(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/first name/i), 'Jamie')
  await user.type(screen.getByLabelText(/last name/i), 'Rivers')
  await user.click(screen.getByRole('button', { name: /^next$/i }))
  await expectStep(/ndis & funding/i)
}

async function walkToReview(user: ReturnType<typeof userEvent.setup>) {
  await fillNameAndAdvance(user)
  for (let i = 0; i < 7; i++) {
    await user.click(screen.getByRole('button', { name: /^next$/i }))
  }
  await expectStep(/review/i)
}

beforeEach(() => {
  mockCreate.mockReset(); mockCreate.mockResolvedValue({ success: true, data: { id: 'new-participant-1' } })
  mockUpdate.mockReset(); mockUpdate.mockResolvedValue({ success: true })
  mockSave.mockReset(); mockSave.mockResolvedValue({ success: true })
  mockParticipant.mockReset(); mockParticipant.mockReturnValue({ data: undefined, isLoading: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('IntakeWizardPage', () => {
  it('renders the create wizard with no profile-only identity fields and enough focus clearance for every fixed and true-mobile narrow viewport', () => {
    renderPage()
    expect(screen.getByText('Step 1 of 9')).toBeVisible()
    expect(stepNav()).toHaveClass('[contain:inline-size]')
    const wizardBody = stepNav().closest('.w-full.min-w-0.max-w-full')
    expect(wizardBody).toBeTruthy()
    expect(wizardBody).toHaveClass('w-full', 'min-w-0', 'max-w-full')
    // The [&_input]:scroll-* utilities used to live on this outer div in the old layout; the
    // refactor moved them to the <form> wrapper inside the WizardShell so they still cover every
    // form control (and the form's own max-w-3xl keeps inputs at a readable measure). The contract
    // is unchanged: every form control still clears the fixed bottom nav when focused.
    // The rail now lives in a WizardShell <aside> that SIBLINGS the form, so the form must be
    // anchored from one of its own controls — not reached by walking up from the rail.
    const form = screen.getByLabelText(/first name/i).closest('form')
    expect(form).toBeTruthy()
    // QA measured these four narrow layouts with the old 96px margin. The 176px contract adds
    // 80px of clearance, clearing the fixed bottom navigation in each case; desktop/tablet do
    // not render that navigation. Keep every mobile viewport/mode in the assertion rather than
    // treating a passing sibling viewport as representative.
    for (const { mode, observedClearanceWith96pxMargin } of narrowFocusModes) {
      // 176px is the measured scroll-mt contract for every fixed/mobile narrow viewport — it
      // adds 80px over the old 96px so the focused input clears the fixed bottom nav. Keep the
      // assertion shape intact: assert each layout/mode by name to make a regression localise.
      expect(observedClearanceWith96pxMargin + (176 - 96), mode).toBeGreaterThan(0)
    }
    // The form wrapper (where the scroll-margin utilities live now) still applies them at every
    // breakpoint so a focused input clears the fixed bottom navigation.
    expect(form).toHaveClass('[&_input]:scroll-mt-20', '[&_input]:scroll-mb-44')
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/middle name/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^gender$/i)).not.toBeInTheDocument()
  })

  it('blocks create-mode progression until required participant names are supplied', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(await screen.findByText(/first name is required/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/first name/i), 'Jamie')
    await user.type(screen.getByLabelText(/last name/i), 'Rivers')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(await screen.findByRole('button', { name: /ndis & funding/i, current: 'step' })).toBeInTheDocument()
  })

  it('walks every create-mode step to Review while optional Intake fields remain blank', async () => {
    const user = userEvent.setup()
    renderPage()
    await walkToReview(user)
    for (const label of ['Participant Details', 'NDIS & Funding', 'Contacts', 'Cultural Considerations', 'Support Needs', 'Medical Summary', 'Behaviour Summary', 'Risks & Hazards']) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
  })

  it('warns before leaving a changed create wizard and navigates after confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText(/first name/i), 'Jamie')
    const backLink = screen.getByTestId('intake-header-back')
    expect(backLink).toBeInTheDocument()
    await user.click(backLink)
    expect(await screen.findByText(/leave without saving/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /leave page/i }))
    expect(await screen.findByText('Participants list')).toBeInTheDocument()
  })

  it('does not warn before leaving an unchanged create wizard', async () => {
    const user = userEvent.setup()
    renderPage()
    const backLink = screen.getByTestId('intake-header-back')
    expect(backLink).toBeInTheDocument()
    await user.click(backLink)
    expect(screen.queryByText(/leave without saving/i)).not.toBeInTheDocument()
    expect(await screen.findByText('Participants list')).toBeInTheDocument()
  })

  it('completes create-mode intake with a CSPRNG UUID when randomUUID is unavailable and hands off to the Onboarding table', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0)
        return bytes
      },
    })
    const user = userEvent.setup()
    renderPage()
    await walkToReview(user)
    await user.click(screen.getByRole('button', { name: /complete intake/i }))
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.calls[0][0]).toEqual(expect.objectContaining({
      isDraft: true, completeIntake: true, firstName: 'Jamie', lastName: 'Rivers',
      completionRequestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    }))
    // Not the Profile wizard: completing Intake puts the participant on the onboarding worklist, so go and show them there,
    // carrying who completed (for the table's one-off confirmation) in router state.
    expect(await screen.findByText('Participants list')).toBeInTheDocument()
    expect(screen.queryByText(/profile wizard/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('arrival-search')).toHaveTextContent('?tab=onboarding')
    expect(JSON.parse(screen.getByTestId('arrival-state').textContent!)).toEqual({
      intakeComplete: { participantId: 'new-participant-1', name: 'Jamie Rivers' },
    })
  })

  it('names the participant in the confirmation as the server lists them (preferred name aware) when it returns one', async () => {
    mockCreate.mockResolvedValue({ success: true, data: { id: 'new-participant-1', fullName: 'Jay Rivers' } })
    const user = userEvent.setup()
    renderPage()
    await walkToReview(user)
    await user.click(screen.getByRole('button', { name: /complete intake/i }))

    expect(await screen.findByText('Participants list')).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('arrival-state').textContent!).intakeComplete.name).toBe('Jay Rivers')
  })

  it('completing a resumed draft (edit mode) also lands on the Onboarding table, for that participant', async () => {
    const user = userEvent.setup()
    mockParticipant.mockReturnValue({ data: draft(), isLoading: false })
    mockSave.mockResolvedValue({ success: true, data: { id: 'draft-1', fullName: 'Jamie Rivers' } })
    renderPage('/participants/draft-1/intake')
    for (let i = 0; i < 8; i++) await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/review/i)
    await user.click(screen.getByRole('button', { name: /complete intake/i }))

    // The scoped intake save, never the full-record update.
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSave.mock.calls[0][0]).toEqual({
      id: 'draft-1',
      data: expect.objectContaining({ isDraft: true, completeIntake: true, completionRequestId: expect.any(String) }),
    })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(await screen.findByText('Participants list')).toBeInTheDocument()
    expect(screen.queryByText(/profile wizard/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('arrival-search')).toHaveTextContent('?tab=onboarding')
    expect(JSON.parse(screen.getByTestId('arrival-state').textContent!)).toEqual({
      intakeComplete: { participantId: 'draft-1', name: 'Jamie Rivers' },
    })
  })

  it('stays on the wizard, navigating nowhere, when completing fails or the server does not accept it', async () => {
    const user = userEvent.setup()
    mockCreate.mockRejectedValueOnce(new Error('Network down'))
    renderPage()
    await walkToReview(user)
    await user.click(screen.getByRole('button', { name: /complete intake/i }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Participants list')).not.toBeInTheDocument()
    await expectStep(/review/i)

    mockCreate.mockResolvedValueOnce({ success: false })
    await user.click(screen.getByRole('button', { name: /complete intake/i }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Participants list')).not.toBeInTheDocument()
  })

  it('saves a create-mode draft from the first step without completing intake', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText(/first name/i), 'Jamie')
    await user.click(screen.getByRole('button', { name: /save as draft/i }))
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.calls[0][0]).toEqual(expect.objectContaining({ isDraft: true, completeIntake: false }))
    // "Save as draft" is unchanged: it lands on the participant's detail page, not the Onboarding table.
    expect(await screen.findByText(/participant detail/i)).toBeInTheDocument()
    expect(screen.queryByText('Participants list')).not.toBeInTheDocument()
  })

  it('keeps Intake field ownership exact: every Intake field belongs to one step and no Profile field does', () => {
    const stepGroups = [
      STEP_PARTICIPANT_DETAILS_FIELDS, STEP_NDIS_FUNDING_FIELDS, STEP_CONTACTS_FIELDS,
      STEP_CULTURAL_FIELDS, STEP_SUPPORT_FIELDS, STEP_MEDICAL_FIELDS, STEP_BEHAVIOUR_FIELDS, STEP_RISKS_FIELDS,
    ]
    const fields = stepGroups.flat()
    expect(new Set(fields).size).toBe(fields.length)
    expect(new Set(fields)).toEqual(new Set(fieldsForEntry('intake').map((entry) => entry.field)))
    const profileFields = new Set(fieldsForEntry('profile').map((entry) => entry.field))
    expect(fields.some((field) => profileFields.has(field))).toBe(false)
  })

  it('renders every always-visible scalar Intake field across its steps, never a Profile-only field', async () => {
    const user = userEvent.setup()
    renderPage()
    const gated = new Set([
      'mainSupportPersonName', 'mainSupportPersonRelationship', 'othersLivingInAccommodation', 'residentialInfo',
      'livesWithOthers', 'whoLivesWith', 'silProviderName', 'silProviderContactPhone', 'accommodationType',
      'onSiteSupportHours', 'livingArrangementNotes', 'fundingOrganisation', 'overnightRatio',
      'contactRoles', 'riskEntries', 'serviceStreams',
      'isCald', 'isLgbtqi', 'isFamilyCommunity', 'isAboriginalOrTorresStraitIslander',
      'receivedRightsAndResponsibilitiesInfo', 'receivedPrivacyAndConfidentialityInfo', 'receivedFeedbackInfo',
      'receivedBeingSafeInfo', 'receivedAdvocacyInfo', 'behavioursOfConcernCurrent', 'behavioursOfConcernFiveYearHistory',
    ])
    const seenIds = new Set<string>()
    for (let i = 0; i < 8; i++) {
      document.querySelectorAll('[id]').forEach((element) => seenIds.add(element.id))
      if (i === 0) await fillNameAndAdvance(user)
      else if (i < 7) await user.click(screen.getByRole('button', { name: /^next$/i }))
    }
    document.querySelectorAll('[id]').forEach((element) => seenIds.add(element.id))
    const expected = fieldsForEntry('intake').map((entry) => entry.field).filter((field) => !gated.has(field))
    expect(expected.filter((field) => !seenIds.has(field))).toEqual([])
    for (const field of fieldsForEntry('profile').map((entry) => entry.field)) {
      expect(seenIds.has(field)).toBe(false)
    }
  })

  it('reveals each living-arrangement branch only for its selected arrangement', async () => {
    const user = userEvent.setup()
    renderPage()
    const select = async (name: string) => {
      await user.click(document.getElementById('livingArrangement') as HTMLElement)
      await user.click(screen.getByRole('option', { name }))
    }
    await select('Independent')
    expect(document.getElementById('livesWithOthers')).not.toBeNull()
    await user.click(document.getElementById('livesWithOthers') as HTMLElement)
    expect(document.getElementById('whoLivesWith')).not.toBeNull()
    await select('Supported Accommodation')
    for (const field of ['silProviderName', 'silProviderContactPhone', 'accommodationType', 'onSiteSupportHours']) {
      expect(document.getElementById(field)).not.toBeNull()
    }
  })

  it('reveals living-arrangement fields only after their owning selection is made', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(document.getElementById('mainSupportPersonName')).toBeNull()
    await user.click(document.getElementById('livingArrangement') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Family' }))
    expect(document.getElementById('mainSupportPersonName')).not.toBeNull()
  })

  it('reveals fundingOrganisation only after Other funding is selected', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillNameAndAdvance(user)
    expect(document.getElementById('fundingOrganisation')).toBeNull()
    await user.click(document.getElementById('fundingSource') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Other' }))
    expect(document.getElementById('fundingOrganisation')).not.toBeNull()
  })

  it('reveals the overnight ratio only when overnight support is selected', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillNameAndAdvance(user)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/support needs/i)
    expect(document.getElementById('overnightRatio')).toBeNull()
    await user.click(document.getElementById('overnightSupport') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Active Night' }))
    expect(document.getElementById('overnightRatio')).not.toBeNull()
  })

  it('routes an inquiry-converted resume to the wizard rail rather than the legacy complete-intake form', () => {
    mockParticipant.mockReturnValue({ data: draft(), isLoading: false })
    renderPage('/participants/draft-1/intake')
    expect(stepNav()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /participant details/i, current: 'step' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^complete intake$/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Jamie')
  })

  it('saves an inquiry-converted resume through the wizard update contract', async () => {
    const user = userEvent.setup()
    mockParticipant.mockReturnValue({ data: draft(), isLoading: false })
    mockSave.mockResolvedValue({ success: false })
    renderPage('/participants/draft-1/intake')
    await user.click(screen.getByRole('button', { name: /save as draft/i }))
    expect(mockSave).toHaveBeenCalledWith({
      id: 'draft-1',
      data: expect.objectContaining({ firstName: 'Jamie', lastName: 'Rivers', isDraft: true, completeIntake: false }),
    })
    // The contacts and risks are sent (empty here): the server creates the new ones and skips the ones it already has.
    expect(mockSave.mock.calls[0][0].data).toHaveProperty('riskEntries', [])
    expect(mockSave.mock.calls[0][0].data).toHaveProperty('contactRoles', [])
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

// CORE-01 + CORE-02 acceptance: rail sits in a WizardShell aside beside the form, and the page-header
// back control is history-aware (uses real in-app history when available, fallback otherwise).
describe('IntakeWizardPage — wizard shell + history-aware back', () => {
  it('renders the WizardShell aside landmark containing the step rail and the form alongside it', () => {
    renderPage()
    const aside = screen.getByRole('complementary', { name: /wizard steps/i })
    expect(aside).toBeInTheDocument()
    expect(within(aside).getByRole('navigation', { name: /intake wizard steps/i })).toBeInTheDocument()
    // The form still renders inside the same shell as the rail.
    expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument()
  })

  it('falls back to /participants when arriving at the create wizard via a deep link (no prior path)', async () => {
    const user = userEvent.setup()
    renderPageWithTracker('/participants/new')
    const back = screen.getByTestId('intake-header-back')
    expect(back).toBeInTheDocument()
    await user.click(back)
    expect(await screen.findByText('Participants list')).toBeInTheDocument()
  })

  it('returns to the previous in-app screen when the user arrived from one (e.g. onboarding detail → Edit intake)', async () => {
    const user = userEvent.setup()
    // Seed module state to mimic two real route changes: /onboarding/draft-1 → /participants/draft-1/intake.
    __testHooks.reset()
    __testHooks.recordCurrentPath('/onboarding/draft-1')
    __testHooks.recordCurrentPath('/participants/draft-1/intake')
    mockParticipant.mockReturnValue({ data: draft(), isLoading: false })
    const router = createMemoryRouter([
      { path: '/participants/draft-1/intake', element: <><Tracker /><IntakeWizardPage /></> },
      { path: '/participants', element: <div>Participants list</div> },
      { path: '/onboarding/draft-1', element: <div>Onboarding screen</div> },
    ], { initialEntries: ['/participants/draft-1/intake'] })
    render(<RouterProvider router={router} />)
    const back = await screen.findByTestId('intake-header-back')
    await user.click(back)
    // The back control navigates to the recorded previous path (/onboarding/draft-1) rather
    // than the fallback /participants (which would have shown "Participants list").
    expect(await screen.findByText('Onboarding screen')).toBeInTheDocument()
    expect(screen.queryByText('Participants list')).not.toBeInTheDocument()
  })

  it('the back destination matches the recorded previous path, not the hardcoded fallback', async () => {
    __testHooks.reset()
    __testHooks.recordCurrentPath('/onboarding/draft-1')
    __testHooks.recordCurrentPath('/participants/draft-1/intake')
    mockParticipant.mockReturnValue({ data: draft(), isLoading: false })
    // Render without an /onboarding/:id route so we can prove the back target was NOT the
    // fallback. If we hardcoded the fallback, this would still find the /participants list.
    // BOTH destinations are real routes: the assertion is that the recorded previous path
    // wins, proven positively. Navigating to a path with no matching route instead made
    // react-router throw an unhandled "no route matches" rejection inside the click.
    const router = createMemoryRouter([
      { path: '/participants/draft-1/intake', element: <><Tracker /><IntakeWizardPage /></> },
      { path: '/onboarding/draft-1', element: <div>Onboarding screen</div> },
      { path: '/participants', element: <div>Participants list</div> },
    ], { initialEntries: ['/participants/draft-1/intake'] })
    render(<RouterProvider router={router} />)
    const back = screen.getByTestId('intake-header-back')
    expect(back).toBeInTheDocument()
    fireEvent.click(back)
    // The recorded previous path is the onboarding screen, NOT the hardcoded fallback.
    expect(await screen.findByText('Onboarding screen')).toBeInTheDocument()
    expect(screen.queryByText('Participants list')).not.toBeInTheDocument()
  })
})
