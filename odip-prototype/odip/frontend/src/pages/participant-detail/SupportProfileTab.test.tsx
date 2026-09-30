import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SupportProfileTab from './SupportProfileTab'
import type { ParticipantDetailDto, SupportProfileDto } from '@/api/types/participants'
import { TAP_AREA } from '@/components/tapArea'

const {
  mockUseParticipant, mockUseSupportProfile, mockPatchMutateAsync, mockUpdateSupportProfileMutateAsync,
} = vi.hoisted(() => ({
  mockUseParticipant: vi.fn(),
  mockUseSupportProfile: vi.fn(() => ({ data: undefined as SupportProfileDto | undefined })),
  mockPatchMutateAsync: vi.fn(),
  mockUpdateSupportProfileMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipant: mockUseParticipant,
  useSupportProfile: mockUseSupportProfile,
  usePatchParticipant: () => ({ mutateAsync: mockPatchMutateAsync, isPending: false }),
  useUpdateSupportProfile: () => ({ mutateAsync: mockUpdateSupportProfileMutateAsync, isPending: false }),
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

beforeEach(() => {
  mockUseParticipant.mockReset()
  mockUseSupportProfile.mockReset()
  mockPatchMutateAsync.mockReset()
  mockUpdateSupportProfileMutateAsync.mockReset()
  mockUseSupportProfile.mockReturnValue({ data: undefined })
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('SupportProfileTab — permission gate', () => {
  it('shows no Edit buttons at all for a role without canWriteParticipantDetails/canWriteSupportProfile (e.g. SupportWorker)', () => {
    setUserRole('SupportWorker')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    render(<SupportProfileTab participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })

  it('shows Edit buttons for a Coordinator (has both canWriteParticipantDetails and canWriteSupportProfile)', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    render(<SupportProfileTab participantId="participant-1" />)

    // 6 supportNeedsMobility sections + 1 Support Profile section = 7 Edit buttons.
    expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(7)
  })
})

describe('SupportProfileTab — Support Needs section (supportNeedsMobility group)', () => {
  it('edit/save cycle: toggling High Support and saving patches supportNeedsMobility with the group snapshot merged in', async () => {
    const user = userEvent.setup()
    mockPatchMutateAsync.mockResolvedValue({ success: true })
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ mobilityNotes: 'Prefers left-side approach.', overnightSupport: 'ActiveNight', overnightRatio: 'OneToOne' }),
      isLoading: false,
    })
    render(<SupportProfileTab participantId="participant-1" />)

    const card = screen.getByText('High Support').closest('.rounded-md') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    await user.click(within(card).getByLabelText('High Support'))
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    expect(mockPatchMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: {
        supportNeedsMobility: expect.objectContaining({
          isHighSupport: true,
          // The partial-save guard: sibling cards' untouched fields ride along unchanged in the
          // same group snapshot rather than being omitted/cleared.
          mobilityNotes: 'Prefers left-side approach.',
          overnightSupport: 'ActiveNight',
        }),
      },
    })
  })

  it('cancel restores the previous values and discards edits, with no network call', async () => {
    const user = userEvent.setup()
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isHighSupport: false }), isLoading: false })
    render(<SupportProfileTab participantId="participant-1" />)

    const card = screen.getByText('High Support').closest('.rounded-md') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    const checkbox = within(card).getByLabelText('High Support') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    await user.click(checkbox)
    expect(checkbox.checked).toBe(true)

    // Not dirty-guarded (dirty=true would show a confirm dialog) — confirm the discard.
    await user.click(within(card).getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('alertdialog', { name: /discard changes/i })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))

    expect(mockPatchMutateAsync).not.toHaveBeenCalled()
    expect(within(card).getByText('High Support').nextElementSibling).toHaveTextContent('No')
    expect(within(card).queryByLabelText('High Support')).not.toBeInTheDocument()
  })

  it('a failed save shows an error, keeps the section in edit mode, and preserves the typed input', async () => {
    const user = userEvent.setup()
    // Same axios-error shape extractErrorMessage (mirrored from every other participant-detail
    // section) expects — a bare Error would fall through to the generic fallback message instead.
    mockPatchMutateAsync.mockRejectedValue({ response: { data: { message: 'Network error, please retry.' } } })
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    render(<SupportProfileTab participantId="participant-1" />)

    const card = screen.getByText('High Support').closest('.rounded-md') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    await user.click(within(card).getByLabelText('High Support'))
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByRole('alert')).toHaveTextContent('Network error, please retry.')
    // Still in edit mode, with the user's input intact.
    expect((within(card).getByLabelText('High Support') as HTMLInputElement).checked).toBe(true)
  })
})

