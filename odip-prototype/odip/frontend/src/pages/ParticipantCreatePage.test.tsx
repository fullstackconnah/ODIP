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
        'behaviourRiskSummary', 'dateOfBirth', 'equipmentRequirements', 'firstName',
        'fundingSource', 'gender', 'isHighSupport',
        'isIntensiveSupport', 'isRepeatClient', 'lastName', 'medicalSummary', 'mobilityAidWalker',
        'mobilityAidWheelchair', 'mobilityNotes', 'mobilitySupportOptions', 'ndisNumber', 'notes',
        'overnightRatio', 'overnightSupport', 'planEndDate', 'planStartDate', 'planType',
        'preferredName', 'preferredStaffId', 'region', 'requiresCommode', 'requiresHiLoBed',
        'requiresHoist', 'requiresShowerChair', 'requiresStandingMachine', 'serviceStreams',
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
    // Dropdown trigger is wrapped in react-hook-form's <Controller>, which does not forward
    // FormField's aria-labelledby clone to the render-prop Dropdown, so it isn't reachable via
    // getByLabelText (a pre-existing gap, not introduced here) — query the trigger button by its
    // own visible text instead.
    await user.click(screen.getByRole('button', { name: 'None' }))
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
    await user.click(screen.getByRole('button', { name: 'Alex Rivera' }))
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
        'behaviourRiskSummary', 'dateOfBirth', 'equipmentRequirements', 'firstName',
        'fundingSource', 'gender', 'genderSelfDescription', 'isHighSupport',
        'isIntensiveSupport', 'isRepeatClient', 'lastName', 'medicalSummary', 'mobilityAidWalker',
        'mobilityAidWheelchair', 'mobilityNotes', 'mobilitySupportOptions', 'ndisNumber', 'notes',
        'overnightRatio', 'overnightSupport', 'planEndDate', 'planStartDate', 'planType',
        'preferredName', 'preferredStaffId', 'region', 'requiresCommode', 'requiresHiLoBed',
        'requiresHoist', 'requiresShowerChair', 'requiresStandingMachine', 'serviceStreams',
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
        'behaviourRiskSummary', 'dateOfBirth', 'equipmentRequirements', 'firstName',
        'fundingOrganisation', 'fundingSource', 'gender', 'isHighSupport',
        'isIntensiveSupport', 'isRepeatClient', 'lastName', 'medicalSummary', 'mobilityAidWalker',
        'mobilityAidWheelchair', 'mobilityNotes', 'mobilitySupportOptions', 'notes',
        'overnightRatio', 'overnightSupport', 'preferredName', 'preferredStaffId', 'region',
        'requiresCommode', 'requiresHiLoBed', 'requiresHoist', 'requiresShowerChair',
        'requiresStandingMachine', 'serviceStreams', 'supportRatio', 'transportRequirements',
      ].sort()
    )
  })
})
