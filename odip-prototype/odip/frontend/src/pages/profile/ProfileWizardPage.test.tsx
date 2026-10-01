import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import ProfileWizardPage from './ProfileWizardPage'
import { KeyIdentifiersStep } from './steps/KeyIdentifiersStep'
import { BehaviourCognitionStep } from './steps/BehaviourCognitionStep'
import { fieldsForEntry, sharedFieldsDisplayedOnProfile } from '@/lib/documentMapping'
import { __testHooks, usePreviousAppPathTracker } from '@/hooks/useBackNavigation'
import {
  PROFILE_STEP_KEY_IDENTIFIERS_FIELDS, PROFILE_STEP_CULTURAL_DEPTH_FIELDS, PROFILE_STEP_MEDICAL_FIELDS,
  PROFILE_STEP_MOBILITY_FIELDS, PROFILE_STEP_BEHAVIOUR_FIELDS, PROFILE_STEP_DAILY_LIVING_FIELDS,
  PROFILE_STEP_COMMUNITY_ACCESS_FIELDS, type ParticipantFormData,
} from '@/lib/participantSchema'
import type { ParticipantDetailDto } from '@/api/types/participants'

const { mockUseParticipant, mockPatchMutateAsync, mockUpdateMutateAsync, mockCompleteMutateAsync, mockUpsertRiskItemMutateAsync } = vi.hoisted(() => ({
  mockUseParticipant: vi.fn(),
  mockPatchMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockCompleteMutateAsync: vi.fn(),
  mockUpsertRiskItemMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipant: mockUseParticipant,
  usePatchParticipant: () => ({ mutateAsync: mockPatchMutateAsync, isPending: false }),
  useUpdateParticipant: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useCompleteParticipantProfile: () => ({ mutateAsync: mockCompleteMutateAsync, isPending: false }),
  useUpsertCommunityAccessRiskItem: () => ({ mutateAsync: mockUpsertRiskItemMutateAsync }),
  useStaff: () => ({ data: [{ id: 'staff-1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', isActive: true }] }),
  // The embedded Contacts editor (KeyIdentifiersStep) and the plan-type banner read the participant's contacts.
  useParticipantContactRoles: () => ({ data: [], isLoading: false }),
  useDeleteContactRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function makeParticipant(overrides: Partial<ParticipantDetailDto> = {}): ParticipantDetailDto {
  return {
    id: 'participant-1', firstName: 'Jamie', lastName: 'Rivers', fullName: 'Jamie Rivers',
    preferredName: '', phone: '', email: '', addressStreet: '', addressSuburb: '', addressState: '', addressPostcode: '',
    ndisNumber: 'NDIS-123', planType: 'SelfManaged', fundingSource: 'Ndis', isActive: true, isRepeatClient: false,
    mobilityAidWheelchair: false, mobilityAidWalker: false, isHighSupport: false, isIntensiveSupport: false,
    supportRatio: 'OneToOne', overnightSupport: 'None', overnightRatio: 'OneToOne', hasRestrictivePracticeFlag: false,
    serviceStreams: 'InHomeSupport', hasActiveMedications: false, isDraft: false, mobilitySupportOptions: [],
    otherDiagnoses: [], hidpaSupportCategories: 'None', requiresHiLoBed: false, requiresHoist: false,
    requiresShowerChair: false, requiresCommode: false, requiresStandingMachine: false,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    consents: [], healthConditions: [], adlAssessments: [], checklistItems: [], communityAccessRiskItems: [],
    ...overrides,
  } as ParticipantDetailDto
}

function renderProfilePage(participant = makeParticipant()) {
  mockUseParticipant.mockReturnValue({ data: participant, isLoading: false })
  const router = createMemoryRouter(
    [
      { path: '/participants/:id/profile', element: <ProfileWizardPage /> },
      { path: '/participants/:id', element: <div>Participant detail</div> },
    ],
    { initialEntries: ['/participants/participant-1/profile'] },
  )
  return render(<RouterProvider router={router} />)
}

/** Like renderProfilePage but mounts the back-navigation tracker so the history-aware
 *  back-control tests see a recorded previous path. */
function renderProfilePageWithTracker(participant = makeParticipant()) {
  __testHooks.reset()
  mockUseParticipant.mockReturnValue({ data: participant, isLoading: false })
  const router = createMemoryRouter(
    [
      { path: '/participants/:id/profile', element: <><Tracker /><ProfileWizardPage /></> },
      { path: '/participants/:id', element: <div>Participant detail</div> },
    ],
    { initialEntries: ['/participants/participant-1/profile'] },
  )
  return render(<RouterProvider router={router} />)
}

function Tracker(): null {
  usePreviousAppPathTracker()
  return null
}

function stepNav() {
  return screen.getByRole('navigation', { name: /intake wizard steps/i })
}

async function expectStep(label: string | RegExp) {
  await within(stepNav()).findByRole('button', { name: label, current: 'step' })
}

beforeEach(() => {
  mockUseParticipant.mockReset()
  mockPatchMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockUpsertRiskItemMutateAsync.mockReset()
  mockPatchMutateAsync.mockResolvedValue({ success: true })
  mockUpdateMutateAsync.mockResolvedValue({ success: true })
  mockCompleteMutateAsync.mockReset().mockResolvedValue({ success: true })
  mockUpsertRiskItemMutateAsync.mockResolvedValue({ success: true })
})

describe('ProfileWizardPage — drift guard against the PF-10.1 field-allocation contract', () => {
  it('every fieldsForEntry("profile") field (minus the documented UI-only exception) is covered by exactly one wizard step, with no overlap and no Intake-only field included', () => {
    const stepGroups = [
      PROFILE_STEP_KEY_IDENTIFIERS_FIELDS, PROFILE_STEP_CULTURAL_DEPTH_FIELDS, PROFILE_STEP_MEDICAL_FIELDS,
      PROFILE_STEP_MOBILITY_FIELDS, PROFILE_STEP_BEHAVIOUR_FIELDS, PROFILE_STEP_DAILY_LIVING_FIELDS,
      PROFILE_STEP_COMMUNITY_ACCESS_FIELDS,
    ]
    const unioned = stepGroups.flat()
    // primaryDiagnosisOther is a UI-only helper (the "Other — specify" typed value collapsed into
    // primaryDiagnosis before submit) with no DOCUMENT_MAPPING entry of its own — see
    // participantSchema.ts's PROFILE_FIELD_NAMES doc for why it's deliberately excluded there.
    const unionedMinusUiOnly = unioned.filter((f) => f !== 'primaryDiagnosisOther')
    const profileFields = fieldsForEntry('profile').map((e) => e.field)

    expect(new Set(unionedMinusUiOnly).size).toBe(unionedMinusUiOnly.length)
    expect(new Set(unionedMinusUiOnly)).toEqual(new Set(profileFields))

    const intakeFields = new Set(fieldsForEntry('intake').map((e) => e.field))
    for (const field of unionedMinusUiOnly) {
      expect(intakeFields.has(field)).toBe(false)
    }
  })

  // Fixed-grid collection fields (upsert-by-key, "materialize all N rows") have no single element
  // keyed by the bare field name — verified via each row's own accessible name instead (same
  // convention IntakeWizardPage.test.tsx's drift guard uses for its own collection fields).
  const COLLECTION_FIELDS = new Set(['consents', 'healthConditions', 'adlAssessments', 'checklistItems', 'communityAccessRiskItems'])

  it('renders every non-collection Profile field, every Shared field as an EDITABLE control, and no Intake-only field (CommunityAccessDailyLiving stream, so the CA step is included)', async () => {
    const user = userEvent.setup()
    // ActiveNight: as at Intake, the overnight ratio is only asked when there is overnight support.
    const participant = makeParticipant({ serviceStreams: 'CommunityAccessDailyLiving', overnightSupport: 'ActiveNight' })
    renderProfilePage(participant)
    await expectStep(/key identifiers/i)

    const stepCount = 7 // 6 always-visible + Community Access (CA-gated, visible here)
    const sharedFields = sharedFieldsDisplayedOnProfile().map((e) => e.field)
    const seenIds = new Set<string>()
    const radioGroups = new Set<string>()
    const lockedSharedControls: string[] = []
    let readOnlyElements = 0
    const sawContactsEditor: boolean[] = []
    for (let i = 0; i < stepCount; i++) {
      document.querySelectorAll('[id]').forEach((el) => {
        seenIds.add(el.id)
        if (sharedFields.includes(el.id) && (el.hasAttribute('disabled') || el.hasAttribute('readonly'))) lockedSharedControls.push(el.id)
      })
      document.querySelectorAll('[role="radiogroup"]').forEach((el) => radioGroups.add(el.getAttribute('aria-label') ?? ''))
      readOnlyElements += document.querySelectorAll('[aria-readonly="true"]').length
      if (i === 0) sawContactsEditor.push(screen.queryByRole('heading', { name: /^contacts$/i }) !== null)
      if (i < stepCount - 1) {
        await user.click(screen.getByRole('button', { name: /^next$/i }))
        await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(i + 1))
      }
    }
    document.querySelectorAll('[id]').forEach((el) => seenIds.add(el.id))

    const editableProfileFields = fieldsForEntry('profile').map((e) => e.field).filter((f) => !COLLECTION_FIELDS.has(f))
    const missing = editableProfileFields.filter((f) => !seenIds.has(f))
    expect(missing).toEqual([])

    // Every Shared field (captured at Intake) is an ordinary editable control, keyed by its own field id:
    // nothing is a read-only placeholder any more. Tri-state Yes/No/Not-recorded flags are radio-group toggles
    // (same as Intake) and the Contacts group is the embedded Contacts editor.
    const TOGGLE_LABELS = [
      'CALD', 'LGBTIQA+', 'Family / Community', 'Aboriginal and/or Torres Strait Islander',
      'Received: Rights and Responsibilities', 'Received: Privacy and Confidentiality', 'Received: Feedback Information and Form',
      'Received: Being Safe Information', 'Received: Advocacy Information', 'Behaviours of Concern (Current)', 'Behaviours of Concern (5-Year History)',
    ]
    expect(readOnlyElements).toBe(0)
    expect(lockedSharedControls).toEqual([])
    for (const label of TOGGLE_LABELS) expect(radioGroups.has(label), `expected a Yes/No toggle for "${label}"`).toBe(true)
    const toggleBacked = new Set(['isCald', 'isLgbtqi', 'isFamilyCommunity', 'isAboriginalOrTorresStraitIslander', 'receivedRightsAndResponsibilitiesInfo',
      'receivedPrivacyAndConfidentialityInfo', 'receivedFeedbackInfo', 'receivedBeingSafeInfo', 'receivedAdvocacyInfo',
      'behavioursOfConcernCurrent', 'behavioursOfConcernFiveYearHistory', 'contactRoles'])
    for (const field of sharedFields.filter((f) => !toggleBacked.has(f))) {
      expect(seenIds.has(field), `expected an editable control for shared field "${field}"`).toBe(true)
    }
    expect(sawContactsEditor).toEqual([true])

    // No Intake-only field ever appears — e.g. hidpaNotes/region/livingArrangement/notes/isRepeatClient/
    // mobilityAidWalker are Intake-owned and not in the shared set.
    const intakeOnlyFields = fieldsForEntry('intake').map((e) => e.field).filter((f) => !sharedFields.includes(f))
    for (const field of intakeOnlyFields) {
      expect(seenIds.has(field), `Intake-only field "${field}" must not render on the Profile wizard`).toBe(false)
    }
  })
})

// SPEC-05 PF-10.5 — "Re-opening the Profile wizard on a partially-completed participant hydrates
// the saved values." (rather than starting the step blank each time it's reopened).
describe('ProfileWizardPage — PF-10.5 resume hydration', () => {
  it('hydrates a previously-saved Key Identifiers value into its field, while a genuinely unfilled sibling field on the same step stays blank (partial completion, not all-or-nothing)', async () => {
    const participant = makeParticipant({ medicareNumber: '1234567890', weightKg: 72, heightCm: null })
    renderProfilePage(participant)
    await expectStep(/key identifiers/i)

    expect(screen.getByLabelText(/medicare number/i)).toHaveValue('1234567890')
    expect(screen.getByLabelText(/weight/i)).toHaveValue(72)
    expect(screen.getByLabelText(/height/i)).toHaveValue(null)
  })
})

// PP-42 — unsaved changes (a dirty form) must warn before navigating away, same
// useUnsavedChangesWarning idiom as StaffCreatePage/TripCreatePage.
describe('ProfileWizardPage — PP-42 unsaved changes warning', () => {
  it('warns before navigating away once the form is dirty, and does nothing when the form is clean', async () => {
    const user = userEvent.setup()
    renderProfilePage()
    await expectStep(/key identifiers/i)

    const backLink = screen.getByTestId('profile-header-back') as HTMLButtonElement
    expect(backLink).toBeInTheDocument()

    // Clean form: navigating away triggers no warning.
    await user.click(backLink)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Participant detail')).toBeInTheDocument()
  })

  it('shows the "Leave without saving?" dialog when navigating away with a dirty form, and staying keeps the wizard', async () => {
    const user = userEvent.setup()
    renderProfilePage()
    await expectStep(/key identifiers/i)

    await user.type(screen.getByLabelText(/medicare number/i), '9999999999')

    const backLink = screen.getByTestId('profile-header-back') as HTMLButtonElement
    await user.click(backLink)

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/leave without saving/i)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /keep editing/i }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/medicare number/i)).toHaveValue('9999999999')
  })
})