describe('SupportProfileTab — no Edit gate mixing between the two permission-gated groups', () => {
  it('a role with canWriteParticipantDetails but not canWriteSupportProfile would be identical here (both currently mirror the same three roles), but the tab wires each section to its own boolean independently', () => {
    // Regression guard for accidentally wiring both to the SAME usePermissions() destructure key —
    // if canWriteSupportProfile were typo'd to canWriteParticipantDetails (or vice versa), this
    // test wouldn't catch it today (both booleans currently compute identically for every role),
    // but the two are asserted as visually distinct sections below so a future divergence is
    // caught by the DOM shape, not just the boolean value.
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    mockUseSupportProfile.mockReturnValue({ data: { id: 'sp-1', participantId: 'participant-1', communicationNotes: 'Uses AAC device.', behaviourSupportNotes: null, restrictivePracticeDetails: null, manualHandlingNotes: null, medicationHealthSummary: null, emergencyConsiderations: null, travelSpecificNotes: null, reviewDate: null } })
    render(<SupportProfileTab participantId="participant-1" />)

    expect(screen.getByRole('heading', { name: 'Support Needs' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Support Profile' })).toBeInTheDocument()
    expect(screen.getByText('Uses AAC device.')).toBeInTheDocument()
  })
})

describe('SupportProfileTab — Support Profile section (the /support-profile sub-resource)', () => {
  it('edit/save cycle: editing Communication Notes calls useUpdateSupportProfile with the sub-resource payload', async () => {
    const user = userEvent.setup()
    mockUpdateSupportProfileMutateAsync.mockResolvedValue({ success: true })
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    mockUseSupportProfile.mockReturnValue({
      data: { id: 'sp-1', participantId: 'participant-1', communicationNotes: null, behaviourSupportNotes: null, restrictivePracticeDetails: null, manualHandlingNotes: null, medicationHealthSummary: null, emergencyConsiderations: null, travelSpecificNotes: null, reviewDate: null },
    })
    render(<SupportProfileTab participantId="participant-1" />)

    const card = screen.getByRole('heading', { name: 'Support Profile' }).closest('.rounded-md') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    await user.type(within(card).getByLabelText('Communication Notes'), 'Uses AAC device.')
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    expect(mockUpdateSupportProfileMutateAsync).toHaveBeenCalledWith({
      id: 'participant-1',
      data: expect.objectContaining({ communicationNotes: 'Uses AAC device.' }),
    })
  })

  it('renders Restrictive Practice Details as read-only text, with no edit control for it', async () => {
    const user = userEvent.setup()
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    mockUseSupportProfile.mockReturnValue({
      data: { id: 'sp-1', participantId: 'participant-1', communicationNotes: null, behaviourSupportNotes: null, restrictivePracticeDetails: 'Legacy PRN note.', manualHandlingNotes: null, medicationHealthSummary: null, emergencyConsiderations: null, travelSpecificNotes: null, reviewDate: null },
    })
    render(<SupportProfileTab participantId="participant-1" />)

    expect(screen.getByText('Legacy PRN note.')).toBeInTheDocument()

    const card = screen.getByRole('heading', { name: 'Support Profile' }).closest('.rounded-md') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))

    // The text is still shown (and even labelled, for a11y) while the section is mid-edit, but
    // there is no editable textbox for it anywhere — UpdateSupportProfileDto has no field for it.
    expect(within(card).queryByRole('textbox', { name: /restrictive practice details/i })).not.toBeInTheDocument()
    expect(within(card).getByText('Legacy PRN note.')).toBeInTheDocument()
  })
})

describe('SupportProfileTab — density layout (finish review)', () => {
  function cardFor(heading: string): HTMLElement {
    return screen.getByRole('heading', { name: heading }).closest('.rounded-md') as HTMLElement
  }

  it('lays the cards on the auto-fill, items-start section grid, with a min(…,100%) floor so it collapses to one column on a phone', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const { container } = render(<SupportProfileTab participantId="participant-1" />)

    // jsdom has no layout, so the class is the only observable proof of the mobile fix: a bare
    // minmax(26rem,1fr) floor (416px) overflows a 390px viewport and scrolls the page sideways.
    const grid = container.firstElementChild as HTMLElement
    expect(grid).toHaveClass('grid', 'items-start')
    expect(grid).toHaveClass('grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))]')
  })

  it('renders the read-only rows as a semantic fact list (label + value), not a 50/50 grid of spans', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ isHighSupport: true, ambulantStatus: 'NoAssist', overnightSupport: 'ActiveNight', overnightRatio: 'OneToOne' }),
      isLoading: false,
    })
    render(<SupportProfileTab participantId="participant-1" />)

    const highSupport = screen.getByText('High Support')
    expect(highSupport.tagName).toBe('DT')
    expect(highSupport.nextElementSibling).toHaveTextContent('Yes')
    expect(screen.getByText('Ambulant Status').nextElementSibling).toHaveTextContent('No Assist')
    expect(within(cardFor('Overnight Support')).getByText('Overnight Support', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Active Night (1:1)')
  })

  it('collapses a card whose values are all empty to one "Not recorded" line instead of rows of dashes', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    render(<SupportProfileTab participantId="participant-1" />)

    // makeParticipant() records no mobility aids/support, no equipment and no Mobility & Functional data.
    for (const heading of ['Mobility Aids & Support', 'Equipment', 'Mobility & Functional']) {
      const card = cardFor(heading)
      expect(within(card).getByText('Not recorded')).toBeInTheDocument()
      expect(card.querySelector('dl')).toBeNull()
    }
    // Support Notes keeps its own, more specific wording.
    expect(within(cardFor('Support Notes')).getByText('No support notes recorded')).toBeInTheDocument()
  })

  it('only gives a Support Notes / Mobility & Functional detail row to a note that actually has content', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ mobilityNotes: 'Prefers left-side approach.', orthotics: 'AFO both feet.' }),
      isLoading: false,
    })
    render(<SupportProfileTab participantId="participant-1" />)

    const notes = within(cardFor('Support Notes'))
    expect(notes.getByText('Mobility Notes').nextElementSibling).toHaveTextContent('Prefers left-side approach.')
    expect(notes.queryByText('Equipment Requirements')).not.toBeInTheDocument()
    expect(notes.queryByText('Transport Requirements')).not.toBeInTheDocument()

    const functional = within(cardFor('Mobility & Functional'))
    expect(functional.getByText('Orthotics').nextElementSibling).toHaveTextContent('AFO both feet.')
    expect(functional.queryByText('Skin Integrity')).not.toBeInTheDocument()
    // The four core ratings still get a row, dashed when unrecorded.
    expect(functional.getByText('Ambulant Status').nextElementSibling).toHaveTextContent('—')
  })

  it('shows "None" for no overnight support, and never prints "undefined" when the payload omits overnightSupport', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ overnightSupport: 'None' }), isLoading: false })
    const { unmount } = render(<SupportProfileTab participantId="participant-1" />)
    expect(within(cardFor('Overnight Support')).getByText('None')).toBeInTheDocument()
    unmount()

    // A DTO from an older API build / the mock API has no overnightSupport at all.
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ overnightSupport: undefined, overnightRatio: undefined }), isLoading: false })
    render(<SupportProfileTab participantId="participant-1" />)
    const card = cardFor('Overnight Support')
    expect(card).not.toHaveTextContent(/undefined/)
    expect(within(card).getByText('Not recorded')).toBeInTheDocument()
  })
})

