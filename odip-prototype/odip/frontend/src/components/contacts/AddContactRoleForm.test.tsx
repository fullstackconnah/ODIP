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
  it('create mode: adds a new-person contact and calls onSaved after the nested-CRUD create call', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<AddContactRoleForm participantId="participant-1" mode="create" onSaved={onSaved} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('radio', { name: 'New person' }))
    await user.type(screen.getByLabelText('First name *'), 'Denise')
    await user.type(screen.getByLabelText('Last name'), 'Wilson')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const call = mockCreateMutateAsync.mock.calls[0][0]
    expect(call.participantId).toBe('participant-1')
    expect(call.data).toMatchObject({ newPersonFirstName: 'Denise', newPersonLastName: 'Wilson', personId: null, roleType: 'NextOfKin' })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('create mode: adds an existing-person contact via the SearchableSelect picker', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<AddContactRoleForm participantId="participant-1" mode="create" onSaved={onSaved} onCancel={vi.fn()} />)

    await user.click(screen.getByPlaceholderText('Search people…'))
    await user.click(screen.getByRole('option', { name: 'David Brown' }))
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0].data).toMatchObject({ personId: 'person-2' })
    expect(onSaved).toHaveBeenCalledTimes(1)
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
  // A ProviderContact role can only be reached with contactRoleGateError already failing when its
  // participant is Agency-managed and it isn't yet flagged as a registered provider (the Dropdown
  // itself blocks *picking* ProviderContact fresh in that state — see Dropdown.tsx's
  // handleSelect — so this exercises the case where a role is already ProviderContact, e.g. an
  // Agency-managed participant's existing contact opened for edit).
  it('surfaces the ProviderContact/Agency-managed gate error and blocks saving until resolved', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ planType: 'AgencyManaged' }) })
    const role = makeRole({ roleType: 'ProviderContact', registeredProviderFlag: false })
    render(<AddContactRoleForm participantId="participant-1" mode="edit" role={role} onSaved={onSaved} onCancel={vi.fn()} />)

    // Renders twice — once as the Role type field's hint, once as the standalone alert
    // paragraph (same pre-existing duplication ContactsTab/the wizard's own row exhibit).
    expect(screen.getAllByText('Agency-managed participants can only record registered-provider contacts.').length).toBeGreaterThan(0)

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
})