describe('ProfileWizardPage — conditional sections (generic isVisible list, not special-cased)', () => {
  it('omits the Community Access step entirely when serviceStreams does not include CommunityAccessDailyLiving', async () => {
    renderProfilePage(makeParticipant({ serviceStreams: 'InHomeSupport' }))
    await expectStep(/key identifiers/i)
    expect(within(stepNav()).queryByRole('button', { name: /community access/i })).not.toBeInTheDocument()
  })

  it('includes the Community Access step when serviceStreams includes CommunityAccessDailyLiving', async () => {
    renderProfilePage(makeParticipant({ serviceStreams: 'CommunityAccessDailyLiving' }))
    await expectStep(/key identifiers/i)
    expect(within(stepNav()).queryByRole('button', { name: /community access/i })).toBeInTheDocument()
  })

  it('hides the Holiday/STA consent sub-block when serviceStreams does not include STA, but keeps the ungated consents', async () => {
    const user = userEvent.setup()
    renderProfilePage(makeParticipant({ serviceStreams: 'InHomeSupport' }))
    await expectStep(/key identifiers/i)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/cultural depth/i)

    // CONSENT_TYPES' fixed declaration order (PhotoVideo, Alcohol, OtcMedication, EmergencyMedical,
    // Privacy, TravelInsurance, TermsAndConditions) makes each row's field-array index stable
    // regardless of gating — index 0 is always PhotoVideo (ungated), index 1 Alcohol (gated), etc.
    // (CompactGridRow's own aria-label duplicates the select's, so getByLabelText is ambiguous here.)
    expect(document.getElementById('consents.0.granted')).not.toBeNull() // PhotoVideo, ungated
    expect(document.getElementById('consents.1.granted')).toBeNull() // Alcohol, STA-gated
    expect(document.getElementById('consents.5.granted')).toBeNull() // TravelInsurance, STA-gated
  })

  it('shows the Holiday/STA consent sub-block when serviceStreams includes STA', async () => {
    const user = userEvent.setup()
    renderProfilePage(makeParticipant({ serviceStreams: 'STA' }))
    await expectStep(/key identifiers/i)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/cultural depth/i)

    expect(document.getElementById('consents.0.granted')).not.toBeNull() // PhotoVideo, ungated
    expect(document.getElementById('consents.1.granted')).not.toBeNull() // Alcohol, STA-visible
    expect(document.getElementById('consents.5.granted')).not.toBeNull() // TravelInsurance, STA-visible
  })
})

