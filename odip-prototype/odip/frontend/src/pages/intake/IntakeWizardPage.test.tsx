import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import IntakeWizardPage from './IntakeWizardPage'
import { fieldsForEntry } from '@/lib/documentMapping'
import {
  STEP_PARTICIPANT_DETAILS_FIELDS, STEP_NDIS_FUNDING_FIELDS, STEP_CONTACTS_FIELDS,
  STEP_CULTURAL_FIELDS, STEP_SUPPORT_FIELDS, STEP_MEDICAL_FIELDS, STEP_BEHAVIOUR_FIELDS, STEP_RISKS_FIELDS,
} from '@/lib/participantSchema'

const { mockCreateMutateAsync, mockUpdateMutateAsync, mockUseParticipant, mockUseContactRoles, mockUseRiskEntries } = vi.hoisted(() => ({
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockUseParticipant: vi.fn(),
  mockUseContactRoles: vi.fn(),
  mockUseRiskEntries: vi.fn(),
}))

// Only the API layer is mocked — FormField/Dropdown/Card are the real components, exercising the
// actual wizard step-gating/navigation/review wiring, same approach as the retired create-wizard's test suite.
vi.mock('@/api/hooks', () => ({
  useCreateParticipant: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false }),
  // PF-10.5 edit mode (resuming an existing Intake draft) — see the describe block below.
  useUpdateParticipant: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false }),
  useParticipant: mockUseParticipant,
  useParticipantContactRoles: mockUseContactRoles,
  useParticipantRiskEntries: mockUseRiskEntries,
  usePersons: () => ({
    data: [
      { id: 'person-1', firstName: 'Karen', lastName: 'Johnson', fullName: 'Karen Johnson', organisation: null, activeRoleCount: 0 },
    ],
  }),
}))

function renderIntakePage() {
  const router = createMemoryRouter(
    [
      { path: '/participants/new', element: <IntakeWizardPage /> },
      // "Save as draft" still lands on the detail page; "Complete Intake" now hands off to the
      // PF-10.4 Profile wizard route instead (see IntakeWizardPage.tsx's onSubmit).
      { path: '/participants/:id', element: <div>Participant detail</div> },
      { path: '/participants/:id/profile', element: <div>Profile wizard</div> },
      { path: '/participants', element: <div>Participants list</div> },
    ],
    { initialEntries: ['/participants/new'] },
  )
  return render(<RouterProvider router={router} />)
}

// PF-10.5 — resuming an existing draft at /participants/:id/intake.
function renderIntakePageEditMode(participant: Record<string, unknown>) {
  mockUseParticipant.mockReturnValue({ data: participant, isLoading: false })
  const router = createMemoryRouter(
    [
      { path: '/participants/:id/intake', element: <IntakeWizardPage /> },
      { path: '/participants/:id', element: <div>Participant detail</div> },
      { path: '/participants/:id/profile', element: <div>Profile wizard</div> },
    ],
    { initialEntries: [`/participants/${participant.id}/intake`] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockCreateMutateAsync.mockReset()
  mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'new-participant-1' } })
  mockUpdateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockResolvedValue({ success: true })
  mockUseParticipant.mockReset()
  mockUseParticipant.mockReturnValue({ data: undefined, isLoading: false })
  mockUseContactRoles.mockReset()
  mockUseContactRoles.mockReturnValue({ data: [] })
  mockUseRiskEntries.mockReset()
  mockUseRiskEntries.mockReturnValue({ data: [] })
})

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

