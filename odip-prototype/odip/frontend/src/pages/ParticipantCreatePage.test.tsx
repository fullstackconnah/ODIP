import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ParticipantCreatePage from './ParticipantCreatePage'

const {
  mockUseParticipant, mockCreateMutateAsync, mockUpdateMutateAsync,
} = vi.hoisted(() => ({
  mockUseParticipant: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — FormField, Dropdown, Card are the real components, so this
// exercises the actual wizard step-gating/navigation/review wiring.
vi.mock('@/api/hooks', () => ({
  useCreateParticipant: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false }),
  useUpdateParticipant: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false }),
  useParticipant: mockUseParticipant,
  useStaff: () => ({
    data: [
      { id: 'staff-1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', isActive: true },
      { id: 'staff-2', firstName: 'Jo', lastName: 'Lee', fullName: 'Jo Lee', isActive: true },
    ],
  }),
}))

// ParticipantCreatePage calls useUnsavedChangesWarning, which uses react-router 7's
// useBlocker — that throws under a plain declarative <MemoryRouter>/<Routes>, so tests need a
// data router (same requirement App.tsx documents for the real app).
function renderCreatePage() {
  const router = createMemoryRouter(
    [
      { path: '/participants/new', element: <ParticipantCreatePage /> },
      // Registered so the post-submit navigate(`/participants/${id}`) resolves cleanly
      // instead of logging a router 404 to stderr.
      { path: '/participants/:id', element: <div>Participant detail</div> },
    ],
    { initialEntries: ['/participants/new'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockUseParticipant.mockReturnValue({ data: undefined, isLoading: false })
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'new-participant-1' } })
})

function stepNav() {
  return screen.getByRole('navigation', { name: /intake wizard steps/i })
}

describe('ParticipantCreatePage wizard navigation', () => {
  it('blocks Next on the Identity step until required fields are filled, then advances', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    // Step 0 (Identity & Contacts) is current.
    expect(within(stepNav()).getByRole('button', { name: /step 1|identity/i, current: 'step' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Blocked: still on step 0, error summary shown, first invalid field focused.
    expect(screen.getByRole('alert')).toHaveTextContent(/first name is required/i)
    expect(screen.getByLabelText('First Name *')).toHaveFocus()
    expect(screen.queryByLabelText('NDIS Number')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Advanced to step 1 (NDIS & Funding).
    expect(screen.getByLabelText('NDIS Number')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not re-steal focus on a later, unrelated revisit of a step that once failed validation', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    // Fail Next on step 0 — focus moves to the first invalid field.
    await user.click(screen.getByRole('button', { name: 'Next' }))
    const firstNameInput = screen.getByLabelText('First Name *')
    expect(firstNameInput).toHaveFocus()

    // Fix the field and advance.
    await user.type(firstNameInput, 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText('NDIS Number')).toBeInTheDocument()

    // Revisit step 0 via Back — the stale focus request from the earlier failure must not
    // steal focus again.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('First Name *')).not.toHaveFocus()

    // Advance again, then revisit step 0 via the step pill instead of Back — same guarantee.
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText('NDIS Number')).toBeInTheDocument()
    await user.click(within(stepNav()).getByRole('button', { name: /identity/i }))
    expect(screen.getByLabelText('First Name *')).not.toHaveFocus()
  })

  it('Back preserves values entered on a later step', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.type(screen.getByLabelText('Region'), 'QLD')
    await user.click(screen.getByRole('button', { name: 'Back' }))

    // Back on step 0 — Identity fields still intact.
    expect(screen.getByLabelText('First Name *')).toHaveValue('Jamie')

    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Forward again — the Region value typed before Back was not lost.
    expect(screen.getByLabelText('Region')).toHaveValue('QLD')
  })
})

describe('ParticipantCreatePage per-step validation scoping', () => {
  it('an error left on the Support step does not block editing fields on the NDIS step', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding

    await user.type(screen.getByLabelText('Region'), 'QLD')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment

    // Trigger the cross-field equipment error: check a box (this un-disables the notes
    // field), type notes, then uncheck the box again so the notes are now orphaned.
    await user.click(screen.getByLabelText('Hi-Lo Bed'))
    await user.type(screen.getByLabelText('Equipment Requirements'), 'Needs a hoist')
    await user.click(screen.getByLabelText('Hi-Lo Bed'))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/select an equipment item/i)

    // Go back to the NDIS step — its own field is still editable and shows no error, even
    // though the Support step above it currently has an outstanding validation error.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const regionInput = screen.getByLabelText('Region')
    expect(regionInput).toHaveValue('QLD')
    await user.type(regionInput, ', Australia')
    expect(regionInput).toHaveValue('QLD, Australia')
  })
})

