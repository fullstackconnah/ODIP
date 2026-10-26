import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import {
  SupportNeedsSection, MobilityFunctionalSection, SupportNotesSection, EquipmentSection,
} from './SupportProfileTab'
import { SeeSectionLink } from './SeeSectionLink'
import { AMBULANT_STATUSES } from '@/api/types/enums'
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
    planType: 'SelfManaged', isActive: true, isRepeatClient: false,
    isHighSupport: false, isIntensiveSupport: false, supportRatio: 'OneToOne',
    mobilityAidWheelchair: false, mobilityAidWalker: false, mobilitySupportOptions: [],
    overnightSupport: 'None', overnightRatio: 'OneToOne',
    requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false, requiresStandingMachine: false,
    mobilityNotes: null, equipmentRequirements: null, transportRequirements: null,
    ambulantStatus: null, fallsRiskRating: null, unevenGroundFlag: null, levelOfPersonalCare: null,
    orthotics: null, continenceSupportDetail: null, bowelCareDetail: null, menstruationSupport: null, skinIntegrity: null,
    hasRestrictivePracticeFlag: false, serviceStreams: 'None',
    hasActiveMedications: false, isDraft: false, fundingSource: 'Ndis',
    otherDiagnoses: [], hidpaSupportCategories: 'None',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ParticipantDetailDto
}

let qc: QueryClient
function wrap(ui: ReactNode) {
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>
}
const common = (p: ParticipantDetailDto) => ({ p, participantId: 'participant-1', canEdit: true })

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockPatchMutateAsync.mockReset()
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('Support needs card (supportNeedsMobility group)', () => {
  it('edit/save: toggling High Support patches supportNeedsMobility with the group snapshot merged in', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    const p = makeParticipant({ mobilityNotes: 'Prefers left-side approach.', overnightSupport: 'ActiveNight' })
    render(wrap(<SupportNeedsSection {...common(p)} restrictiveLink={null} />))

    const card = screen.getByText('High Support').closest('.rounded-md') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    await user.click(within(card).getByLabelText('High Support'))
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: { supportNeedsMobility: expect.objectContaining({ isHighSupport: true, mobilityNotes: 'Prefers left-side approach.', overnightSupport: 'ActiveNight' }), expectedRevisions: {} },
    })
  })

  it('cancel restores the previous values and sends nothing', async () => {
    const user = userEvent.setup()
    render(wrap(<SupportNeedsSection {...common(makeParticipant())} restrictiveLink={null} />))

    const card = screen.getByText('High Support').closest('.rounded-md') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    await user.click(within(card).getByLabelText('High Support'))
    await user.click(within(card).getByRole('button', { name: 'Cancel' }))
    await user.click(within(screen.getByRole('alertdialog', { name: /discard changes/i })).getByRole('button', { name: 'Discard' }))

    expect(mockPatchMutateAsync).not.toHaveBeenCalled()
    expect(within(card).getByText('High Support').nextElementSibling).toHaveTextContent('No')
  })

  it('a failed save shows the error, stays in edit mode and keeps the typed input', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockRejectedValue({ response: { data: { message: 'Network error, please retry.' } } })
    render(wrap(<SupportNeedsSection {...common(makeParticipant())} restrictiveLink={null} />))

    const card = screen.getByText('High Support').closest('.rounded-md') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    await user.click(within(card).getByLabelText('High Support'))
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByRole('alert')).toHaveTextContent('Network error, please retry.')
    expect((within(card).getByLabelText('High Support') as HTMLInputElement).checked).toBe(true)
  })

  it('shows the derived restrictive-practice flag with the link the page hands in', () => {
    render(wrap(
      <SupportNeedsSection {...common(makeParticipant({ hasRestrictivePracticeFlag: true }))}
        restrictiveLink={<SeeSectionLink tab="health" hash="restrictive-practices" section="Restrictive practices" canEdit={false} />} />,
    ))
    expect(screen.getByText('Yes')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'See Restrictive practices' })
    expect(link).toHaveAttribute('href', '/?tab=health#restrictive-practices')
  })
})