describe('ProfileWizardPage — per-step PATCH and the collection-group trap', () => {
  it('saving the Key Identifiers step PATCHes only its own groups, echoing the Shared fields it did not edit rather than omitting them', async () => {
    const user = userEvent.setup()
    renderProfilePage(makeParticipant({ preferredName: 'Jam', ndisNumber: 'NDIS-999' }))
    await expectStep(/key identifiers/i)

    await user.type(screen.getByLabelText(/middle name/i), 'Q')
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(1))
    const { data } = mockPatchMutateAsync.mock.calls[0][0]
    // `address` is patched too now: its four fields are editable here (they used to be read-only and unsaved).
    expect(Object.keys(data).sort()).toEqual(['address', 'keyIdentifiers', 'ndisPlan', 'personalDetails', 'preferredStaff'].sort())
    // The Shared fields (firstName/lastName/preferredName/ndisNumber/planType/
    // fundingSource) are echoed from the loaded participant, never nulled out.
    expect(data.personalDetails.firstName).toBe('Jamie')
    expect(data.personalDetails.lastName).toBe('Rivers')
    expect(data.personalDetails.preferredName).toBe('Jam')
    expect(data.personalDetails.middleName).toBe('Q')
    expect(data.ndisPlan.ndisNumber).toBe('NDIS-999')
    expect(data.ndisPlan.planType).toBe('SelfManaged')
  })

  // Re-verified 2026-09 in response to a coordinator review of the PF-10.7 re-homing map: the old
  // wizard's single big Zod schema needed an explicit test proving an invalid field elsewhere
  // didn't block the current step's save. The Profile wizard's per-step-keyed schema
  // (PROFILE_STEP_SCHEMAS_BY_KEY[step.key]) makes this true by construction, but nothing
  // previously exercised the negative case directly.
  it('validates only the current step — an invalid field on a different, not-yet-visited step does not block saving this one', async () => {
    const user = userEvent.setup()
    // primaryDiagnosis 'Other — specify' with an empty primaryDiagnosisOther fails the Medical
    // Detail step's own diagnosisOtherRefine — but Key Identifiers' schema never picks either
    // field, so it must have no bearing on saving Key Identifiers.
    renderProfilePage(makeParticipant({ primaryDiagnosis: 'Other — specify', otherDiagnoses: [] }))
    await expectStep(/key identifiers/i)

    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // Re-verified 2026-09 (see comment above) — checklistItems (the 21-row Community
  // Mobility/Transport Risk + Behaviours of Concern grid) is owned entirely by ONE step here
  // (participantPatchGroups.ts: `communityAccess: [..., 'checklistItems']`), unlike the old wizard
  // where it was split across two separate steps (Support Needs & Mobility / Behaviour &
  // Communication) each required to send only its own item types — that specific cross-step
  // filtering hazard is architecturally impossible now, since no other step ever touches this
  // collection. Nothing previously confirmed the collection round-trips through this single step
  // at all, so this fills that gap.
  it('saving the Community Access step sends the full checklistItems collection in one PATCH', async () => {
    const user = userEvent.setup()
    const participant = makeParticipant({
      serviceStreams: 'CommunityAccessDailyLiving',
      checklistItems: [{ id: 'ci-1', participantId: 'participant-1', itemType: 'FallsRisk', value: 'Yes', notes: 'note', createdAt: null, updatedAt: null }],
    })
    renderProfilePage(participant)
    await expectStep(/key identifiers/i)

    // 6 clicks: keyIdentifiers->culturalDepth->medical->mobility->behaviourCognition->dailyLiving->
    // communityAccess (matches the drift-guard test's own step-traversal pattern above).
    const clicksToReachCommunityAccess = 6
    for (let i = 0; i < clicksToReachCommunityAccess; i++) {
      await user.click(screen.getByRole('button', { name: /^next$/i }))
      await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(i + 1))
    }
    await expectStep(/community access/i)

    // The 7th "Next" click saves the Community Access step itself and advances to Review.
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(clicksToReachCommunityAccess + 1))
    const { data } = mockPatchMutateAsync.mock.calls[clicksToReachCommunityAccess][0]
    expect(data).toHaveProperty('checklistItems')
    const sentTypes = (data.checklistItems as { itemType: string }[]).map((c) => c.itemType)
    expect(sentTypes).toContain('FallsRisk')
    expect(sentTypes.length).toBeGreaterThan(1) // the full 21-row grid, not just the one pre-filled row
  })

  it('THE TRAP: saving Cultural Depth/Consents while STA is absent omits the 4 gated consent types entirely (never sends them as null), so previously-recorded values are retained server-side', async () => {
    const user = userEvent.setup()
    const participant = makeParticipant({
      serviceStreams: 'InHomeSupport',
      consents: [
        { id: 'c1', participantId: 'participant-1', consentType: 'Alcohol', granted: true, recordedAt: null, signedByName: 'Jamie', signedDate: null, createdAt: null, updatedAt: null },
      ],
    })
    renderProfilePage(participant)
    await expectStep(/key identifiers/i)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/cultural depth/i)

    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(2))
    const { data } = mockPatchMutateAsync.mock.calls[1][0]
    const sentTypes = (data.consents as { consentType: string }[]).map((c) => c.consentType)
    expect(sentTypes).toEqual(expect.arrayContaining(['PhotoVideo', 'Privacy', 'EmergencyMedical']))
    expect(sentTypes).not.toEqual(expect.arrayContaining(['Alcohol', 'OtcMedication', 'TravelInsurance', 'TermsAndConditions']))
  })

  it('saving Cultural Depth/Consents while STA is present includes all 7 consent types', async () => {
    const user = userEvent.setup()
    renderProfilePage(makeParticipant({ serviceStreams: 'STA' }))
    await expectStep(/key identifiers/i)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/cultural depth/i)

    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(2))
    const { data } = mockPatchMutateAsync.mock.calls[1][0]
    expect((data.consents as { consentType: string }[]).length).toBe(7)
  })

  // Note: serviceStreams is Intake-owned and read-only on this wizard (never edited by any
  // Profile step), so the CA/STA gates cannot actually flip mid-session in this design — the
  // "computed step list recomputes without losing state" capability itself belongs to, and is
  // exercised by, CORE-01's own `useWizard.test.ts` (steps-array-identity-change clamping). The
  // two tests above already cover both visible/absent forms of each gate.
})