describe('ParticipantCreatePage Review step', () => {
  async function advanceToReview(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding

    await user.type(screen.getByLabelText('NDIS Number'), '431234567')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment

    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
  }

  it('shows a read-only summary reflecting entered values, and Edit jumps back to that step', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await advanceToReview(user)

    expect(screen.getByText('Jamie')).toBeInTheDocument()
    expect(screen.getByText('Smith')).toBeInTheDocument()
    expect(screen.getByText('431234567')).toBeInTheDocument()

    // No form controls remain — Review is read-only. NDIS Number is one of the fields typed.
    expect(screen.queryByLabelText('NDIS Number')).not.toBeInTheDocument()

    // Each group's Edit button carries a distinct accessible name (aria-label) even though
    // they all show the same "Edit" visible text — five identical "Edit" accessible names
    // would be indistinguishable to screen reader users navigating by role.
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(5)

    // Review groups render in step order: Identity(0), NDIS(1), Support(2), Medical(3), Risks(4).
    await user.click(screen.getByRole('button', { name: 'Edit NDIS & Funding' }))

    // Jumped back to the NDIS & Funding step, with the value still there.
    expect(screen.getByLabelText('NDIS Number')).toHaveValue('431234567')
  })

  it('submits the same payload shape on final submit from Review', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await advanceToReview(user)

    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({
      firstName: 'Jamie',
      lastName: 'Smith',
      ndisNumber: '431234567',
      planType: 'SelfManaged',
      supportRatio: 'SharedSupport',
      overnightSupport: 'None',
      overnightRatio: 'OneToOne',
      isRepeatClient: false,
      mobilityAidWheelchair: false,
      mobilityAidWalker: false,
      mobilitySupportOptions: [],
      isHighSupport: false,
      isIntensiveSupport: false,
      requiresHiLoBed: false,
      requiresHoist: false,
      requiresShowerChair: false,
      requiresCommode: false,
      requiresStandingMachine: false,
      serviceStreams: 'None',
    })
    // INTAKE-07 made the exact key set answer-set-dependent (hidden fields are unregistered and
    // excluded from the payload), so this is the BASELINE scenario's key set only — default
    // wizard answers (gender not set, fundingSource defaults to Ndis): genderSelfDescription is
    // excluded (gender isn't Other), fundingOrganisation is excluded (fundingSource is Ndis, not
    // Other) and fundingSource itself is included. See the "INTAKE-07 conditional payload
    // exclusion" describe block below for the Gender=Other and FundingSource=Other scenarios —
    // each asserts its OWN exact key set rather than one shared global list, per the ticket's
    // note that this test needed a conditional-aware, per-scenario update. No extraneous
    // wizard-only keys leak into the payload, and the array the form holds internally is
    // converted to the wire string before submit.
    expect(Object.keys(payload).sort()).toEqual(
      [
        'addressPostcode', 'addressState', 'addressStreet', 'addressSuburb',
        'behaviourRiskSummary', 'dateOfBirth', 'equipmentRequirements', 'firstName',
        'fundingSource', 'gender', 'hidpaSupportCategories', 'isHighSupport',
        'isIntensiveSupport', 'isRepeatClient', 'lastName', 'livingArrangement', 'medicalSummary', 'mobilityAidWalker',
        'mobilityAidWheelchair', 'mobilityNotes', 'mobilitySupportOptions', 'ndisNumber', 'notes', 'otherDiagnoses',
        'overnightRatio', 'overnightSupport', 'planEndDate', 'planStartDate', 'planType',
        'preferredName', 'preferredStaffId', 'primaryDiagnosis', 'region', 'requiresCommode', 'requiresHiLoBed',
        'requiresHoist', 'requiresShowerChair', 'requiresStandingMachine', 'riskEntries', 'serviceStreams',
        'supportRatio', 'transportRequirements',
      ].sort()
    )
  })

  it('submits a selected preferred-staff member, including a later change made before final submit (task 6d)', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')

    // Preferred Staff Member lives on the Identity step, alongside First/Last Name. Its
    // SearchableSelect trigger is wrapped in react-hook-form's <Controller>, which does not
    // forward FormField's aria-labelledby clone to the render-prop child, so it isn't reachable
    // via getByLabelText (a pre-existing gap, not introduced by this migration) — query the
    // combobox by its current displayed value instead (the 'None' item is explicitly in the
    // items list, so it's what shows before anything is picked).
    await user.click(screen.getByDisplayValue('None'))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))

    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review

    // Change the pick from the Review step (Edit link back to Identity) before ever submitting —
    // the linkage this feeds (upsert/downgrade against the compatibility matrix) is a
    // server-side concern (StaffCompatibilityLinkService), but the form must carry the changed
    // value through to submit for that to have anything to act on.
    await user.click(screen.getByRole('button', { name: /^Edit Identity/ }))
    await user.click(screen.getByDisplayValue('Alex Rivera'))
    await user.click(screen.getByRole('option', { name: 'Jo Lee' }))
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({ preferredStaffId: 'staff-2' })
  })

  // UX-01: Preferred Staff Member moved from a Dropdown `searchable` trigger to SearchableSelect —
  // one keyboard-only smoke test (open, arrow to an option, Enter) for the new combobox model.
  it('selects a preferred staff member via keyboard only (ArrowDown + Enter)', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    const preferredStaff = screen.getByDisplayValue('None')
    await user.click(preferredStaff)
    // First enabled option is 'None' (value '') — one more ArrowDown reaches the first staff entry.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(preferredStaff).toHaveValue('Alex Rivera')
  })
})

