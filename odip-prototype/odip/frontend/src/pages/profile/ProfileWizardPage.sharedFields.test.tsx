/**
 * The Profile wizard makes every field captured at Intake editable (staff sometimes find the intake answer was
 * wrong): each renders as the same control the Intake wizard uses, prefilled from the participant, validated by
 * the Intake refines, and saved by the step's PATCH (address and risksHazardsSummary included). The embedded
 * Contacts editor and the final "Complete Profile" PUT are covered here too. Field-by-field drift against the
 * allocation contract lives in ProfileWizardPage.test.tsx; control parity with Intake in sharedFieldParity.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ProfileWizardPage from './ProfileWizardPage'
import type { ParticipantDetailDto } from '@/api/types/participants'

const { mockUseParticipant, mockPatchMutateAsync, mockUpdateMutateAsync, mockCompleteMutateAsync, mockContactRoles } = vi.hoisted(() => ({
  mockUseParticipant: vi.fn(),
  mockPatchMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockCompleteMutateAsync: vi.fn(),
  mockContactRoles: { current: [] as unknown[] },
}))

vi.mock('@/api/hooks', () => ({
  useParticipant: mockUseParticipant,
  usePatchParticipant: () => ({ mutateAsync: mockPatchMutateAsync, isPending: false }),
  useUpdateParticipant: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useCompleteParticipantProfile: () => ({ mutateAsync: mockCompleteMutateAsync, isPending: false }),
  useUpsertCommunityAccessRiskItem: () => ({ mutateAsync: vi.fn().mockResolvedValue({ success: true }) }),
  useStaff: () => ({ data: [] }),
  useParticipantContactRoles: () => ({ data: mockContactRoles.current, isLoading: false }),
  useDeleteContactRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function makeParticipant(overrides: Partial<ParticipantDetailDto> = {}): ParticipantDetailDto {
  return {
    id: 'participant-1', firstName: 'Alexandra', lastName: 'Citizen', fullName: 'Alexandra Citizen', preferredName: 'Alex',
    dateOfBirth: '1990-05-17T00:00:00', phone: '0400 000 000', email: 'alex@example.test',
    addressStreet: '1 Example St', addressSuburb: 'Brisbane', addressState: 'QLD', addressPostcode: '4000',
    ndisNumber: '431234567', planStartDate: '2026-01-01T00:00:00', planEndDate: '2027-01-01T00:00:00',
    planType: 'PlanManaged', fundingSource: 'Ndis', isActive: true, isRepeatClient: false,
    mobilityAidWheelchair: true, mobilityAidWalker: false, isHighSupport: false, isIntensiveSupport: false,
    supportRatio: 'OneToTwo', overnightSupport: 'ActiveNight', overnightRatio: 'TwoToOne', hasRestrictivePracticeFlag: false,
    serviceStreams: 'InHomeSupport', hasActiveMedications: false, isDraft: true, mobilitySupportOptions: [],
    otherDiagnoses: [], hidpaSupportCategories: 'None', requiresHiLoBed: false, requiresHoist: true,
    requiresShowerChair: false, requiresCommode: false, requiresStandingMachine: false,
    isCald: true, isLgbtqi: false, isFamilyCommunity: null, isAboriginalOrTorresStraitIslander: null,
    receivedRightsAndResponsibilitiesInfo: true, receivedPrivacyAndConfidentialityInfo: null, receivedFeedbackInfo: null,
    receivedBeingSafeInfo: null, receivedAdvocacyInfo: null,
    behavioursOfConcernCurrent: true, behavioursOfConcernFiveYearHistory: false,
    expressiveSkills: 'Verbal, short sentences', behaviourRiskSummary: 'Can become distressed in crowds', medicalSummary: 'Asthma; carries an inhaler',
    // Intake-only fields the Profile wizard never displays but must not lose.
    livingArrangement: 'Family', mainSupportPersonName: 'Pat Citizen', mainSupportPersonRelationship: 'Mother', region: 'QLD', notes: 'Prefers morning calls',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    consents: [], healthConditions: [], adlAssessments: [], checklistItems: [], communityAccessRiskItems: [],
    ...overrides,
  } as unknown as ParticipantDetailDto
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

async function expectStep(label: string | RegExp) {
  await within(screen.getByRole('navigation', { name: /intake wizard steps/i })).findByRole('button', { name: label, current: 'step' })
}

async function next(user: ReturnType<typeof userEvent.setup>, expectedPatches: number) {
  await user.click(screen.getByRole('button', { name: /^next$/i }))
  await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(expectedPatches))
}

/** The shown text of a custom Dropdown trigger, found by its field id. */
const dropdownText = (id: string) => document.getElementById(id)?.textContent

