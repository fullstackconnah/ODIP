import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BehaviourSupportCard, TypicalDayCard, EarlierChecklistFold } from './ParticipantCommunityAccessSection'
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

let qc: QueryClient
const wrap = (ui: ReactNode) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockPatchMutateAsync.mockReset()
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('BehaviourSupportCard (T17: community access split)', () => {
  it('saves ONLY communityAccessBehaviour, carrying the latest cached overall rating', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    const p = makeParticipant({ overallCommunityAccessRiskRating: 'High' as never, bocTriggers: 'Loud noise' })
    // The cache is newer than the props the card rendered with.
    qc.setQueryData(['participant', 'participant-1'], { ...p, overallCommunityAccessRiskRating: 'Medium' })
    render(wrap(<BehaviourSupportCard p={p} participantId="participant-1" canEdit />))

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText('Signs I Am Happy and Settled'), 'Humming')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(1))
    const { data } = mockPatchMutateAsync.mock.calls[0][0]
    expect(Object.keys(data)).toEqual(['communityAccessBehaviour'])
    expect(data.communityAccessBehaviour).toEqual(expect.objectContaining({
      signsHappyAndSettled: 'Humming', bocTriggers: 'Loud noise', overallCommunityAccessRiskRating: 'Medium',
    }))
  })

  it('carries the rating on the participant record when the cache is empty', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    render(wrap(<BehaviourSupportCard p={makeParticipant({ overallCommunityAccessRiskRating: 'High' as never })} participantId="participant-1" canEdit />))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByLabelText('What Helps Me Calm Down'), 'Music')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalled())
    expect(mockPatchMutateAsync.mock.calls[0][0].data.communityAccessBehaviour.overallCommunityAccessRiskRating).toBe('High')
  })

  it('has no Edit or Add for a role that cannot edit', () => {
    render(wrap(<BehaviourSupportCard p={makeParticipant({ bocTriggers: 'Loud noise' })} participantId="participant-1" canEdit={false} />))
    expect(screen.getByText('Loud noise')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit|add/i })).not.toBeInTheDocument()
  })
})

describe('TypicalDayCard', () => {
  it('saves ONLY supportsLookLike, all four parts', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    render(wrap(<TypicalDayCard p={makeParticipant({ supportsLookLikeDay: 'Walk' })} participantId="participant-1" canEdit />))
    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText('Morning'), 'Breakfast')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(1))
    const { data } = mockPatchMutateAsync.mock.calls[0][0]
    expect(Object.keys(data)).toEqual(['supportsLookLike'])
    expect(data.supportsLookLike).toEqual({
      supportsLookLikeMorning: 'Breakfast', supportsLookLikeDay: 'Walk', supportsLookLikeAfternoonEvening: null, supportsLookLikeOvernight: null,
    })
  })
})

describe('EarlierChecklistFold', () => {
  it('is a closed fold counting the answered rows, and absent at 0', () => {
    const answered = makeParticipant({
      checklistItems: [
        { itemType: 'UsesWheelchair', value: 'Yes', notes: 'Bus only' },
        { itemType: 'HarmToSelf', value: 'No' },
      ],
    } as never)
    const { container, rerender } = render(<EarlierChecklistFold p={answered} />)
    const fold = container.querySelector('details') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    expect(within(fold).getByText('Earlier checklist (2)')).toBeInTheDocument()
    rerender(<EarlierChecklistFold p={makeParticipant()} />)
    expect(container.querySelector('details')).toBeNull()
  })
})
