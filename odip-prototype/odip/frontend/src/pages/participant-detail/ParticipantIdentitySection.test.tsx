import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParticipantIdentitySection } from './ParticipantIdentitySection'
import type { ParticipantDetailDto } from '@/api/types/participants'
import type { StaffListDto } from '@/api/types/staff'

const { mockPatchMutateAsync, mockUseStaff } = vi.hoisted(() => ({
  mockPatchMutateAsync: vi.fn(),
  mockUseStaff: vi.fn((): { data: StaffListDto[] } => ({ data: [] })),
}))

vi.mock('@/api/hooks', () => ({
  usePatchParticipant: () => ({ mutateAsync: mockPatchMutateAsync, isPending: false }),
  useStaff: mockUseStaff,
}))

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

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

beforeEach(() => {
  mockPatchMutateAsync.mockReset()
  mockUseStaff.mockReturnValue({ data: [{ id: 'staff-1', fullName: 'Jamie Lee', isActive: true } as StaffListDto] })
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('ParticipantIdentitySection — permission gate', () => {
  it('shows no Edit button for a role without canWriteParticipantDetails', () => {
    setUserRole('SupportWorker')
    render(<ParticipantIdentitySection p={makeParticipant()} participantId="participant-1" canEdit={false} />)
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })

  it('shows an Edit button for a Coordinator', () => {
    render(<ParticipantIdentitySection p={makeParticipant()} participantId="participant-1" canEdit />)
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
  })
})

describe('ParticipantIdentitySection — edit/save cycle', () => {
  it('saves personalDetails (full group, including Country) and preferredStaff together in one PATCH', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    const p = makeParticipant({ firstName: 'Sophie', lastName: 'Brown', country: 'Australia', phone: '0400 000 000' })
    render(<ParticipantIdentitySection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.clear(screen.getByLabelText(/^First Name/))
    await user.type(screen.getByLabelText(/^First Name/), 'Sophia')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: {
        personalDetails: expect.objectContaining({
          firstName: 'Sophia', lastName: 'Brown',
          // Country is not part of SPEC-03's original Identity field list, but IS part of the
          // real personalDetails PATCH group — kept here to give it a real editable home rather
          // than leaving it permanently unowned (see the component's own doc).
          country: 'Australia', phone: '0400 000 000',
        }),
        preferredStaff: { preferredStaffId: null },
      },
    })
  })

  it('cancel restores the previous values with no network call', async () => {
    const user = userEvent.setup()
    const p = makeParticipant({ firstName: 'Sophie' })
    render(<ParticipantIdentitySection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.clear(screen.getByLabelText(/^First Name/))
    await user.type(screen.getByLabelText(/^First Name/), 'Changed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('dialog', { name: /discard changes/i })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))

    expect(mockPatchMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Sophie')).toBeInTheDocument()
    expect(screen.queryByLabelText('First Name')).not.toBeInTheDocument()
  })

  it('a failed save keeps the section in edit mode with the typed input intact', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockRejectedValue({ response: { data: { message: 'Network error, please retry.' } } })
    render(<ParticipantIdentitySection p={makeParticipant()} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.clear(screen.getByLabelText(/^First Name/))
    await user.type(screen.getByLabelText(/^First Name/), 'Sophia')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error, please retry.')
    expect((screen.getByLabelText(/^First Name/) as HTMLInputElement).value).toBe('Sophia')
  })
})
