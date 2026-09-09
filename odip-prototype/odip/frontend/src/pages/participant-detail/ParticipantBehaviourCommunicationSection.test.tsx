import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParticipantBehaviourCommunicationSection } from './ParticipantBehaviourCommunicationSection'
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
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('ParticipantBehaviourCommunicationSection — permission gate', () => {
  it('hides the whole card for a role without canWriteParticipantDetails when there is no data', () => {
    setUserRole('SupportWorker')
    render(<ParticipantBehaviourCommunicationSection p={makeParticipant()} participantId="participant-1" canEdit={false} />)
    expect(screen.queryByRole('heading', { name: 'Behaviour & Communication' })).not.toBeInTheDocument()
  })

  it('renders the card for a privileged role even with no existing data', () => {
    render(<ParticipantBehaviourCommunicationSection p={makeParticipant()} participantId="participant-1" canEdit />)
    expect(screen.getByRole('heading', { name: 'Behaviour & Communication' })).toBeInTheDocument()
  })
})

describe('ParticipantBehaviourCommunicationSection — edit/save cycle', () => {
  it('saves the full behaviourCommunication group', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    render(<ParticipantBehaviourCommunicationSection p={makeParticipant()} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText('Expressive Skills'), 'High, verbal')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: { behaviourCommunication: expect.objectContaining({ expressiveSkills: 'High, verbal' }) },
    })
  })

  it('cancel restores the previous values with no network call', async () => {
    const user = userEvent.setup()
    const p = makeParticipant({ expressiveSkills: 'High' })
    render(<ParticipantBehaviourCommunicationSection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.clear(screen.getByLabelText('Expressive Skills'))
    await user.type(screen.getByLabelText('Expressive Skills'), 'Changed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('alertdialog', { name: /discard changes/i })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))

    expect(mockPatchMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('a failed save keeps the section in edit mode with the typed input intact', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockRejectedValue({ response: { data: { message: 'Network error, please retry.' } } })
    render(<ParticipantBehaviourCommunicationSection p={makeParticipant()} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText('Expressive Skills'), 'High')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error, please retry.')
    expect((screen.getByLabelText('Expressive Skills') as HTMLTextAreaElement).value).toBe('High')
  })
})
