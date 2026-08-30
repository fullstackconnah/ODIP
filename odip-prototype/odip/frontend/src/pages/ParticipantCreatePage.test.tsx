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
    // Same DTO shape as before the wizard (plus the intentional serviceStreams addition — 29
    // fields -> 30): no extraneous wizard-only keys leak into the payload, and the array the
    // form holds internally is converted to the wire string before submit.
    expect(Object.keys(payload).sort()).toEqual(
      [
        'behaviourRiskSummary', 'dateOfBirth', 'equipmentRequirements', 'firstName',
        'fundingOrganisation', 'isHighSupport', 'isIntensiveSupport', 'isRepeatClient',
        'lastName', 'medicalSummary', 'mobilityAidWalker', 'mobilityAidWheelchair',
        'mobilityNotes', 'mobilitySupportOptions', 'ndisNumber', 'notes', 'overnightRatio',
        'overnightSupport', 'planType', 'preferredName', 'preferredStaffId', 'region',
        'requiresCommode', 'requiresHiLoBed', 'requiresHoist', 'requiresShowerChair',
        'requiresStandingMachine', 'serviceStreams', 'supportRatio', 'transportRequirements',
      ].sort()
    )
  })
})
