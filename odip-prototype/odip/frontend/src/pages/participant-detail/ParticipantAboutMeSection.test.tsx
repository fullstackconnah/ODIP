import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParticipantAboutMeSection } from './ParticipantAboutMeSection'
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

describe('ParticipantAboutMeSection — permission gate', () => {
  it('hides the whole card for a role without canWriteParticipantDetails when there is no data', () => {
    setUserRole('SupportWorker')
    render(<ParticipantAboutMeSection p={makeParticipant()} participantId="participant-1" canEdit={false} />)
    expect(screen.queryByRole('heading', { name: 'About Me' })).not.toBeInTheDocument()
  })

  it('renders the card for a privileged role even with no existing data', () => {
    render(<ParticipantAboutMeSection p={makeParticipant()} participantId="participant-1" canEdit />)
    expect(screen.getByRole('heading', { name: 'About Me' })).toBeInTheDocument()
  })
})

describe('ParticipantAboutMeSection — edit/save cycle', () => {
  it('saves the full aboutMe group', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    render(<ParticipantAboutMeSection p={makeParticipant()} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText('Goals'), 'Learn to cook independently.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: { aboutMe: expect.objectContaining({ goals: 'Learn to cook independently.' }) },
    })
  })

  it('cancel restores the previous values with no network call', async () => {
    const user = userEvent.setup()
    const p = makeParticipant({ goals: 'Original goal.' })
    render(<ParticipantAboutMeSection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.clear(screen.getByLabelText('Goals'))
    await user.type(screen.getByLabelText('Goals'), 'Changed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('alertdialog', { name: /discard changes/i })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))

    expect(mockPatchMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Original goal.')).toBeInTheDocument()
  })

  it('a failed save keeps the section in edit mode with the typed input intact', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockRejectedValue({ response: { data: { message: 'Network error, please retry.' } } })
    render(<ParticipantAboutMeSection p={makeParticipant()} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText('Goals'), 'Learn to cook.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error, please retry.')
    expect((screen.getByLabelText('Goals') as HTMLTextAreaElement).value).toBe('Learn to cook.')
  })
})