describe('ParticipantCreatePage — INTAKE-05 gender self-description reveal', () => {
  it('does not show the self-description field until Gender is set to Other', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    expect(screen.queryByLabelText(/Gender Self-Description/i)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Gender'), 'Other')
    expect(screen.getByLabelText(/Gender Self-Description/i)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Gender'), 'NonBinary')
    expect(screen.queryByLabelText(/Gender Self-Description/i)).not.toBeInTheDocument()
  })

  it('blocks Next on the Identity step when Gender is Other but self-description is empty', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.selectOptions(screen.getByLabelText('Gender'), 'Other')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/gender self-description/i)
    expect(screen.queryByLabelText('NDIS Number')).not.toBeInTheDocument()
  })

  it('submits gender and genderSelfDescription in the payload', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.selectOptions(screen.getByLabelText('Gender'), 'Other')
    await user.type(screen.getByLabelText(/Gender Self-Description/i), 'Genderfluid')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      gender: 'Other',
      genderSelfDescription: 'Genderfluid',
    })
  })
})

describe('ParticipantCreatePage — FUND-01 NDIS plan dates', () => {
  it('submits planStartDate and planEndDate entered on the NDIS & Funding step', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding

    await user.type(screen.getByLabelText('Plan Start Date'), '2026-01-01')
    await user.type(screen.getByLabelText('Plan End Date'), '2026-12-31')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      planStartDate: '2026-01-01',
      planEndDate: '2026-12-31',
    })
  })
})

describe('ParticipantCreatePage — FUND-02 funding source gating (INTAKE-07 engine)', () => {
  async function goToNdisStep(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
  }

  it('defaults to Ndis: shows the NDIS plan fields, hides Funding Organisation', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await goToNdisStep(user)

    expect(screen.getByLabelText('NDIS Number')).toBeInTheDocument()
    expect(screen.getByLabelText('Plan Start Date')).toBeInTheDocument()
    expect(screen.getByLabelText('Plan End Date')).toBeInTheDocument()
    // Plan Type's control is a Dropdown wrapped in react-hook-form's <Controller>, which (like
    // preferredStaffId elsewhere in this file) doesn't forward FormField's aria-labelledby clone
    // — a pre-existing gap, not introduced here — so its presence is checked via the visible
    // label text rather than getByLabelText.
    expect(screen.getByText(/Plan Type/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Funding Organisation/i)).not.toBeInTheDocument()
  })

  it('switching to Other hides the NDIS plan fields and reveals Funding Organisation; switching back restores Ndis', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await goToNdisStep(user)

    await user.selectOptions(screen.getByLabelText('Funding Source *'), 'Other')

    expect(screen.queryByLabelText('NDIS Number')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Plan Start Date')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Plan End Date')).not.toBeInTheDocument()
    expect(screen.queryByText(/Plan Type/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Funding Organisation/i)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Funding Source *'), 'Ndis')

    expect(screen.getByLabelText('NDIS Number')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Funding Organisation/i)).not.toBeInTheDocument()
  })

  it('blocks Next on the NDIS & Funding step when funding source is Other but specify is empty', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await goToNdisStep(user)

    await user.selectOptions(screen.getByLabelText('Funding Source *'), 'Other')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/please specify the funding organisation/i)
    expect(screen.queryByRole('button', { name: 'Hi-Lo Bed' })).not.toBeInTheDocument() // still on NDIS step, not Support
  })

  it('submits fundingSource and fundingOrganisation when Other', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await goToNdisStep(user)

    await user.selectOptions(screen.getByLabelText('Funding Source *'), 'Other')
    await user.type(screen.getByLabelText(/Funding Organisation/i), 'Self-funded')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      fundingSource: 'Other',
      fundingOrganisation: 'Self-funded',
    })
  })
})