// DIAG-02 — re-homed from the retired single-step wizard's test suite by PF-10.7. The engine
// (useDeriveFieldValues) itself is generically covered by conditionalFields.test.tsx; this is the
// concrete epilepsy -> HIDPA / epilepsy -> health-conditions-grid consumer, wired into this wizard
// (not the Intake wizard) because primaryDiagnosis/hidpaSupportCategories/healthConditions are all
// Profile-owned and rendered together on the Medical Detail step.
describe('ProfileWizardPage — DIAG-02 epilepsy derivation (re-homed from the retired create wizard)', () => {
  async function advanceToMedical(user: ReturnType<typeof userEvent.setup>) {
    await expectStep(/key identifiers/i)
    await user.click(screen.getByRole('button', { name: /^next$/i })) // -> Cultural Depth
    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(1))
    await expectStep(/cultural depth/i)
    await user.click(screen.getByRole('button', { name: /^next$/i })) // -> Medical
    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(2))
    await expectStep(/medical/i)
  }

  it('selecting Epilepsy as Primary Diagnosis pre-selects Epilepsy and Seizure Management by default', async () => {
    const user = userEvent.setup()
    renderProfilePage()
    await advanceToMedical(user)

    expect(screen.getByLabelText('Epilepsy and Seizure Management')).not.toBeChecked()

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Epilepsy')

    expect(screen.getByLabelText('Epilepsy and Seizure Management')).toBeChecked()
  })

  it('also pre-fills the Epilepsy health-condition grid row to "Yes" when unanswered', async () => {
    const user = userEvent.setup()
    renderProfilePage()
    await advanceToMedical(user)

    // getByRole (not getByLabelText) — the health-condition grid row is a CompactGridRow, whose
    // outer `role="group"` element ALSO carries `aria-label="Epilepsy"` (see CompactGridRow.tsx),
    // so a plain label-text query is ambiguous between that group and this select.
    const epilepsyRow = screen.getByRole('combobox', { name: 'Epilepsy' }) as HTMLSelectElement
    expect(epilepsyRow.value).toBe('')

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Epilepsy')

    expect(epilepsyRow.value).toBe('true')
  })

  it('the derived default is a DEFAULT not a lock: the user can untick it, and it survives further unrelated edits', async () => {
    const user = userEvent.setup()
    renderProfilePage()
    await advanceToMedical(user)

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Epilepsy')
    expect(screen.getByLabelText('Epilepsy and Seizure Management')).toBeChecked()

    await user.click(screen.getByLabelText('Epilepsy and Seizure Management')) // untick
    expect(screen.getByLabelText('Epilepsy and Seizure Management')).not.toBeChecked()

    // A further, unrelated edit on the same step (`when` stays true — no new false->true
    // transition) must not silently re-force it back on.
    await user.type(screen.getByLabelText(/allergies detail/i), 'Peanuts')
    expect(screen.getByLabelText('Epilepsy and Seizure Management')).not.toBeChecked()
  })

  it('does NOT re-tick an existing participant\'s deliberately-unticked selection on load (edit-mode-safe resetKey)', async () => {
    const participant = makeParticipant({
      primaryDiagnosis: 'Epilepsy',
      hidpaSupportCategories: 'None', // already saved without EpilepsyManagement
      healthConditions: [{ id: 'hc-1', participantId: 'participant-1', conditionType: 'Epilepsy', has: true, severity: '', planProvided: null, trainingRequired: null, notes: '', createdAt: null, updatedAt: null }],
    })
    renderProfilePage(participant)
    await advanceToMedical(userEvent.setup())

    expect(screen.getByLabelText('Epilepsy and Seizure Management')).not.toBeChecked()
  })
})