const isChecked = (group: string, option: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: option }).getAttribute('aria-checked') === 'true'

beforeEach(() => {
  mockUseParticipant.mockReset()
  mockPatchMutateAsync.mockReset().mockResolvedValue({ success: true })
  mockUpdateMutateAsync.mockReset().mockResolvedValue({ success: true })
  mockCompleteMutateAsync.mockReset().mockResolvedValue({ success: true })
  mockContactRoles.current = []
  localStorage.clear()
})

describe('Profile wizard: fields captured at Intake are editable and prefilled', () => {
  it('Key Identifiers shows the participant\'s intake values in editable controls, with human labels rather than enum text', async () => {
    renderProfilePage()
    await expectStep(/key identifiers/i)

    expect(screen.getByLabelText(/^First Name/)).toHaveValue('Alexandra')
    expect(screen.getByLabelText(/^Last Name/)).toHaveValue('Citizen')
    expect(screen.getByLabelText('Preferred Name')).toHaveValue('Alex')
    expect(screen.getByLabelText('Date of Birth')).toHaveValue('1990-05-17')
    expect(screen.getByLabelText('Phone')).toHaveValue('0400 000 000')
    expect(screen.getByLabelText('Email')).toHaveValue('alex@example.test')
    expect(screen.getByLabelText('Street')).toHaveValue('1 Example St')
    expect(screen.getByLabelText('Suburb')).toHaveValue('Brisbane')
    expect(screen.getByLabelText(/^Postcode/)).toHaveValue('4000')
    expect(screen.getByLabelText('NDIS Number')).toHaveValue('431234567')
    expect(screen.getByLabelText('Plan Start Date')).toHaveValue('2026-01-01')
    expect(screen.getByLabelText('Plan End Date')).toHaveValue('2027-01-01')
    // Dropdowns show Intake's labels, never the raw "PlanManaged".
    expect(dropdownText('addressState')).toBe('QLD')
    expect(dropdownText('planType')).toBe('Plan Managed')
    expect(dropdownText('fundingSource')).toBe('NDIS')

    for (const label of [/^First Name/, /^Last Name/, 'Phone', 'Street', 'NDIS Number']) {
      expect(screen.getByLabelText(label)).not.toBeDisabled()
      expect(screen.getByLabelText(label)).not.toHaveAttribute('readonly')
    }
    expect(document.querySelector('[aria-readonly="true"]')).toBeNull()
    expect(screen.queryByText(/read-only here/i)).not.toBeInTheDocument()
    expect(screen.getAllByText("From intake — correct it here if it's wrong").length).toBeGreaterThan(0)
  })

  it('every later step shows its intake values too: flags as Yes/No toggles, support needs with Intake\'s labels, summaries as text', async () => {
    const user = userEvent.setup()
    renderProfilePage()
    await expectStep(/key identifiers/i)

    await next(user, 1)
    await expectStep(/cultural depth/i)
    expect(isChecked('CALD', 'Yes')).toBe(true)
    expect(isChecked('LGBTIQA+', 'No')).toBe(true)
    expect(isChecked('Family / Community', 'Not recorded')).toBe(true)
    expect(isChecked('Received: Rights and Responsibilities', 'Yes')).toBe(true)

    await next(user, 2)
    await expectStep(/medical/i)
    expect(screen.getByLabelText('Medical Summary')).toHaveValue('Asthma; carries an inhaler')

    await next(user, 3)
    await expectStep(/mobility/i)
    expect(screen.getByLabelText('Wheelchair')).toBeChecked()
    expect(screen.getByLabelText('Hoist')).toBeChecked()
    expect(screen.getByLabelText('Hi-Lo Bed')).not.toBeChecked()
    expect(dropdownText('overnightSupport')).toBe('Active Night')
    expect(dropdownText('overnightRatio')).toBe('2:1')
    expect(dropdownText('supportRatio')).toBe('1:2')

    await next(user, 4)
    await expectStep(/behaviour/i)
    expect(isChecked('Behaviours of Concern (Current)', 'Yes')).toBe(true)
    expect(isChecked('Behaviours of Concern (5-Year History)', 'No')).toBe(true)
    expect(screen.getByLabelText('Expressive Skills')).toHaveValue('Verbal, short sentences')
    expect(screen.getByLabelText('Behaviour Risk Summary')).toHaveValue('Can become distressed in crowds')
  })

  it('keeps a stored support ratio the Intake list does not offer (1:3) visible instead of blanking it', async () => {
    const user = userEvent.setup()
    renderProfilePage(makeParticipant({ supportRatio: 'OneToThree' }))
    await expectStep(/key identifiers/i)
    await next(user, 1)
    await next(user, 2)
    await next(user, 3)
    await expectStep(/mobility/i)
    expect(dropdownText('supportRatio')).toBe('1:3')
  })

  it('asks for the overnight ratio only when there is overnight support, as Intake does', async () => {
    const user = userEvent.setup()
    renderProfilePage(makeParticipant({ overnightSupport: 'None' }))
    await expectStep(/key identifiers/i)
    await next(user, 1)
    await next(user, 2)
    await next(user, 3)
    await expectStep(/mobility/i)
    expect(document.getElementById('overnightRatio')).toBeNull()
    await user.click(document.getElementById('overnightSupport') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Sleepover Support' }))
    expect(document.getElementById('overnightRatio')).not.toBeNull()
  })
})

describe('Profile wizard: corrected intake values are sent and saved by the step', () => {
  it('Key Identifiers PATCHes the corrected name, phone, address and plan type in their own groups', async () => {
    const user = userEvent.setup()
    renderProfilePage()
    await expectStep(/key identifiers/i)

    await user.clear(screen.getByLabelText(/^Last Name/))
    await user.type(screen.getByLabelText(/^Last Name/), 'Citizen-Smith')
    await user.clear(screen.getByLabelText('Phone'))
    await user.type(screen.getByLabelText('Phone'), '0411 222 333')
    await user.clear(screen.getByLabelText(/^Postcode/))
    await user.type(screen.getByLabelText(/^Postcode/), '4001')
    await user.click(document.getElementById('addressState') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'NSW' }))
    await user.click(document.getElementById('planType') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Agency Managed' }))
    await next(user, 1)

    const { id, data } = mockPatchMutateAsync.mock.calls[0][0]
    expect(id).toBe('participant-1')
    expect(data.personalDetails).toEqual(expect.objectContaining({
      firstName: 'Alexandra', lastName: 'Citizen-Smith', preferredName: 'Alex', dateOfBirth: '1990-05-17', phone: '0411 222 333', email: 'alex@example.test',
    }))
    expect(data.address).toEqual({ addressStreet: '1 Example St', addressSuburb: 'Brisbane', addressState: 'NSW', addressPostcode: '4001' })
    expect(data.ndisPlan).toEqual(expect.objectContaining({
      ndisNumber: '431234567', planStartDate: '2026-01-01', planEndDate: '2027-01-01', planType: 'AgencyManaged', fundingSource: 'Ndis',
    }))
  })

  it('the later steps PATCH their corrected flags, equipment and summaries, and risksHazardsSummary echoes the general notes', async () => {
    const user = userEvent.setup()
    renderProfilePage()
    await expectStep(/key identifiers/i)
    await next(user, 1)

    await user.click(within(screen.getByRole('radiogroup', { name: 'CALD' })).getByRole('radio', { name: 'No' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Received: Advocacy Information' })).getByRole('radio', { name: 'Yes' }))
    await next(user, 2)
    expect(mockPatchMutateAsync.mock.calls[1][0].data.culturalBackground).toEqual(expect.objectContaining({
      isCald: false, isLgbtqi: false, isFamilyCommunity: null, receivedRightsAndResponsibilitiesInfo: true, receivedAdvocacyInfo: true,
    }))

    await user.clear(screen.getByLabelText('Medical Summary'))
    await user.type(screen.getByLabelText('Medical Summary'), 'Asthma and epilepsy')
    await next(user, 3)
    expect(mockPatchMutateAsync.mock.calls[2][0].data.medical).toEqual(expect.objectContaining({ medicalSummary: 'Asthma and epilepsy' }))

    await user.click(screen.getByLabelText('Wheelchair'))
    await user.click(screen.getByLabelText('Shower Chair'))
    await user.click(document.getElementById('supportRatio') as HTMLElement)
    await user.click(screen.getByRole('option', { name: '2:1' }))
    await next(user, 4)
    expect(mockPatchMutateAsync.mock.calls[3][0].data.supportNeedsMobility).toEqual(expect.objectContaining({
      mobilityAidWheelchair: false, requiresShowerChair: true, requiresHoist: true, supportRatio: 'TwoToOne', overnightSupport: 'ActiveNight', overnightRatio: 'TwoToOne',
    }))

    await user.click(within(screen.getByRole('radiogroup', { name: 'Behaviours of Concern (Current)' })).getByRole('radio', { name: 'No' }))
    await user.clear(screen.getByLabelText('Behaviour Risk Summary'))
    await user.type(screen.getByLabelText('Behaviour Risk Summary'), 'Distress has eased')
    await next(user, 5)
    const behaviour = mockPatchMutateAsync.mock.calls[4][0].data
    expect(behaviour.behaviourCommunication).toEqual(expect.objectContaining({ behavioursOfConcernCurrent: false, behavioursOfConcernFiveYearHistory: false, expressiveSkills: 'Verbal, short sentences' }))
    // THE TRAP: a present group is a mini full-submit, so the general notes must be echoed, not cleared.
    expect(behaviour.risksHazardsSummary).toEqual({ behaviourRiskSummary: 'Distress has eased', notes: 'Prefers morning calls' })
  })

  it('shows the server\'s rejection and keeps the corrected values on screen so the user can retry', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockRejectedValueOnce(new Error('Server says no'))
    renderProfilePage()
    await expectStep(/key identifiers/i)

    await user.clear(screen.getByLabelText(/^Last Name/))
    await user.type(screen.getByLabelText(/^Last Name/), 'Citizen-Smith')
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save this section/i)
    await expectStep(/key identifiers/i)
    expect(screen.getByLabelText(/^Last Name/)).toHaveValue('Citizen-Smith')

    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await expectStep(/cultural depth/i)
    expect(mockPatchMutateAsync).toHaveBeenCalledTimes(2)
    expect(mockPatchMutateAsync.mock.calls[1][0].data.personalDetails.lastName).toBe('Citizen-Smith')
  })
})

describe('Profile wizard: the Intake validation applies to the corrected values', () => {
  async function clickNext(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^next$/i }))
  }

  it.each([
    ['a blank first name', /^First Name/, '', /first name is required/i],
    ['a blank last name', /^Last Name/, '', /last name is required/i],
    ['a postcode that is not 4 digits', /^Postcode/, '12', /postcode must be exactly 4 digits/i],
    ['an invalid phone number', 'Phone', 'call me', /valid phone number/i],
    ['an invalid email address', 'Email', 'not-an-email', /valid email address/i],
  ])('blocks Next on %s, and sends nothing', async (_name, label, value, message) => {
    const user = userEvent.setup()
    renderProfilePage()
    await expectStep(/key identifiers/i)
    const input = screen.getByLabelText(label)
    await user.clear(input)
    if (value) await user.type(input, value)
    await clickNext(user)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(mockPatchMutateAsync).not.toHaveBeenCalled()
    await expectStep(/key identifiers/i)
  })

  it('a funding source of Other swaps the NDIS fields for a required funding organisation, as at Intake', async () => {
    const user = userEvent.setup()
    renderProfilePage()
    await expectStep(/key identifiers/i)
    await user.click(document.getElementById('fundingSource') as HTMLElement)
    // Scoped to the open listbox: the Gender select on this step also has an "Other" option.
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Other' }))

    expect(document.getElementById('ndisNumber')).toBeNull()
    expect(document.getElementById('planType')).toBeNull()
    await clickNext(user)
    expect(await screen.findByText(/specify the funding organisation/i)).toBeInTheDocument()
    expect(mockPatchMutateAsync).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/funding organisation/i), 'Plan Partners')
    await next(user, 1)
    expect(mockPatchMutateAsync.mock.calls[0][0].data.ndisPlan).toEqual(expect.objectContaining({ fundingSource: 'Other', fundingOrganisation: 'Plan Partners' }))
  })

  it('warns, advisorily, when the selected plan type has no matching contact, exactly as Intake does', async () => {
    const user = userEvent.setup()
    mockContactRoles.current = [{ id: 'r1', roleType: 'NextOfKin', status: 'Active', personFullName: 'Pat Citizen', isPrimary: true }]
    renderProfilePage(makeParticipant({ planType: 'SelfManaged' }))
    await expectStep(/key identifiers/i)
    expect(screen.queryByText(/no active plan manager contact/i)).not.toBeInTheDocument()

    await user.click(document.getElementById('planType') as HTMLElement)
    await user.click(screen.getByRole('option', { name: 'Plan Managed' }))
    expect(await screen.findByText(/no active plan manager contact/i)).toBeInTheDocument()
    await next(user, 1) // advisory only: it never blocks the save
  })
})

