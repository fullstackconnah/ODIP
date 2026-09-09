import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParticipantNdisFundingSection } from './ParticipantNdisFundingSection'
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
    planType: 'PlanManaged', isActive: true, isRepeatClient: false, mobilityAidWheelchair: false,
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

describe('ParticipantNdisFundingSection — permission gate', () => {
  it('shows no Edit button for a role without canWriteParticipantDetails', () => {
    setUserRole('SupportWorker')
    render(<ParticipantNdisFundingSection p={makeParticipant()} participantId="participant-1" canEdit={false} />)
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })
})

describe('ParticipantNdisFundingSection — the planType data-loss guard (THE TRAP)', () => {
  it('saving this section does NOT null planType — its unrendered value is merged from server state, not dropped', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    // planType ('PlanManaged') is part of the ndisPlan PATCH group but is not a field this
    // section renders anywhere (it only shows read-only in the page header meta line) — this is
    // the one genuine partial-group-coverage instance PD-7 introduces on the Details tab.
    const p = makeParticipant({ planType: 'PlanManaged', fundingSource: 'Ndis', isDsoa: true })
    render(<ParticipantNdisFundingSection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: { ndisPlan: expect.objectContaining({ planType: 'PlanManaged', fundingSource: 'Ndis', isDsoa: true }) },
    })
  })

  it('switching funding source to Other nulls the NDIS-only fields (mutually exclusive within the same group, not the merge trap)', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    const p = makeParticipant({ fundingSource: 'Ndis', ndisNumber: '431234567', planType: 'SelfManaged' })
    render(<ParticipantNdisFundingSection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.selectOptions(screen.getByDisplayValue('NDIS'), 'Other')
    await user.type(screen.getByLabelText('Funding Organisation'), 'Local Council')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: {
        ndisPlan: expect.objectContaining({
          fundingSource: 'Other', ndisNumber: null, planStartDate: null, planEndDate: null,
          fundingOrganisation: 'Local Council',
          // planType still carried through untouched even while switching funding source.
          planType: 'SelfManaged',
        }),
      },
    })
  })

  it('cancel restores the previous values with no network call', async () => {
    const user = userEvent.setup()
    const p = makeParticipant({ isDsoa: false })
    render(<ParticipantNdisFundingSection p={p} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByLabelText(/DSOA/))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('alertdialog', { name: /discard changes/i })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))

    expect(mockPatchMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('DSOA').nextElementSibling).toHaveTextContent('No')
  })

  it('a failed save keeps the section in edit mode with the typed input intact', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockRejectedValue({ response: { data: { message: 'Network error, please retry.' } } })
    render(<ParticipantNdisFundingSection p={makeParticipant()} participantId="participant-1" canEdit />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText('NDIS Number'), '431234567')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network error, please retry.')
    expect((screen.getByLabelText('NDIS Number') as HTMLInputElement).value).toBe('431234567')
  })
})
