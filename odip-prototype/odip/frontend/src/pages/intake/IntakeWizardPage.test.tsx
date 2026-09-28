import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import IntakeWizardPage from './IntakeWizardPage'
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

function renderPage(path = '/participants/new') {
  const router = createMemoryRouter([
    { path: '/participants/new', element: <IntakeWizardPage /> },
    { path: '/participants/:id/intake', element: <IntakeWizardPage /> },
    { path: '/participants/:id', element: <div>Participant detail</div> },
    { path: '/participants/:id/profile', element: <div>Profile wizard</div> },
    { path: '/participants', element: <div>Participants list</div> },
  ], { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
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
  it('renders the create wizard with no profile-only identity fields', () => {
    renderPage()
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
    const backLink = screen.getAllByRole('link').find((el) => el.getAttribute('href') === '/participants')
    expect(backLink).toBeTruthy()
    await user.click(backLink!)
    expect(await screen.findByText(/leave without saving/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /leave page/i }))
    expect(await screen.findByText('Participants list')).toBeInTheDocument()
  })

  it('does not warn before leaving an unchanged create wizard', async () => {
    const user = userEvent.setup()
    renderPage()
    const backLink = screen.getAllByRole('link').find((el) => el.getAttribute('href') === '/participants')
    expect(backLink).toBeTruthy()
    await user.click(backLink!)
    expect(screen.queryByText(/leave without saving/i)).not.toBeInTheDocument()
    expect(await screen.findByText('Participants list')).toBeInTheDocument()
  })

  it('completes create-mode intake with a CSPRNG UUID when randomUUID is unavailable and hands off to Profile', async () => {
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
    expect(await screen.findByText(/profile wizard/i)).toBeInTheDocument()
  })

  it('saves a create-mode draft from the first step without completing intake', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText(/first name/i), 'Jamie')
    await user.click(screen.getByRole('button', { name: /save as draft/i }))
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.calls[0][0]).toEqual(expect.objectContaining({ isDraft: true, completeIntake: false }))
    expect(await screen.findByText(/participant detail/i)).toBeInTheDocument()
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

  it('routes an inquiry-converted edit mode to the narrowed form with its required hooks mocked', () => {
    mockParticipant.mockReturnValue({ data: draft(), isLoading: false })
    renderPage('/participants/draft-1/intake')
    expect(screen.getByRole('heading', { name: /^complete intake$/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Jamie')
    expect(screen.getByLabelText(/primary diagnosis/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/ndis number/i)).toBeInTheDocument()
  })

  it('saves an inquiry-converted edit through the narrowed endpoint, never a full profile update', async () => {
    const user = userEvent.setup()
    mockParticipant.mockReturnValue({ data: draft(), isLoading: false })
    renderPage('/participants/draft-1/intake')
    await user.clear(screen.getByLabelText(/medical summary/i))
    await user.type(screen.getByLabelText(/medical summary/i), 'Synthetic update')
    await user.click(screen.getByRole('button', { name: /save incomplete intake/i }))
    expect(mockSave).toHaveBeenCalledWith({
      id: 'draft-1',
      data: expect.objectContaining({ firstName: 'Jamie', lastName: 'Rivers', medicalSummary: 'Synthetic update' }),
    })
    expect(mockSave.mock.calls[0][0].data).not.toHaveProperty('isActive')
    expect(mockSave.mock.calls[0][0].data).toHaveProperty('ndisNumber')
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