describe('SupportProfileTab — read-only display', () => {
  it('shows the derived Restrictive Practice flag with a link into the Restrictive Practices tab', async () => {
    const user = userEvent.setup()
    const onNavigateToTab = vi.fn()
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ hasRestrictivePracticeFlag: true }), isLoading: false })
    render(<SupportProfileTab participantId="participant-1" onNavigateToTab={onNavigateToTab} />)

    expect(screen.getByText('Yes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /view restrictive practices tab/i }))
    expect(onNavigateToTab).toHaveBeenCalledWith('restrictive-practices')
  })
})

// Density verdict, touch: both "View Restrictive Practices tab" links are 32px-and-under text buttons. Under
// `pointer: coarse` they carry the TAP_AREA pad (a 44px hit area centred on the text) rather than growing.
describe('SupportProfileTab — 44px coarse-pointer hit area', () => {
  const pad = TAP_AREA.split(' ')

  it('pads the link in the Support Needs fact list', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ hasRestrictivePracticeFlag: true }), isLoading: false })
    render(<SupportProfileTab participantId="participant-1" />)

    const link = screen.getByRole('button', { name: /view restrictive practices tab/i })
    expect(link).toHaveClass(...pad, 'text-xs', 'hover:underline')
  })

  it('pads the link beside the Restrictive Practice Details heading too', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    mockUseSupportProfile.mockReturnValue({
      data: { id: 'sp-1', participantId: 'participant-1', communicationNotes: null, behaviourSupportNotes: null, restrictivePracticeDetails: 'Legacy PRN note.', manualHandlingNotes: null, medicationHealthSummary: null, emergencyConsiderations: null, travelSpecificNotes: null, reviewDate: null },
    })
    render(<SupportProfileTab participantId="participant-1" />)

    const links = screen.getAllByRole('button', { name: /view restrictive practices tab/i })
    // one in the Support Needs list, one beside the details heading
    expect(links).toHaveLength(2)
    for (const link of links) expect(link).toHaveClass(...pad)
  })

  it('still navigates from the padded link', async () => {
    const user = userEvent.setup()
    const onNavigateToTab = vi.fn()
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ hasRestrictivePracticeFlag: true }), isLoading: false })
    render(<SupportProfileTab participantId="participant-1" onNavigateToTab={onNavigateToTab} />)

    await user.click(screen.getByRole('button', { name: /view restrictive practices tab/i }))
    expect(onNavigateToTab).toHaveBeenCalledWith('restrictive-practices')
  })
})