describe('Notes cards (T16: supportNeedsMobility cards back to back)', () => {
  it('the second card sends the first card\'s new value, built from the latest cached participant, and waits for the refetch', async () => {
    const user = userEvent.setup()
    const stale = makeParticipant()
    qc.setQueryData(['participant', 'participant-1'], stale)
    // The server applies the PATCH and the refetch lands: model it as the cache taking the sent group.
    mockPatchMutateAsync.mockImplementation(async ({ data }) => {
      qc.setQueryData(['participant', 'participant-1'], { ...(qc.getQueryData(['participant', 'participant-1']) as object), ...data.supportNeedsMobility })
      // The real hook awaits the refetch itself when expectedRevisions is sent; the mock models that.
      await qc.invalidateQueries({ queryKey: ['participant', 'participant-1'] })
    })
    let release: () => void = () => {}
    const gate = new Promise<void>(r => { release = r })
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockReturnValue(gate)

    render(wrap(<>
      <SupportNotesSection {...common(stale)} field="mobilityNotes" />
      <SupportNotesSection {...common(stale)} field="equipmentRequirements" />
    </>))

    const mobility = screen.getByRole('heading', { name: 'Mobility notes' }).closest('.rounded-md') as HTMLElement
    await user.click(within(mobility).getByRole('button', { name: 'Edit' }))
    await user.type(within(mobility).getByRole('textbox'), 'Left side')
    await user.click(within(mobility).getByRole('button', { name: 'Save' }))
    // Still saving: the refetch has not landed.
    await waitFor(() => expect(within(mobility).getByRole('button', { name: 'Saving...' })).toBeDisabled())
    await act(async () => { release() })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['participant', 'participant-1'] }))

    invalidate.mockResolvedValue(undefined)
    const equipment = screen.getByRole('heading', { name: 'Equipment notes' }).closest('.rounded-md') as HTMLElement
    await user.click(within(equipment).getByRole('button', { name: 'Edit' }))
    await user.type(within(equipment).getByRole('textbox'), 'Hoist')
    await user.click(within(equipment).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPatchMutateAsync).toHaveBeenCalledTimes(2))
    expect(mockPatchMutateAsync.mock.calls[1][0].data.supportNeedsMobility).toEqual(
      expect.objectContaining({ mobilityNotes: 'Left side', equipmentRequirements: 'Hoist' }),
    )
  })
})

describe('Mobility and functional card', () => {
  it('drops the empty rows and names them in a Not recorded line with Add', () => {
    render(wrap(<MobilityFunctionalSection {...common(makeParticipant({ ambulantStatus: AMBULANT_STATUSES[0] }))} />))
    expect(screen.getByText(/^Not recorded:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('has no Add for a role that cannot edit', () => {
    render(wrap(<MobilityFunctionalSection {...common(makeParticipant({ ambulantStatus: AMBULANT_STATUSES[0] }))} canEdit={false} />))
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
  })
})

describe('Equipment card', () => {
  it('saves the equipment flags through the shared group snapshot', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    render(wrap(<EquipmentSection {...common(makeParticipant({ mobilityNotes: 'Keep' }))} />))
    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByLabelText(/hoist/i))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: { supportNeedsMobility: expect.objectContaining({ requiresHoist: true, mobilityNotes: 'Keep' }), expectedRevisions: {} },
    })
  })
})

describe('Support cards refuse a stale save (S1-S3)', () => {
  const conflict = Object.assign(new Error('409'), {
    response: { status: 409, data: { success: false, code: 'participant-section-changed', errors: ['x'], data: { groupRevisions: { supportNeedsMobility: 5 } } } },
  })
  const revs = { supportNeedsMobility: 4 } as ParticipantDetailDto['groupRevisions']

  async function editNotes(user: ReturnType<typeof userEvent.setup>, p: ParticipantDetailDto) {
    render(wrap(<SupportNotesSection {...common(p)} field="mobilityNotes" />))
    const card = screen.getByRole('heading', { name: 'Mobility notes' }).closest('.rounded-md') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /^(Edit|Add)/ }))
    await user.type(within(card).getByRole('textbox'), 'Left side')
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    return card
  }

  it('S1 sends the supportNeedsMobility revision the card was opened on', async () => {
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    await editNotes(userEvent.setup(), makeParticipant({ groupRevisions: revs }))
    expect(mockPatchMutateAsync.mock.calls[0][0].data.expectedRevisions).toEqual({ supportNeedsMobility: 4 })
  })

  it('S2 a section-changed 409 keeps the draft and shows the refused state', async () => {
    mockPatchMutateAsync.mockRejectedValue(conflict)
    const card = await editNotes(userEvent.setup(), makeParticipant({ groupRevisions: revs }))
    expect(screen.getByText('Someone else saved this section since you opened it.')).toBeInTheDocument()
    expect(within(card).getByRole('textbox')).toHaveValue('Left side')
  })

  it('S3 the card leaves the refetch to the hook', async () => {
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    await editNotes(userEvent.setup(), makeParticipant({ groupRevisions: revs }))
    expect(invalidate).not.toHaveBeenCalled()
  })
})