describe('ParticipantCreatePage — FUND-02 review-round fix: confirm before losing Funding Organisation text', () => {
  // Controller ruling (review round 1): the server unconditionally clears FundingOrganisation on
  // save whenever FundingSource != Other, so a same-session Other -> Ndis switch would silently
  // lose typed specify text with no warning unless the frontend guards it.
  async function goToNdisStepWithOtherAndText(user: ReturnType<typeof userEvent.setup>, text = 'Self-funded') {
    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.selectOptions(screen.getByLabelText('Funding Source *'), 'Other')
    await user.type(screen.getByLabelText(/Funding Organisation/i), text)
  }

  it('does not prompt when switching away from Other while the specify field is blank', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.selectOptions(screen.getByLabelText('Funding Source *'), 'Other')
    // Funding Organisation left blank — nothing to lose.
    await user.selectOptions(screen.getByLabelText('Funding Source *'), 'Ndis')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('NDIS Number')).toBeInTheDocument() // switch applied immediately
  })

  it('prompts when switching away from Other with non-blank text, and Cancel reverts the select with the text intact', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await goToNdisStepWithOtherAndText(user)

    await user.selectOptions(screen.getByLabelText('Funding Source *'), 'Ndis')

    const dialog = screen.getByRole('dialog', { name: /switch away from other funding source/i })
    expect(dialog).toBeInTheDocument()
    // The switch has NOT applied yet — still on Other underneath the dialog, text untouched.
    expect(screen.getByLabelText(/Funding Organisation/i)).toHaveValue('Self-funded')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Funding Organisation/i)).toHaveValue('Self-funded')
    expect(screen.queryByLabelText('NDIS Number')).not.toBeInTheDocument() // still Other, nothing lost
  })

  it('Confirm applies the switch, hiding/excluding Funding Organisation from the payload', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await goToNdisStepWithOtherAndText(user)

    await user.selectOptions(screen.getByLabelText('Funding Source *'), 'Ndis')
    const dialog = screen.getByRole('dialog', { name: /switch away from other funding source/i })
    await user.click(within(dialog).getByRole('button', { name: 'Switch and clear' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('NDIS Number')).toBeInTheDocument() // now Ndis
    expect(screen.queryByLabelText(/Funding Organisation/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload.fundingSource).toBe('Ndis')
    // INTAKE-07 exclusion still applies — the abandoned text never reaches the wire at all
    // (the server-side clear this guard warns about is a defence-in-depth backstop, not the
    // frontend's own path to loss).
    expect('fundingOrganisation' in payload).toBe(false)
  })
})