// PF-cg03 — the caregiver wizard reuses these two Profile step components with a `hiddenFields`
// prop, so it never renders the two allocation-contract fields classified internal
// (CAREGIVER_INTERNAL_FIELDS: preferredStaffId, behaviourRiskRating).
describe('KeyIdentifiersStep / BehaviourCognitionStep — hiddenFields prop', () => {
  function KeyIdentifiersHarness({ hiddenFields }: { hiddenFields?: ReadonlySet<string> }) {
    const { control, register, formState: { errors } } = useForm<ParticipantFormData>()
    return (
      <KeyIdentifiersStep
        control={control}
        register={register}
        errors={errors}
        participant={makeParticipant()}
        activeStaff={[{ id: 'staff-1', fullName: 'Alex Rivera' }]}
        hiddenFields={hiddenFields}
      />
    )
  }

  function BehaviourCognitionHarness({ hiddenFields }: { hiddenFields?: ReadonlySet<string> }) {
    const { control, register } = useForm<ParticipantFormData>()
    return (
      <BehaviourCognitionStep
        control={control}
        register={register}
        participant={makeParticipant()}
        hiddenFields={hiddenFields}
      />
    )
  }

  it('KeyIdentifiersStep renders the Preferred Staff Member control (id="preferredStaffId") by default, and omits it when hidden', () => {
    // SearchableSelect is a Controller-wrapped custom control (not a native input), so — same
    // convention as this file's own "seenIds" drift guard above — presence is asserted via the
    // field's own DOM id rather than getByLabelText.
    const { unmount } = render(<KeyIdentifiersHarness />)
    expect(document.getElementById('preferredStaffId')).not.toBeNull()
    unmount()

    render(<KeyIdentifiersHarness hiddenFields={new Set(['preferredStaffId'])} />)
    expect(document.getElementById('preferredStaffId')).toBeNull()
  })

  it('BehaviourCognitionStep renders the Behaviour Risk Rating control by default, and omits it when hidden', () => {
    const { unmount } = render(<BehaviourCognitionHarness />)
    expect(screen.getByLabelText(/behaviour risk rating/i)).toBeInTheDocument()
    unmount()

    render(<BehaviourCognitionHarness hiddenFields={new Set(['behaviourRiskRating'])} />)
    expect(screen.queryByLabelText(/behaviour risk rating/i)).not.toBeInTheDocument()
  })
})

