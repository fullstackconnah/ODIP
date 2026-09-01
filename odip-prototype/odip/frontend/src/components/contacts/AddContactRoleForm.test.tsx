import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddContactRoleForm from './AddContactRoleForm'
import type { ParticipantContactRoleDto, PersonDto } from '@/api/types/contacts'
import type { ParticipantDetailDto } from '@/api/types/participants'

const {
  mockUseParticipant, mockUsePersons, mockCreateMutateAsync, mockUpdateMutateAsync,
} = vi.hoisted(() => ({
  mockUseParticipant: vi.fn(),
  mockUsePersons: vi.fn(() => ({ data: [] as PersonDto[] })),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipant: mockUseParticipant,
  usePersons: mockUsePersons,
  useCreateContactRole: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateContactRole: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
}))

function makeParticipant(overrides: Partial<ParticipantDetailDto> = {}): ParticipantDetailDto {
  return {
    id: 'participant-1', firstName: 'Sophie', lastName: 'Brown', fullName: 'Sophie Brown',
    planType: 'SelfManaged', isActive: true, isRepeatClient: false, mobilityAidWheelchair: false,
    mobilityAidWalker: false, isHighSupport: false, isIntensiveSupport: false, supportRatio: 'OneToOne',
    overnightSupport: 'None', hasRestrictivePracticeFlag: false, serviceStreams: 'None',
    hasActiveMedications: false, isDraft: false, fundingSource: 'Ndis', mobilitySupportOptions: [],
    otherDiagnoses: [], hidpaSupportCategories: 'None', overnightRatio: 'OneToOne',
    requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
    requiresStandingMachine: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ParticipantDetailDto
}

function makePerson(overrides: Partial<PersonDto> = {}): PersonDto {
  return {
    id: 'person-2', firstName: 'David', lastName: 'Brown', fullName: 'David Brown', phone: null,
    mobile: '0412 345 002', email: null, addressLine: null, suburb: null, state: null, postcode: null,
    organisation: null, dateOfBirth: null, notes: null, activeRoleCount: 0,
    ...overrides,
  }
}

function makeRole(overrides: Partial<ParticipantContactRoleDto> = {}): ParticipantContactRoleDto {
  return {
    id: 'role-1', participantId: 'participant-1', personId: 'person-1', personFullName: 'Karen Johnson',
    personPhone: null, personMobile: '0412 345 001', personEmail: 'karen.johnson@email.com.au', personOrganisation: null,
    roleType: 'NextOfKin', relationshipToParticipant: 'Mother', isPrimary: true, priorityOrder: null,
    authorisedForMedicalInfo: null, appointingTribunal: null, orderScopeDomains: [], orderStartDate: null,
    orderReviewDate: null, orderEndDate: null, nomineeScope: null, appointmentDate: null, reasonForAppointment: null,
    alternateRepresentativeName: null, fundingLineItemType: null, organisationName: null, registrationNumber: null,
    lastVisitDate: null, consentToShare: null, discipline: null, frequencyOfContact: null, websterPackFlag: null,
    roleTitle: null, registeredProviderFlag: null, scopeNotes: null, authorisationDocumentReference: null,
    preferredLanguage: null, startDate: null, endDate: null, status: 'Active', notes: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockCreateMutateAsync.mockClear()
  mockUpdateMutateAsync.mockClear()
  mockUseParticipant.mockReturnValue({ data: makeParticipant() })
  mockUsePersons.mockReturnValue({ data: [makePerson()] })
})

describe('AddContactRoleForm', () => {
  // PF-6: the person picker is now a single search-first name field (debounced usePersons(search))
  // instead of an upfront Existing/New ToggleGroup — "New person" is reached via "None of these —
  // create new" once the field is focused/typed into.
  it('create mode: adds a new-person contact via the "create new" fallback and calls onSaved', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    mockUsePersons.mockReturnValue({ data: [] })
    render(<AddContactRoleForm participantId="participant-1" mode="create" onSaved={onSaved} onCancel={vi.fn()} />)

    await user.click(screen.getByPlaceholderText('Search people…'))
    await user.click(screen.getByRole('button', { name: /none of these/i }))
    await user.type(screen.getByLabelText('First name *'), 'Denise')
    await user.type(screen.getByLabelText('Last name'), 'Wilson')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const call = mockCreateMutateAsync.mock.calls[0][0]
    expect(call.participantId).toBe('participant-1')
    expect(call.data).toMatchObject({ newPersonFirstName: 'Denise', newPersonLastName: 'Wilson', personId: null, roleType: 'NextOfKin' })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('create mode: typing a name surfaces matching existing people, and selecting one reuses that PersonId', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<AddContactRoleForm participantId="participant-1" mode="create" onSaved={onSaved} onCancel={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Search people…'), 'David')
    expect(await screen.findByRole('option', { name: /David Brown/ })).toBeInTheDocument()
    // "None of these — create new" stays reachable alongside a matching result, not just when
    // the search comes back empty.
    expect(screen.getByRole('button', { name: /none of these/i })).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /David Brown/ }))
    // Selecting a result switches out of search mode entirely — the result list and "create new"
    // fallback both disappear in favour of the selected person.
    expect(screen.queryByRole('button', { name: /none of these/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0].data).toMatchObject({ personId: 'person-2', newPersonFirstName: null })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('"None of these — create new" is always reachable, even before typing anything', async () => {
    render(<AddContactRoleForm participantId="participant-1" mode="create" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByPlaceholderText('Search people…')
    expect(screen.getByRole('button', { name: /none of these/i })).toBeInTheDocument()
  })

  it('create mode: blocks save and shows an error when no person is selected', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<AddContactRoleForm participantId="participant-1" mode="create" onSaved={onSaved} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(screen.getByText('Select a person')).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('Cancel calls onCancel without touching either mutation', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<AddContactRoleForm participantId="participant-1" mode="create" onSaved={vi.fn()} onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
  })

  it('edit mode: pre-fills from the given role and saves via the update (nested-CRUD) call', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const role = makeRole({ roleType: 'EmergencyContact', priorityOrder: 1, relationshipToParticipant: 'Father' })
    render(<AddContactRoleForm participantId="participant-1" mode="edit" role={role} onSaved={onSaved} onCancel={vi.fn()} />)

    expect(screen.getByDisplayValue('Father')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutateAsync.mock.calls[0][0]).toMatchObject({ id: 'role-1' })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  // PF-4 acceptance: "the same role-type gating (contactRoleGateError/availableContactRoleTypes)
  // applies here as on the Contacts tab — no duplicated, potentially-drifting gating logic."
  it('edit mode: surfaces the ProviderContact/Agency-managed gate error and blocks saving until resolved', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ planType: 'AgencyManaged' }) })
    const role = makeRole({ roleType: 'ProviderContact', registeredProviderFlag: false })
    render(<AddContactRoleForm participantId="participant-1" mode="edit" role={role} onSaved={onSaved} onCancel={vi.fn()} />)

    expect(screen.getByText('Agency-managed participants can only record registered-provider contacts.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save contact' }))
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()

    // Checking the box satisfies the gate — the second save attempt below clears the stale
    // error banner (same as ContactsTab's modalError) and actually persists this time.
    await user.click(screen.getByLabelText('Registered NDIS provider'))

    await user.click(screen.getByRole('button', { name: 'Save contact' }))
    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutateAsync.mock.calls[0][0].data).toMatchObject({ registeredProviderFlag: true })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  // ── PF-5: multi-role selection ──────────────────────────────────────────

  describe('PF-5: multi-role selection', () => {
    beforeEach(() => {
      mockUseParticipant.mockReturnValue({ data: makeParticipant({ planType: 'PlanManaged' }) })
    })

    it('selecting 2+ roles for one new person fans out to N create calls sharing one PersonId', async () => {
      const user = userEvent.setup()
      const onSaved = vi.fn()
      mockCreateMutateAsync
        .mockResolvedValueOnce({ data: { id: 'role-1', personId: 'person-new-1' } })
        .mockResolvedValueOnce({ data: { id: 'role-2', personId: 'person-new-1' } })
      render(<AddContactRoleForm participantId="participant-1" mode="create" onSaved={onSaved} onCancel={vi.fn()} />)

      await user.click(screen.getByPlaceholderText('Search people…'))
      await user.click(screen.getByRole('button', { name: /none of these/i }))
      await user.type(screen.getByLabelText('First name *'), 'Karen')
      await user.type(screen.getByLabelText('Last name'), 'Johnson')
      await user.click(screen.getByRole('checkbox', { name: 'Plan Manager' }))
      await user.click(screen.getByRole('button', { name: 'Save contact' }))

      expect(mockCreateMutateAsync).toHaveBeenCalledTimes(2)
      const [firstCall, secondCall] = mockCreateMutateAsync.mock.calls.map(c => c[0])
      const roleTypesSubmitted = [firstCall.data.roleType, secondCall.data.roleType].sort()
      expect(roleTypesSubmitted).toEqual(['NextOfKin', 'PlanManager'])
      // Person created on the first call only — the second call reuses that PersonId instead of
      // creating a second Person.
      expect(firstCall.data.personId).toBeNull()
      expect(firstCall.data.newPersonFirstName).toBe('Karen')
      expect(secondCall.data.personId).toBe('person-new-1')
      expect(secondCall.data.newPersonFirstName).toBeNull()
      expect(onSaved).toHaveBeenCalledTimes(1)
    })

    it('renders the union of the selected roles\' fields, each grouped under its own role heading', async () => {
      const user = userEvent.setup()
      render(<AddContactRoleForm participantId="participant-1" mode="create" onSaved={vi.fn()} onCancel={vi.fn()} />)

      // Default role is the first available (NextOfKin has no extra fields) — select Guardian too.
      await user.click(screen.getByRole('checkbox', { name: 'Guardian' }))

      expect(screen.getByText('Guardian details')).toBeInTheDocument()
      expect(screen.getByText('Appointing tribunal')).toBeInTheDocument()
      expect(screen.getByText('Order scope')).toBeInTheDocument()

      // Add a third role sharing a same-named field (organisationName) with a fourth — each gets
      // its OWN independent input rather than one shared field.
      await user.click(screen.getByRole('checkbox', { name: 'Plan Manager' }))
      await user.click(screen.getByRole('checkbox', { name: 'Specialist / Allied Health' }))
      expect(screen.getByText('Plan Manager details')).toBeInTheDocument()
      expect(screen.getByText('Specialist / Allied Health details')).toBeInTheDocument()
      const orgInputs = screen.getAllByLabelText('Organisation')
      expect(orgInputs).toHaveLength(2) // one for Plan Manager's block, one for Specialist's

      await user.type(orgInputs[0], 'Plan Partners')
      await user.type(orgInputs[1], 'OT Clinic')
      expect(orgInputs[0]).toHaveValue('Plan Partners')
      expect(orgInputs[1]).toHaveValue('OT Clinic')
    })

    it('the ProviderContact + Agency-managed gate fires when it is one of several selected roles', async () => {
      const user = userEvent.setup()
      const onSaved = vi.fn()
      mockUseParticipant.mockReturnValue({ data: makeParticipant({ planType: 'AgencyManaged' }) })
      render(<AddContactRoleForm participantId="participant-1" mode="create" onSaved={onSaved} onCancel={vi.fn()} />)

      await user.click(screen.getByPlaceholderText('Search people…'))
      await user.click(screen.getByRole('option', { name: /David Brown/ }))
      // Swap the row's default (NextOfKin, the first available role) for exactly the two roles
      // this test cares about.
      await user.click(screen.getByRole('checkbox', { name: 'Next of Kin' }))
      await user.click(screen.getByRole('checkbox', { name: 'Guardian' }))
      await user.click(screen.getByRole('checkbox', { name: 'Support Worker / Provider Contact' }))

      expect(screen.getByText(/Support Worker \/ Provider Contact:.*Agency-managed participants can only record registered-provider contacts\./)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Save contact' }))
      expect(mockCreateMutateAsync).not.toHaveBeenCalled()
      expect(onSaved).not.toHaveBeenCalled()

      // Checking the registered-provider box for that role's own block satisfies the gate for
      // ProviderContact specifically, without affecting the other selected role (Guardian).
      await user.click(screen.getByLabelText('Registered NDIS provider'))
      expect(screen.queryByText(/Agency-managed participants can only record registered-provider contacts\./)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Save contact' }))
      expect(mockCreateMutateAsync).toHaveBeenCalledTimes(2)
      const providerCall = mockCreateMutateAsync.mock.calls.find(c => c[0].data.roleType === 'ProviderContact')
      expect(providerCall?.[0].data).toMatchObject({ registeredProviderFlag: true })
    })
  })
})