describe('Profile wizard: contacts are edited in place with the Contacts tab editor', () => {
  it('embeds the participant\'s contacts, and cancelling one of its dialogs does not submit the wizard', async () => {
    const user = userEvent.setup()
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    mockContactRoles.current = [{
      id: 'role-1', participantId: 'participant-1', personId: 'p1', personFullName: 'Pat Citizen', roleType: 'NextOfKin', status: 'Active', isPrimary: true,
      relationshipToParticipant: 'Mother',
    }]
    renderProfilePage()
    await expectStep(/key identifiers/i)

    expect(screen.getByRole('heading', { name: /^contacts$/i })).toBeInTheDocument()
    expect(screen.getByText('Pat Citizen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add contact/i })).toBeInTheDocument()

    // The dialog renders inside the wizard's <form>: its Cancel must not be a submit button, or it would
    // fire "Complete Profile" (a full PUT that finalises the participant).
    await user.click(screen.getByRole('button', { name: /^remove$/i }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
    expect(mockPatchMutateAsync).not.toHaveBeenCalled()
    await expectStep(/key identifiers/i)
  })
})

describe('Profile wizard: Complete Profile finalises without sending any profile value', () => {
  it('saves a correction through its own step PATCH, then finalises with the complete-profile call; the full-record PUT is never used, so nothing the wizard does not show can be nulled', async () => {
    const user = userEvent.setup()
    renderProfilePage()
    await expectStep(/key identifiers/i)

    await user.clear(screen.getByLabelText(/^Last Name/))
    await user.type(screen.getByLabelText(/^Last Name/), 'Citizen-Smith')
    for (let i = 1; i <= 6; i++) await next(user, i)
    await expectStep(/review/i)
    await user.click(screen.getByRole('button', { name: /complete profile/i }))

    // The correction went out with its step (and only that step's groups): the fields this wizard does not show were never part of it.
    expect(mockPatchMutateAsync.mock.calls.some(([arg]) => arg.data.personalDetails?.lastName === 'Citizen-Smith')).toBe(true)
    await waitFor(() => expect(mockCompleteMutateAsync).toHaveBeenCalledTimes(1))
    expect(mockCompleteMutateAsync).toHaveBeenCalledWith({ id: 'participant-1' })
    // The old final call was a full PUT with isDraft false and every field the wizard knew about; it replaced the rest with nulls.
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
    expect(await screen.findByText('Participant detail')).toBeInTheDocument()
  })
})
