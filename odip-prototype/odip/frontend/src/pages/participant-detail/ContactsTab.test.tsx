import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContactsTab from './ContactsTab'
import type { ParticipantContactRoleDto, PersonDto } from '@/api/types/contacts'
import type { ParticipantDetailDto } from '@/api/types/participants'

const {
  mockUseParticipant, mockUseParticipantContactRoles, mockUsePersons,
  mockCreateMutateAsync, mockUpdateMutateAsync, mockDeleteMutateAsync,
} = vi.hoisted(() => ({
  mockUseParticipant: vi.fn(),
  mockUseParticipantContactRoles: vi.fn(() => ({ data: [] as ParticipantContactRoleDto[], isLoading: false })),
  mockUsePersons: vi.fn(() => ({ data: [] as PersonDto[] })),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — Modal, FormField, ConfirmDialog, Dropdown, SearchableSelect,
// DataTable, EmptyState are the real components, mirroring RiskEntriesSection.test.tsx's approach.
vi.mock('@/api/hooks', () => ({
  useParticipant: mockUseParticipant,
  useParticipantContactRoles: mockUseParticipantContactRoles,
  usePersons: mockUsePersons,
  useCreateContactRole: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateContactRole: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeleteContactRole: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
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

function makePerson(overrides: Partial<PersonDto> = {}): PersonDto {
  return {
    id: 'person-2', firstName: 'David', lastName: 'Brown', fullName: 'David Brown', phone: null,
    mobile: '0412 345 002', email: null, addressLine: null, suburb: null, state: null, postcode: null,
    organisation: null, dateOfBirth: null, notes: null, activeRoleCount: 0,
    ...overrides,
  }
}

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

beforeEach(() => {
  mockCreateMutateAsync.mockClear()
  mockUpdateMutateAsync.mockClear()
  mockDeleteMutateAsync.mockClear()
  mockUseParticipant.mockReturnValue({ data: makeParticipant() })
  mockUseParticipantContactRoles.mockReturnValue({ data: [], isLoading: false })
  mockUsePersons.mockReturnValue({ data: [makePerson()] })
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('ContactsTab', () => {
  it('renders an empty state when there are no contacts', () => {
    render(<ContactsTab participantId="participant-1" />)
    expect(screen.getByText('No contacts recorded')).toBeInTheDocument()
  })

  it('renders a contact role row with person, role, and status', () => {
    mockUseParticipantContactRoles.mockReturnValue({ data: [makeRole()], isLoading: false })

    render(<ContactsTab participantId="participant-1" />)

    expect(screen.getByText('Karen Johnson')).toBeInTheDocument()
    expect(screen.getByText('Next of Kin')).toBeInTheDocument()
    expect(screen.getByText('Primary')).toBeInTheDocument()
    expect(screen.getByText('Mother')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('hides Add/Edit/Remove actions for a ReadOnly user', () => {
    setUserRole('ReadOnly')
    mockUseParticipantContactRoles.mockReturnValue({ data: [makeRole()], isLoading: false })

    render(<ContactsTab participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: /add contact/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('adds a new-person contact and submits the mapped payload', async () => {
    const user = userEvent.setup()
    render(<ContactsTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add contact/i })[0])
    // PF-6: the person picker is now a single search-first name field — "New person" is reached
    // via "None of these — create new" rather than an upfront Existing/New toggle.
    await user.click(screen.getByPlaceholderText('Search people…'))
    await user.click(screen.getByRole('button', { name: /none of these/i }))
    await user.type(screen.getByLabelText('First name *'), 'Denise')
    await user.type(screen.getByLabelText('Last name'), 'Wilson')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const call = mockCreateMutateAsync.mock.calls[0][0]
    expect(call.participantId).toBe('participant-1')
    expect(call.data).toMatchObject({
      newPersonFirstName: 'Denise', newPersonLastName: 'Wilson', personId: null, roleType: 'NextOfKin',
    })
  })

  it('adds an existing-person contact via the search-first picker', async () => {
    const user = userEvent.setup()
    render(<ContactsTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add contact/i })[0])
    await user.click(screen.getByPlaceholderText('Search people…'))
    await user.click(screen.getByRole('option', { name: /David Brown/ }))
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0].data).toMatchObject({ personId: 'person-2' })
  })

  it('blocks save when no person is selected', async () => {
    const user = userEvent.setup()
    render(<ContactsTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add contact/i })[0])
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(screen.getByText('Select a person')).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  // PF-5: the single-select Role type Dropdown is now a multi-select checkbox group.
  it('disables the Plan Manager checkbox for a non-plan-managed participant', async () => {
    const user = userEvent.setup()
    render(<ContactsTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add contact/i })[0])
    expect(screen.getByRole('checkbox', { name: 'Plan Manager' })).toBeDisabled()
  })

  it('opens the edit modal pre-filled with the role\'s existing values', async () => {
    const user = userEvent.setup()
    mockUseParticipantContactRoles.mockReturnValue({
      data: [makeRole({ roleType: 'EmergencyContact', priorityOrder: 1, relationshipToParticipant: 'Father' })],
      isLoading: false,
    })

    render(<ContactsTab participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByDisplayValue('Father')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
  })

  it('removes a contact role via the confirm dialog', async () => {
    const user = userEvent.setup()
    mockUseParticipantContactRoles.mockReturnValue({ data: [makeRole()], isLoading: false })

    render(<ContactsTab participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog', { name: /remove this contact role/i })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(mockDeleteMutateAsync).toHaveBeenCalledWith({ id: 'role-1', participantId: 'participant-1' })
  })
})
