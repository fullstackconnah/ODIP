import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParticipantAddressLivingSection } from './ParticipantAddressLivingSection'
import { MM_LEVEL_HINT, MM_LEVEL_LABELS, type ParticipantDetailDto } from '@/api/types/participants'

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

describe('ParticipantAddressLivingSection — permission gate', () => {
  it('shows no Edit button for a role without canWriteParticipantDetails', () => {
    setUserRole('SupportWorker')
    render(<ParticipantAddressLivingSection p={makeParticipant()} participantId="participant-1" canEdit={false} />)
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })
})

describe('ParticipantAddressLivingSection — edit/save cycle', () => {
  it('saves the address, remoteness and livingArrangement groups together in one PATCH', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    const p = makeParticipant({ addressStreet: '12 Example St', livingArrangement: 'Family', mainSupportPersonName: 'Jane Citizen' })
    render(<ParticipantAddressLivingSection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: {
        address: expect.objectContaining({ addressStreet: '12 Example St' }),
        remoteness: { mmLevel: null },
        livingArrangement: expect.objectContaining({ livingArrangement: 'Family', mainSupportPersonName: 'Jane Citizen' }),
        expectedRevisions: {},
      },
    })
  })

  it('switching living arrangement type nulls the previous type\'s fields (mutually exclusive, same group)', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    const p = makeParticipant({ livingArrangement: 'Family', mainSupportPersonName: 'Jane Citizen' })
    render(<ParticipantAddressLivingSection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.selectOptions(screen.getByDisplayValue('Family'), 'Independent')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: expect.objectContaining({
        livingArrangement: expect.objectContaining({ livingArrangement: 'Independent', mainSupportPersonName: null, livesWithOthers: false }),
      }),
    })
  })

  it('cancel restores the previous values with no network call', async () => {
    const user = userEvent.setup()
    const p = makeParticipant({ addressStreet: '12 Example St' })
    render(<ParticipantAddressLivingSection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.clear(screen.getByLabelText('Street'))
    await user.type(screen.getByLabelText('Street'), 'Changed St')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('alertdialog', { name: /discard changes/i })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))

    expect(mockPatchMutateAsync).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Street')).not.toBeInTheDocument()
  })

  it('a failed save keeps the section in edit mode with the typed input intact', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockRejectedValue({ response: { data: { message: 'Network error, please retry.' } } })
    render(<ParticipantAddressLivingSection p={makeParticipant()} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText('Street'), '99 New St')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error, please retry.')
    expect((screen.getByLabelText('Street') as HTMLInputElement).value).toBe('99 New St')
  })
})

describe('ParticipantAddressLivingSection — MM level (remoteness)', () => {
  it('reads the chosen level as its option label', () => {
    render(<ParticipantAddressLivingSection p={makeParticipant({ mmLevel: 4, addressSuburb: 'Longreach' })} participantId="participant-1" canEdit />)
    expect(screen.getByText('Remoteness (MM level)')).toBeInTheDocument()
    expect(screen.getByText(MM_LEVEL_LABELS[4])).toBeInTheDocument()
  })

  it('reads "Not set" when the level is empty and something else on the card is recorded', () => {
    render(<ParticipantAddressLivingSection p={makeParticipant({ mmLevel: null, addressSuburb: 'Longreach' })} participantId="participant-1" canEdit />)
    expect(screen.getByText('Not set')).toBeInTheDocument()
  })

  it('shows the level, and no way to edit it, to a role that cannot edit', () => {
    render(<ParticipantAddressLivingSection p={makeParticipant({ mmLevel: 6, addressSuburb: 'Birdsville' })} participantId="participant-1" canEdit={false} />)
    expect(screen.getByText(MM_LEVEL_LABELS[6])).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })

  it('edits through the house dropdown, with the cap hint, and sends the level in the remoteness group', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    render(<ParticipantAddressLivingSection p={makeParticipant({ mmLevel: 4 })} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    expect(screen.getByText(MM_LEVEL_HINT, { normalizer: (t) => t })).toBeInTheDocument()
    expect(MM_LEVEL_HINT).toBe("Sets the travel time cap on shifts not made from an agreement: 30 minutes (MM 1–⁠3), 60 (MM 4–⁠5), none (MM 6–⁠7). Not set uses 30.")   // NBSP keeps MM with its number
    await user.click(screen.getByLabelText('Remoteness (MM level)'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Not set', ...Object.values(MM_LEVEL_LABELS)])
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: MM_LEVEL_LABELS[6] }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: expect.objectContaining({ remoteness: { mmLevel: 6 } }),
    })
  })

  it('choosing "Not set" clears the level', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    render(<ParticipantAddressLivingSection p={makeParticipant({ mmLevel: 4 })} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByLabelText('Remoteness (MM level)'))
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Not set' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({ id: 'participant-1', data: expect.objectContaining({ remoteness: { mmLevel: null } }) })
  })

  it('shows the server message when the level is refused', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockRejectedValue({ response: { data: { message: 'Choose a level from 1 to 7.' } } })
    render(<ParticipantAddressLivingSection p={makeParticipant({ mmLevel: 4 })} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a level from 1 to 7.')
  })
})