describe('IntakeWizardPage — step gating and navigation', () => {
  it('renders the Participant Details step first, with no profile-only Identity fields', () => {
    renderIntakePage()
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument()
    // Profile-only Identity fields (PF-10.1) must never appear.
    expect(screen.queryByLabelText(/middle name/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^gender$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/place of birth/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/preferred staff/i)).not.toBeInTheDocument()
  })

  it('blocks Next on Participant Details until First/Last Name are filled, then advances', async () => {
    const user = userEvent.setup()
    renderIntakePage()
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(await screen.findByText(/first name is required/i)).toBeInTheDocument()
    await expectStep(/participant details/i)

    await fillNameAndAdvance(user)
  })

  it('walks every step to Review without further input (all other intake fields are optional)', async () => {
    const user = userEvent.setup()
    renderIntakePage()
    await fillNameAndAdvance(user)

    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/contacts/i)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/cultural considerations/i)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/support needs/i)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/medical summary/i)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/behaviour summary/i)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/risks & hazards/i)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/review/i)

    // Review lists every step's group card.
    expect(screen.getByRole('heading', { name: /participant details/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /ndis & funding/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /contacts/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /cultural considerations/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /support needs/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /medical summary/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /behaviour summary/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /risks & hazards/i })).toBeInTheDocument()
  })
})

describe('IntakeWizardPage — unsaved-changes guard (PP-5)', () => {
  it('warns before navigating away with unsaved changes, and proceeds once confirmed', async () => {
    const user = userEvent.setup()
    renderIntakePage()
    await user.type(screen.getByLabelText(/first name/i), 'Jamie')

    const backLink = screen.getAllByRole('link').find((el) => el.getAttribute('href') === '/participants')
    expect(backLink).toBeTruthy()
    await user.click(backLink!)

    expect(await screen.findByText(/leave without saving/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /leave page/i }))

    await screen.findByText('Participants list')
  })

  it('does not warn when navigating away with no changes made', async () => {
    const user = userEvent.setup()
    renderIntakePage()

    const backLink = screen.getAllByRole('link').find((el) => el.getAttribute('href') === '/participants')
    await user.click(backLink!)

    expect(screen.queryByText(/leave without saving/i)).not.toBeInTheDocument()
    await screen.findByText('Participants list')
  })
})

