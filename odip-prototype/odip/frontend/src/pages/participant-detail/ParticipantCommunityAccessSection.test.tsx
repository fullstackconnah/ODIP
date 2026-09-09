import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParticipantCommunityAccessSection } from './ParticipantCommunityAccessSection'
import type { ParticipantDetailDto } from '@/api/types/participants'

const { mockPatchMutateAsync } = vi.hoisted(() => ({ mockPatchMutateAsync: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  usePatchParticipant: () => ({ mutateAsync: mockPatchMutateAsync, isPending: false }),
}))

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

function makeParticipant(overrides: Partial<ParticipantDetailDto> = {}): ParticipantDetailDto {
  return {
    id: 'participant-1', firstName: 'Sophie', lastName: 'Brown', fullName: 'Sophie Brown',
    planType: 'SelfManaged', isActive: true, isRepeatClient: false, mobilityAidWheelchair: false,
    mobilityAidWalker: false, isHighSupport: false, isIntensiveSupport: false, supportRatio: 'OneToOne',
    overnightSupport: 'None', hasRestrictivePracticeFlag: false, serviceStreams: 'CommunityAccessDailyLiving',
    hasActiveMedications: false, isDraft: false, fundingSource: 'Ndis', mobilitySupportOptions: [],
    otherDiagnoses: [], hidpaSupportCategories: 'None', overnightRatio: 'OneToOne',
    requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
    requiresStandingMachine: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ParticipantDetailDto
}

beforeEach(() => {
  mockPatchMutateAsync.mockReset()
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('ParticipantCommunityAccessSection — stream gate (relevance, not permission)', () => {
  it('renders nothing at all when the participant is not in the CommunityAccessDailyLiving stream, regardless of canEdit', () => {
    render(<ParticipantCommunityAccessSection p={makeParticipant({ serviceStreams: 'InHomeSupport' })} participantId="participant-1" canEdit />)
    expect(screen.queryByRole('heading', { name: 'Community Access' })).not.toBeInTheDocument()
  })
})

describe('ParticipantCommunityAccessSection — permission gate', () => {
  it('hides the Edit button for a role without canWriteParticipantDetails but still shows the card (stream-relevant)', () => {
    setUserRole('SupportWorker')
    render(<ParticipantCommunityAccessSection p={makeParticipant()} participantId="participant-1" canEdit={false} />)
    expect(screen.getByRole('heading', { name: 'Community Access' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })
})

describe('ParticipantCommunityAccessSection — edit/save cycle', () => {
  it('saves the communityAccessBehaviour group and supportsLookLike group together in one PATCH', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    render(<ParticipantCommunityAccessSection p={makeParticipant()} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText('Signs I Am Happy and Settled'), 'Smiles and hums.')
    await user.type(screen.getByLabelText('Morning'), 'Gentle wake.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: {
        communityAccessBehaviour: expect.objectContaining({ signsHappyAndSettled: 'Smiles and hums.' }),
        supportsLookLike: expect.objectContaining({ supportsLookLikeMorning: 'Gentle wake.' }),
      },
    })
  })

  it('cancel restores the previous values with no network call', async () => {
    const user = userEvent.setup()
    const p = makeParticipant({ signsHappyAndSettled: 'Hums quietly.' })
    render(<ParticipantCommunityAccessSection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.clear(screen.getByLabelText('Signs I Am Happy and Settled'))
    await user.type(screen.getByLabelText('Signs I Am Happy and Settled'), 'Changed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('alertdialog', { name: /discard changes/i })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))

    expect(mockPatchMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Hums quietly.')).toBeInTheDocument()
  })

  it('a failed save keeps the section in edit mode with the typed input intact', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockRejectedValue({ response: { data: { message: 'Network error, please retry.' } } })
    render(<ParticipantCommunityAccessSection p={makeParticipant()} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText('Signs I Am Happy and Settled'), 'Smiles.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error, please retry.')
    expect((screen.getByLabelText('Signs I Am Happy and Settled') as HTMLTextAreaElement).value).toBe('Smiles.')
  })
})