describe('ParticipantCreatePage — INTAKE-07 conditional payload exclusion (exact key sets per scenario)', () => {
  // Each scenario asserts its OWN exact key set rather than one shared global list — per the
  // ticket's note that the pre-existing single-list exact-keys test needed a conditional-aware,
  // per-scenario update once hidden fields became genuinely excluded from the payload.

  it('Gender=Other: exact payload key set is the baseline plus genderSelfDescription', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.selectOptions(screen.getByLabelText('Gender'), 'Other')
    await user.type(screen.getByLabelText(/Gender Self-Description/i), 'Genderfluid')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(Object.keys(payload).sort()).toEqual(
      [
        'addressPostcode', 'addressState', 'addressStreet', 'addressSuburb',
        'behaviourRiskSummary', 'dateOfBirth', 'equipmentRequirements', 'firstName',
        'fundingSource', 'gender', 'genderSelfDescription', 'hidpaSupportCategories', 'isHighSupport',
        'isIntensiveSupport', 'isRepeatClient', 'lastName', 'livingArrangement', 'medicalSummary', 'mobilityAidWalker',
        'mobilityAidWheelchair', 'mobilityNotes', 'mobilitySupportOptions', 'ndisNumber', 'notes', 'otherDiagnoses',
        'overnightRatio', 'overnightSupport', 'planEndDate', 'planStartDate', 'planType',
        'preferredName', 'preferredStaffId', 'primaryDiagnosis', 'region', 'requiresCommode', 'requiresHiLoBed',
        'requiresHoist', 'requiresShowerChair', 'requiresStandingMachine', 'riskEntries', 'serviceStreams',
        'supportRatio', 'transportRequirements',
      ].sort()
    )
  })

  it('FundingSource=Other: exact payload key set drops the NDIS plan fields and adds fundingOrganisation', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding

    await user.selectOptions(screen.getByLabelText('Funding Source *'), 'Other')
    await user.type(screen.getByLabelText(/Funding Organisation/i), 'Self-funded')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(Object.keys(payload).sort()).toEqual(
      [
        'addressPostcode', 'addressState', 'addressStreet', 'addressSuburb',
        'behaviourRiskSummary', 'dateOfBirth', 'equipmentRequirements', 'firstName',
        'fundingOrganisation', 'fundingSource', 'gender', 'hidpaSupportCategories', 'isHighSupport',
        'isIntensiveSupport', 'isRepeatClient', 'lastName', 'livingArrangement', 'medicalSummary', 'mobilityAidWalker',
        'mobilityAidWheelchair', 'mobilityNotes', 'mobilitySupportOptions', 'notes', 'otherDiagnoses',
        'overnightRatio', 'overnightSupport', 'preferredName', 'preferredStaffId', 'primaryDiagnosis', 'region',
        'requiresCommode', 'requiresHiLoBed', 'requiresHoist', 'requiresShowerChair',
        'requiresStandingMachine', 'riskEntries', 'serviceStreams', 'supportRatio', 'transportRequirements',
      ].sort()
    )
  })

  it('LivingArrangement=Family: exact payload key set adds the Family fields and shared notes', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.selectOptions(screen.getByLabelText('Living Arrangement'), 'Family')
    await user.type(screen.getByLabelText(/Main Support Person/i), 'Jane Citizen')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({ livingArrangement: 'Family', mainSupportPersonName: 'Jane Citizen' })
    expect(Object.keys(payload).sort()).toEqual(
      [
        'addressPostcode', 'addressState', 'addressStreet', 'addressSuburb',
        'behaviourRiskSummary', 'dateOfBirth', 'equipmentRequirements', 'firstName',
        'fundingSource', 'gender', 'hidpaSupportCategories', 'isHighSupport',
        'isIntensiveSupport', 'isRepeatClient', 'lastName', 'livingArrangement', 'livingArrangementNotes',
        'mainSupportPersonName', 'mainSupportPersonRelationship', 'medicalSummary', 'mobilityAidWalker',
        'mobilityAidWheelchair', 'mobilityNotes', 'mobilitySupportOptions', 'ndisNumber', 'notes', 'otherDiagnoses',
        'othersLivingInAccommodation', 'overnightRatio', 'overnightSupport', 'planEndDate', 'planStartDate', 'planType',
        'preferredName', 'preferredStaffId', 'primaryDiagnosis', 'region', 'requiresCommode', 'requiresHiLoBed',
        'requiresHoist', 'requiresShowerChair', 'requiresStandingMachine', 'residentialInfo', 'riskEntries',
        'serviceStreams', 'supportRatio', 'transportRequirements',
      ].sort()
    )
  })

  it('LivingArrangement=Independent, LivesWithOthers=false: whoLivesWith stays excluded from the payload', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.selectOptions(screen.getByLabelText('Living Arrangement'), 'Independent')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload.livingArrangement).toBe('Independent')
    expect(payload.livesWithOthers).toBe(false)
    expect('whoLivesWith' in payload).toBe(false)
    expect('livingArrangementNotes' in payload).toBe(true) // shared field — visible for any arrangement
  })

  it('LivingArrangement=Independent, LivesWithOthers=true: exact payload key set adds livesWithOthers and whoLivesWith', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.selectOptions(screen.getByLabelText('Living Arrangement'), 'Independent')
    await user.click(screen.getByLabelText('Lives With Others'))
    await user.type(screen.getByLabelText(/Who They Live With/i), 'Housemates')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({ livingArrangement: 'Independent', livesWithOthers: true, whoLivesWith: 'Housemates' })
    expect(Object.keys(payload).sort()).toEqual(
      [
        'addressPostcode', 'addressState', 'addressStreet', 'addressSuburb',
        'behaviourRiskSummary', 'dateOfBirth', 'equipmentRequirements', 'firstName',
        'fundingSource', 'gender', 'hidpaSupportCategories', 'isHighSupport',
        'isIntensiveSupport', 'isRepeatClient', 'lastName', 'livesWithOthers', 'livingArrangement', 'livingArrangementNotes',
        'medicalSummary', 'mobilityAidWalker',
        'mobilityAidWheelchair', 'mobilityNotes', 'mobilitySupportOptions', 'ndisNumber', 'notes', 'otherDiagnoses',
        'overnightRatio', 'overnightSupport', 'planEndDate', 'planStartDate', 'planType',
        'preferredName', 'preferredStaffId', 'primaryDiagnosis', 'region', 'requiresCommode', 'requiresHiLoBed',
        'requiresHoist', 'requiresShowerChair', 'requiresStandingMachine', 'riskEntries', 'serviceStreams',
        'supportRatio', 'transportRequirements', 'whoLivesWith',
      ].sort()
    )
  })

  it('blocks Next on the Identity step when LivingArrangement=Independent, LivesWithOthers=true, but who-they-live-with is empty', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.selectOptions(screen.getByLabelText('Living Arrangement'), 'Independent')
    await user.click(screen.getByLabelText('Lives With Others'))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/please specify who the participant lives with/i)
    expect(screen.queryByLabelText('NDIS Number')).not.toBeInTheDocument() // still on Identity step
  })

  it('LivingArrangement=SupportedAccommodation: exact payload key set adds the SIL/accommodation fields', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.selectOptions(screen.getByLabelText('Living Arrangement'), 'SupportedAccommodation')
    await user.type(screen.getByLabelText(/SIL Provider Name/i), 'Sunrise SIL Services')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({ livingArrangement: 'SupportedAccommodation', silProviderName: 'Sunrise SIL Services' })
    expect(Object.keys(payload).sort()).toEqual(
      [
        'accommodationType', 'addressPostcode', 'addressState', 'addressStreet', 'addressSuburb',
        'behaviourRiskSummary', 'dateOfBirth', 'equipmentRequirements', 'firstName',
        'fundingSource', 'gender', 'hidpaSupportCategories', 'isHighSupport',
        'isIntensiveSupport', 'isRepeatClient', 'lastName', 'livingArrangement', 'livingArrangementNotes',
        'medicalSummary', 'mobilityAidWalker',
        'mobilityAidWheelchair', 'mobilityNotes', 'mobilitySupportOptions', 'ndisNumber', 'notes', 'otherDiagnoses',
        'onSiteSupportHours', 'overnightRatio', 'overnightSupport', 'planEndDate', 'planStartDate', 'planType',
        'preferredName', 'preferredStaffId', 'primaryDiagnosis', 'region', 'requiresCommode', 'requiresHiLoBed',
        'requiresHoist', 'requiresShowerChair', 'requiresStandingMachine', 'riskEntries', 'serviceStreams',
        'silProviderContactPhone', 'silProviderName', 'supportRatio', 'transportRequirements',
      ].sort()
    )
  })

  it('blocks Next on the Identity step for an invalid postcode', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.type(screen.getByLabelText('Postcode'), '123')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/postcode must be exactly 4 digits/i)
  })

  it('submits a valid address', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('First Name *'), 'Jamie')
    await user.type(screen.getByLabelText('Last Name *'), 'Smith')
    await user.type(screen.getByLabelText('Street'), '12 Example Street')
    await user.type(screen.getByLabelText('Suburb'), 'Fortitude Valley')
    await user.selectOptions(screen.getByLabelText('State'), 'QLD')
    await user.type(screen.getByLabelText('Postcode'), '4006')
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      addressStreet: '12 Example Street', addressSuburb: 'Fortitude Valley', addressState: 'QLD', addressPostcode: '4006',
    })
  })
})