describe('IntakeWizardPage — completion and draft-save', () => {
  async function walkToReview(user: ReturnType<typeof userEvent.setup>) {
    await fillNameAndAdvance(user)
    // From NDIS & Funding, 7 more Next clicks reach Review: contacts, cultural, support, medical,
    // behaviour, risks, then the shell's own review pseudo-step.
    for (let i = 0; i < 7; i++) {
      await user.click(screen.getByRole('button', { name: /^next$/i }))
    }
    await expectStep(/review/i)
  }

  it('completing intake POSTs isDraft=true and completeIntake=true, then hands off to the Profile wizard route', async () => {
    const user = userEvent.setup()
    renderIntakePage()
    await walkToReview(user)

    await user.click(screen.getByRole('button', { name: /complete intake/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload.isDraft).toBe(true)
    expect(payload.completeIntake).toBe(true)
    expect(payload.firstName).toBe('Jamie')
    expect(payload.lastName).toBe('Rivers')

    // PF-10.4: the Profile wizard now exists — "Complete Intake" hands off there directly,
    // carrying the new participant's id.
    expect(await screen.findByText(/profile wizard/i)).toBeInTheDocument()
  })

  it('"Save as draft" POSTs isDraft=true and completeIntake=false from any step, and routes to the detail page', async () => {
    const user = userEvent.setup()
    renderIntakePage()
    await user.type(screen.getByLabelText(/first name/i), 'Jamie')

    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload.isDraft).toBe(true)
    expect(payload.completeIntake).toBe(false)

    expect(await screen.findByText(/participant detail/i)).toBeInTheDocument()
  })
})

describe('IntakeWizardPage — drift guard against the PF-10.1 field-allocation contract', () => {
  it('every fieldsForEntry("intake") field is covered by exactly one wizard step, with no overlap and no Profile-only field included', () => {
    const stepGroups = [
      STEP_PARTICIPANT_DETAILS_FIELDS, STEP_NDIS_FUNDING_FIELDS, STEP_CONTACTS_FIELDS,
      STEP_CULTURAL_FIELDS, STEP_SUPPORT_FIELDS, STEP_MEDICAL_FIELDS, STEP_BEHAVIOUR_FIELDS, STEP_RISKS_FIELDS,
    ]
    const unioned = stepGroups.flat()
    const intakeFields = fieldsForEntry('intake').map((e) => e.field)

    // No duplicates across steps.
    expect(new Set(unioned).size).toBe(unioned.length)
    // Exact set equality with the contract — no missing field, no extra (Profile-only) field.
    expect(new Set(unioned)).toEqual(new Set(intakeFields))

    const profileFields = new Set(fieldsForEntry('profile').map((e) => e.field))
    for (const field of unioned) {
      expect(profileFields.has(field)).toBe(false)
    }
  })

  // Fields never rendered on the wizard's default path — gated by a Living Arrangement selection
  // (Family/Independent/SupportedAccommodation, default '') or by fundingSource === 'Other'
  // (default 'Ndis') — exercised individually in the two tests below instead.
  const LIVING_ARRANGEMENT_GATED_FIELDS = new Set([
    'mainSupportPersonName', 'mainSupportPersonRelationship', 'othersLivingInAccommodation', 'residentialInfo',
    'livesWithOthers', 'whoLivesWith', 'silProviderName', 'silProviderContactPhone', 'accommodationType',
    'onSiteSupportHours', 'livingArrangementNotes',
  ])
  const FUNDING_OTHER_GATED_FIELDS = new Set(['fundingOrganisation'])
  // overnightRatio only renders once Overnight Support isn't "None" (the default) — exercised in
  // its own small test below, same shape as the fundingOrganisation gate.
  const OVERNIGHT_GATED_FIELDS = new Set(['overnightRatio'])
  // Fields captured via a repeatable/grid/multi-checkbox control (no single element keyed by the
  // bare field name itself) — verified instead by their step's presence in the walk-through test
  // above, or (serviceStreams) by its individual checkboxes' own accessible names.
  const COLLECTION_FIELDS = new Set(['contactRoles', 'riskEntries', 'serviceStreams'])
  // Tri-state Yes/No/Not-recorded fields render via a Controller-driven ToggleGroup
  // (role="radiogroup", no id attribute — see ToggleGroup.tsx) rather than a plain registered
  // input, so they're verified by their radiogroup's accessible name (the visible FormField
  // label every one of them renders) instead of an element id.
  const RADIOGROUP_FIELD_LABELS: Record<string, RegExp> = {
    isCald: /Culturally and Linguistically Diverse/i,
    isLgbtqi: /LGBTIQA\+/i,
    isFamilyCommunity: /Family \/ Community/i,
    isAboriginalOrTorresStraitIslander: /Aboriginal and\/or Torres Strait Islander/i,
    receivedRightsAndResponsibilitiesInfo: /Rights and Responsibilities/i,
    receivedPrivacyAndConfidentialityInfo: /Privacy and Confidentiality/i,
    receivedFeedbackInfo: /Feedback Information and Form/i,
    receivedBeingSafeInfo: /Being Safe Information/i,
    receivedAdvocacyInfo: /Advocacy Information/i,
    behavioursOfConcernCurrent: /Behaviours of Concern \(Current\)/i,
    behavioursOfConcernFiveYearHistory: /Behaviours of Concern \(5-Year History\)/i,
  }

  it('renders a DOM element (or accessible radiogroup) for every always-visible scalar Intake field on the default path, and none for any Profile-only field', async () => {
    const user = userEvent.setup()
    renderIntakePage()

    const profileFields = fieldsForEntry('profile').map((e) => e.field)
    const alwaysVisibleIntakeFields = fieldsForEntry('intake').map((e) => e.field).filter((f) =>
      !COLLECTION_FIELDS.has(f) && !LIVING_ARRANGEMENT_GATED_FIELDS.has(f)
      && !FUNDING_OTHER_GATED_FIELDS.has(f) && !OVERNIGHT_GATED_FIELDS.has(f)
      && !(f in RADIOGROUP_FIELD_LABELS)
    )

    const seenIds = new Set<string>()
    const seenRadiogroupNames: string[] = []
    const stepCount = 8
    for (let i = 0; i < stepCount; i++) {
      document.querySelectorAll('[id]').forEach((el) => seenIds.add(el.id))
      screen.queryAllByRole('radiogroup').forEach((el) => {
        const name = el.getAttribute('aria-label')
        if (name) seenRadiogroupNames.push(name)
      })
      if (i === 0) {
        await user.type(screen.getByLabelText(/first name/i), 'Jamie')
        await user.type(screen.getByLabelText(/last name/i), 'Rivers')
      }
      if (i < stepCount - 1) {
        await user.click(screen.getByRole('button', { name: /^next$/i }))
      }
    }
    document.querySelectorAll('[id]').forEach((el) => seenIds.add(el.id))
    screen.queryAllByRole('radiogroup').forEach((el) => {
      const name = el.getAttribute('aria-label')
      if (name) seenRadiogroupNames.push(name)
    })

    const missing = alwaysVisibleIntakeFields.filter((f) => !seenIds.has(f))
    expect(missing).toEqual([])
    for (const field of profileFields) {
      expect(seenIds.has(field)).toBe(false)
    }
    for (const [field, labelPattern] of Object.entries(RADIOGROUP_FIELD_LABELS)) {
      const matched = seenRadiogroupNames.some((name) => labelPattern.test(name))
      expect({ field, matched }).toEqual({ field, matched: true })
    }
  })

  it('renders overnightRatio once Overnight Support is switched away from None', async () => {
    const user = userEvent.setup()
    renderIntakePage()
    await user.type(screen.getByLabelText(/first name/i), 'Jamie')
    await user.type(screen.getByLabelText(/last name/i), 'Rivers')
    await user.click(screen.getByRole('button', { name: /^next$/i })) // -> NDIS & Funding

    expect(document.getElementById('overnightRatio')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^next$/i })) // -> Contacts
    await user.click(screen.getByRole('button', { name: /^next$/i })) // -> Cultural Considerations
    await user.click(screen.getByRole('button', { name: /^next$/i })) // -> Support Needs
    await expectStep(/support needs/i)
    await user.click(document.getElementById('overnightSupport') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Active Night' }))
    expect(document.getElementById('overnightRatio')).not.toBeNull()
  })

  it('renders every Living-Arrangement-gated field once its arrangement type is selected', async () => {
    const user = userEvent.setup()
    renderIntakePage()

    // Both addressState and livingArrangement default to visible text "Not specified" — select
    // by the Dropdown's own trigger element id (set directly on the button) rather than by name.
    await user.click(document.getElementById('livingArrangement') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Family' }))
    expect(document.getElementById('mainSupportPersonName')).not.toBeNull()
    expect(document.getElementById('mainSupportPersonRelationship')).not.toBeNull()
    expect(document.getElementById('othersLivingInAccommodation')).not.toBeNull()
    expect(document.getElementById('residentialInfo')).not.toBeNull()
    expect(document.getElementById('livingArrangementNotes')).not.toBeNull()

    await user.click(document.getElementById('livingArrangement') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Independent' }))
    expect(document.getElementById('livesWithOthers')).not.toBeNull()
    await user.click(document.getElementById('livesWithOthers') as HTMLElement)
    expect(document.getElementById('whoLivesWith')).not.toBeNull()

    await user.click(document.getElementById('livingArrangement') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Supported Accommodation' }))
    expect(document.getElementById('silProviderName')).not.toBeNull()
    expect(document.getElementById('silProviderContactPhone')).not.toBeNull()
    expect(document.getElementById('accommodationType')).not.toBeNull()
    expect(document.getElementById('onSiteSupportHours')).not.toBeNull()
  })

  it('renders fundingOrganisation once Funding Source is switched to Other', async () => {
    const user = userEvent.setup()
    renderIntakePage()
    await user.type(screen.getByLabelText(/first name/i), 'Jamie')
    await user.type(screen.getByLabelText(/last name/i), 'Rivers')
    await user.click(screen.getByRole('button', { name: /^next$/i })) // -> NDIS & Funding

    expect(document.getElementById('fundingOrganisation')).toBeNull()
    await user.click(document.getElementById('fundingSource') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Other' }))
    expect(document.getElementById('fundingOrganisation')).not.toBeNull()
  })
})

// SPEC-05 PF-10.5 — resuming an existing draft (IntakeCompletedAt still null) at
// /participants/:id/intake, routed there by the detail page's three-way resume banner.
describe('IntakeWizardPage — PF-10.5 edit mode (resuming an existing Intake draft)', () => {
  function makeDraftParticipant(overrides: Record<string, unknown> = {}) {
    return {
      id: 'draft-1', firstName: 'Jamie', lastName: 'Rivers', isDraft: true, intakeCompletedAt: null,
      ndisNumber: 'NDIS-777', planType: 'SelfManaged', fundingSource: 'Ndis', isRepeatClient: false,
      serviceStreams: '', mobilityAidWheelchair: false, mobilityAidWalker: false, isHighSupport: false,
      isIntensiveSupport: false, overnightSupport: 'None', overnightRatio: 'OneToOne',
      requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
      requiresStandingMachine: false, supportRatio: 'SharedSupport',
      ...overrides,
    }
  }

  async function walkToReviewEditMode(user: ReturnType<typeof userEvent.setup>) {
    await expectStep(/participant details/i)
    // Every required field (firstName/lastName) is already hydrated — no typing needed.
    for (let i = 0; i < 8; i++) {
      await user.click(screen.getByRole('button', { name: /^next$/i }))
    }
    await expectStep(/review/i)
  }

  it('hydrates Intake-owned fields from the existing draft row instead of starting blank', () => {
    renderIntakePageEditMode(makeDraftParticipant())
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Jamie')
    expect(screen.getByLabelText(/last name/i)).toHaveValue('Rivers')
  })

  it('shows a heading of "Resume Intake" rather than "Intake" when editing an existing draft', () => {
    renderIntakePageEditMode(makeDraftParticipant())
    expect(screen.getByRole('heading', { name: /resume intake/i })).toBeInTheDocument()
  })

  it('completing a resumed Intake PUTs isDraft=true and completeIntake=true (never a second POST), strips riskEntries/contactRoles, and hands off to the Profile wizard', async () => {
    const user = userEvent.setup()
    renderIntakePageEditMode(makeDraftParticipant())
    await walkToReviewEditMode(user)

    await user.click(screen.getByRole('button', { name: /complete intake/i }))

    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const { id, data } = mockUpdateMutateAsync.mock.calls[0][0]
    expect(id).toBe('draft-1')
    expect(data.isDraft).toBe(true)
    expect(data.completeIntake).toBe(true)
    expect(data).not.toHaveProperty('riskEntries')
    expect(data).not.toHaveProperty('contactRoles')

    expect(await screen.findByText(/profile wizard/i)).toBeInTheDocument()
  })

  it('"Save as draft" on a resumed Intake PUTs isDraft=true and completeIntake=false, and routes to the detail page', async () => {
    const user = userEvent.setup()
    renderIntakePageEditMode(makeDraftParticipant())

    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const { id, data } = mockUpdateMutateAsync.mock.calls[0][0]
    expect(id).toBe('draft-1')
    expect(data.isDraft).toBe(true)
    expect(data.completeIntake).toBe(false)

    expect(await screen.findByText(/participant detail/i)).toBeInTheDocument()
  })

  it('surfaces already-recorded contacts/risk entries read-only rather than re-editable rows', async () => {
    const user = userEvent.setup()
    mockUseContactRoles.mockReturnValue({ data: [{ id: 'role-1', personFullName: 'Karen Johnson', roleType: 'NextOfKin' }] })
    mockUseRiskEntries.mockReturnValue({ data: [{ id: 'risk-1', description: 'Uneven pathway at entry' }] })
    renderIntakePageEditMode(makeDraftParticipant())

    await user.click(screen.getByRole('button', { name: /^next$/i })) // -> NDIS & Funding
    await user.click(screen.getByRole('button', { name: /^next$/i })) // -> Contacts
    expect(screen.getByText(/Karen Johnson/i)).toBeInTheDocument()
    expect(screen.getByText(/already recorded/i)).toBeInTheDocument()

    for (let i = 0; i < 5; i++) await user.click(screen.getByRole('button', { name: /^next$/i })) // -> Risks
    expect(screen.getByText(/Uneven pathway at entry/i)).toBeInTheDocument()
  })
})