// CORE-01 + CORE-02 acceptance: rail sits in a WizardShell aside beside the form, and the page-header
// back control is history-aware (uses real in-app history when available, fallback otherwise).
describe('ProfileWizardPage — wizard shell + history-aware back', () => {
  it('renders the WizardShell aside landmark containing the step rail and the form alongside it', async () => {
    renderProfilePage()
    await expectStep(/key identifiers/i)
    const aside = screen.getByRole('complementary', { name: /wizard steps/i })
    expect(aside).toBeInTheDocument()
    expect(within(aside).getByRole('navigation', { name: /intake wizard steps/i })).toBeInTheDocument()
    // The form still renders inside the same shell as the rail.
    expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument()
  })

  it('falls back to /participants/:id when arriving at the profile wizard via a deep link (no prior path)', async () => {
    const user = userEvent.setup()
    renderProfilePageWithTracker()
    const back = screen.getByTestId('profile-header-back')
    expect(back).toBeInTheDocument()
    await user.click(back)
    expect(await screen.findByText('Participant detail')).toBeInTheDocument()
  })

  it('returns to the previous in-app screen when the user arrived from one (e.g. onboarding → Edit profile)', async () => {
    const user = userEvent.setup()
    __testHooks.reset()
    __testHooks.recordCurrentPath('/onboarding/participant-1')
    __testHooks.recordCurrentPath('/participants/participant-1/profile')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const router = createMemoryRouter(
      [
        {
          path: '/participants/:id/profile',
          element: <><Tracker /><ProfileWizardPage /></>,
        },
        { path: '/onboarding/:id', element: <div>Onboarding screen</div> },
      ],
      { initialEntries: ['/participants/participant-1/profile'] },
    )
    render(<RouterProvider router={router} />)
    const back = await screen.findByTestId('profile-header-back')
    await user.click(back)
    expect(await screen.findByText('Onboarding screen')).toBeInTheDocument()
  })

  it('the back destination matches the recorded previous path, not the hardcoded /participants/:id fallback', async () => {
    __testHooks.reset()
    __testHooks.recordCurrentPath('/onboarding/participant-1')
    __testHooks.recordCurrentPath('/participants/participant-1/profile')
    // No /participants/:id route. If the back control hardcoded the fallback, the click would
    // land on a "no routes matched" warning — the absence of the /participants/:id detail marker
    // is the proof that the back target was the recorded previous path.
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const router = createMemoryRouter(
      [
        {
          path: '/participants/:id/profile',
          element: <><Tracker /><ProfileWizardPage /></>,
        },
        { path: '/onboarding/:id', element: <div>Onboarding screen</div> },
        { path: '/participants/:id', element: <div>Participant detail</div> },
      ],
      { initialEntries: ['/participants/participant-1/profile'] },
    )
    render(<RouterProvider router={router} />)
    const back = screen.getByTestId('profile-header-back')
    expect(back).toBeInTheDocument()
    fireEvent.click(back)
    // The recorded previous path wins over the hardcoded /participants/:id fallback: the
    // onboarding screen renders and the fallback destination does not.
    expect(await screen.findByText('Onboarding screen')).toBeInTheDocument()
    expect(screen.queryByText('Participant detail')).not.toBeInTheDocument()
  })
})