async function advanceToMedical(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('First Name *'), 'Jamie')
  await user.type(screen.getByLabelText('Last Name *'), 'Smith')
  await user.click(screen.getByRole('button', { name: 'Next' })) // -> NDIS & Funding
  await user.click(screen.getByRole('button', { name: 'Next' })) // -> Support Needs & Equipment
  await user.click(screen.getByRole('button', { name: 'Next' })) // -> Medical
}

async function finishWizard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
  await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
  await user.click(screen.getByRole('button', { name: /create participant/i }))
}

describe('ParticipantCreatePage — DIAG-01 diagnoses (primary + other)', () => {
  it('shows the specify field only when Primary Diagnosis is "Other — specify"', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    expect(screen.queryByLabelText(/Specify Primary Diagnosis/i)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Other — specify')
    expect(screen.getByLabelText(/Specify Primary Diagnosis/i)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Epilepsy')
    expect(screen.queryByLabelText(/Specify Primary Diagnosis/i)).not.toBeInTheDocument()
  })

  it('blocks Next on the Medical step when Other — specify is selected but not specified', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Other — specify')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/please specify the primary diagnosis/i)
  })

  it('submits a curated Primary Diagnosis directly', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Cerebral Palsy')
    await finishWizard(user)

    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({ primaryDiagnosis: 'Cerebral Palsy' })
  })

  it('submits a typed "Other — specify" Primary Diagnosis collapsed to the one backend field', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Other — specify')
    await user.type(screen.getByLabelText(/Specify Primary Diagnosis/i), 'Rett Syndrome')
    await finishWizard(user)

    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload.primaryDiagnosis).toBe('Rett Syndrome')
    expect('primaryDiagnosisOther' in payload).toBe(false)
  })

  it('checkbox-selects a curated Other Diagnoses entry and adds a custom entry via the add input', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    await user.click(screen.getByLabelText('Down Syndrome'))
    await user.type(screen.getByLabelText(/Other — specify a diagnosis to add/i), 'Rare Syndrome X')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Rare Syndrome X')).toBeInTheDocument()

    await finishWizard(user)

    expect(mockCreateMutateAsync.mock.calls[0][0].otherDiagnoses).toEqual(['Down Syndrome', 'Rare Syndrome X'])
  })

  it('removes a custom other-diagnosis entry via its remove button', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    await user.type(screen.getByLabelText(/Other — specify a diagnosis to add/i), 'Temp Entry')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Temp Entry')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Temp Entry' }))
    expect(screen.queryByText('Temp Entry')).not.toBeInTheDocument()
  })

  it('defaults otherDiagnoses to an empty array when nothing is selected', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)
    await finishWizard(user)

    expect(mockCreateMutateAsync.mock.calls[0][0].otherDiagnoses).toEqual([])
  })
})

describe('ParticipantCreatePage — DIAG-02 HIDPA support categories + epilepsy derivation', () => {
  it('submits hidpaSupportCategories as "None" by default', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)
    await finishWizard(user)

    expect(mockCreateMutateAsync.mock.calls[0][0].hidpaSupportCategories).toBe('None')
  })

  it('checking a HIDPA category submits it in the comma-separated wire format', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    await user.click(screen.getByLabelText('Complex Wound Care'))
    await finishWizard(user)

    expect(mockCreateMutateAsync.mock.calls[0][0].hidpaSupportCategories).toBe('ComplexWoundCare')
  })

  it('selecting Epilepsy as Primary Diagnosis pre-selects Epilepsy and Seizure Management by default', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    expect(screen.getByLabelText('Epilepsy and Seizure Management')).not.toBeChecked()

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Epilepsy')

    expect(screen.getByLabelText('Epilepsy and Seizure Management')).toBeChecked()
  })

  it('selecting Epilepsy via Other Diagnoses also triggers the default (not primary-only)', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    await user.click(screen.getByLabelText('Epilepsy')) // the Other Diagnoses checkbox, not the primary select
    expect(screen.getByLabelText('Epilepsy and Seizure Management')).toBeChecked()
  })

  it('the derived default is a DEFAULT not a lock: the user can untick it, and it survives further unrelated edits', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Epilepsy')
    expect(screen.getByLabelText('Epilepsy and Seizure Management')).toBeChecked()

    await user.click(screen.getByLabelText('Epilepsy and Seizure Management')) // untick
    expect(screen.getByLabelText('Epilepsy and Seizure Management')).not.toBeChecked()

    // Further, unrelated edits on the same step (`when` stays true — no new false->true
    // transition) must not silently re-force it back on.
    await user.click(screen.getByLabelText('Down Syndrome'))
    expect(screen.getByLabelText('Epilepsy and Seizure Management')).not.toBeChecked()

    await finishWizard(user)
    expect(mockCreateMutateAsync.mock.calls[0][0].hidpaSupportCategories).not.toContain('EpilepsyManagement')
  })

  it('re-selecting Epilepsy after deselecting it re-fires the default (each new transition is a fresh default)', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Epilepsy')
    await user.click(screen.getByLabelText('Epilepsy and Seizure Management')) // untick
    expect(screen.getByLabelText('Epilepsy and Seizure Management')).not.toBeChecked()

    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Cerebral Palsy') // when: false
    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Epilepsy') // when: false -> true again

    expect(screen.getByLabelText('Epilepsy and Seizure Management')).toBeChecked()
  })

  it('does not pre-select Epilepsy Management when a manual selection is made without an epilepsy diagnosis ever being set', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToMedical(user)

    await user.click(screen.getByLabelText('Epilepsy and Seizure Management')) // manual tick, no diagnosis set
    await user.selectOptions(screen.getByLabelText('Primary Diagnosis'), 'Cerebral Palsy') // `when` never transitions

    expect(screen.getByLabelText('Epilepsy and Seizure Management')).toBeChecked() // untouched by the engine either way
  })
})

describe('ParticipantCreatePage — INTAKE-09 risk entries (create mode)', () => {
  async function advanceToRisks(user: ReturnType<typeof userEvent.setup>) {
    await advanceToMedical(user)
    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Risks & Consents
  }

  it('adds a row, fills it in, and submits it as part of the create payload', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToRisks(user)

    await user.click(screen.getByRole('button', { name: /add risk entry/i }))
    await user.selectOptions(screen.getByLabelText('At Risk'), 'Staff')
    await user.type(screen.getByPlaceholderText('Describe the risk...'), 'Risk of aggression towards staff.')
    await user.type(screen.getByPlaceholderText(/how this risk is mitigated/i), 'Two-person support.')

    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload.riskEntries).toEqual([
      { atRiskParty: 'Staff', description: 'Risk of aggression towards staff.', mitigationNotes: 'Two-person support.' },
    ])
  })

  it('supports adding more than one row and removing one', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToRisks(user)

    await user.click(screen.getByRole('button', { name: /add risk entry/i }))
    await user.type(screen.getAllByPlaceholderText('Describe the risk...')[0], 'First risk.')
    await user.click(screen.getByRole('button', { name: /add risk entry/i }))
    await user.type(screen.getAllByPlaceholderText('Describe the risk...')[1], 'Second risk.')

    expect(screen.getAllByPlaceholderText('Describe the risk...')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /remove risk entry 1/i }))

    expect(screen.getAllByPlaceholderText('Describe the risk...')).toHaveLength(1)
    expect(screen.getByPlaceholderText('Describe the risk...')).toHaveValue('Second risk.')
  })

  it('blocks Next when a row is added with a blank description', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToRisks(user)

    await user.click(screen.getByRole('button', { name: /add risk entry/i }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // A row-level error renders inline under that row's Description field (FormField's own
    // error text, not the top-of-step alert summary — a nested array-item error doesn't
    // collapse onto the whole `riskEntries` field the way a flat field's error would).
    expect(screen.getByText('Description is required')).toBeInTheDocument()
    // Still on the Risks & Consents step — Review's read-only content hasn't appeared.
    expect(screen.getByRole('button', { name: /add risk entry/i })).toBeInTheDocument()
  })

  it('rows are optional overall — submitting with zero rows sends an empty array', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await advanceToRisks(user)

    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Review, no rows added
    await user.click(screen.getByRole('button', { name: /create participant/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0].riskEntries).toEqual([])
  })

  it('edit mode does not render the add-rows UI, and points to the detail page\'s Risks section instead', async () => {
    mockUseParticipant.mockReturnValue({
      data: {
        id: 'participant-1', firstName: 'Jamie', lastName: 'Smith', isActive: true,
        overnightSupport: 'None', overnightRatio: 'OneToOne', supportRatio: 'SharedSupport', planType: 'SelfManaged',
      },
      isLoading: false,
    })
    const router = createMemoryRouter(
      [{ path: '/participants/:id/edit', element: <ParticipantCreatePage /> }],
      { initialEntries: ['/participants/participant-1/edit'] },
    )
    const user = userEvent.setup()
    render(<RouterProvider router={router} />)

    // Edit mode makes every step immediately explorable — jump straight to the Risks pill.
    await user.click(within(stepNav()).getByRole('button', { name: /risks/i }))

    expect(screen.queryByRole('button', { name: /add risk entry/i })).not.toBeInTheDocument()
    expect(screen.getByText(/risk entries are managed from the/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /risks section/i })).toHaveAttribute('href', '/participants/participant-1')
  })
})
