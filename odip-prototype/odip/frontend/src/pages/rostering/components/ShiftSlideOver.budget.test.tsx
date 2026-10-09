import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShiftSlideOver } from './ShiftSlideOver'
import { makeShift, makeFinding } from '../test-fixtures'
import { forecastOverFinding, forecastOverWarningForAdmin, forecastOverWithFigures, approachingFinding } from './parallel-budget-override/fixtures'
import type { RosterFindingDto, ShiftCheckResult } from '@/api/types'
import { SERVER_PERIOD, asWritten } from '@/test/fixtures/budgets'

// The budget moments of the shift panel (budget phase 3): a warning in Warn mode, an Admin's reason, a Coordinator's refusal and the "Emergency or safety" way through, the marker a saved shift carries,
// and the one informational line a shift the budget could not check gets. Only the API layer is mocked; every other collaborator is the real component, so this exercises the real save gate.

const { mockCheckMutate, mockCreateMutateAsync, mockUpdateMutateAsync, mockGetRosterFindings } = vi.hoisted(() => ({
  mockCheckMutate: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockGetRosterFindings: vi.fn(() => null),
}))

vi.mock('@/api/hooks', () => ({
  useCheckShift: () => ({ mutate: mockCheckMutate, isPending: false }),
  useCreateShift: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateShift: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeleteShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useParticipantRoutines: () => ({ data: [] }),
  useCompatibility: () => ({ data: [] }),
  useRosterShiftNotes: () => ({ data: [] }),
  getRosterFindings: mockGetRosterFindings,
}))

const participantOptions = [{ value: 'participant-1', label: 'Mia Chen' }]
const staffOptions = [{ value: 'staff-1', label: 'Alex Rivera' }]
const DESCRIPTION = 'Participant unsafe at home tonight'

beforeEach(() => {
  mockCheckMutate.mockReset()
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockGetRosterFindings.mockReset()
  mockGetRosterFindings.mockReturnValue(null)
  mockCreateMutateAsync.mockResolvedValue({})
  mockUpdateMutateAsync.mockResolvedValue({})
})

/** The dry run answers with this, the moment the panel asks. */
function answerCheckWith(result: ShiftCheckResult) {
  mockCheckMutate.mockImplementation((_candidate: unknown, opts?: { onSuccess?: (r: ShiftCheckResult) => void }) => opts?.onSuccess?.(result))
}

function renderCreate(onClose = vi.fn()) {
  render(
    <ShiftSlideOver
      target={{ mode: 'create', participantId: 'participant-1', staffId: null, serviceDate: '2026-08-17' }}
      onClose={onClose}
      canWrite
      participantOptions={participantOptions}
      staffOptions={staffOptions}
    />,
  )
  return onClose
}

const saveButton = () => screen.getByRole('button', { name: /^save/i })
const emergencyAction = () => screen.getByRole('button', { name: /^Emergency or safety/i })
const description = () => screen.getByLabelText(/What made this an emergency or safety need/i)

const forecastOverWithCost: RosterFindingDto = {
  ...forecastOverWithFigures,
  message: `Takes Core (flexible) to $8,640.00 of $8,000.00 for ${SERVER_PERIOD}. This shift: about $292.32.`,
}

describe('a budget warning (Warn mode)', () => {
  it('shows the server’s sentence with the shift’s cost, and saves with no reason and no emergency flag', async () => {
    const user = userEvent.setup()
    const warning: RosterFindingDto = { ...forecastOverWithCost, severity: 'Warning' }
    answerCheckWith({ findings: [warning] })
    renderCreate()

    expect(await screen.findByText(`Takes Core (flexible) to $8,640.00 of $8,000.00 for ${SERVER_PERIOD}. This shift: about $292.32.`, { normalizer: asWritten })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Emergency or safety/i })).not.toBeInTheDocument()   // nothing is refused, so there is nothing to get through
    // M1: nothing is overridden in Warn mode, so the button does not say so, and there is no box for a reason the server would throw away.
    expect(saveButton()).toHaveTextContent('Save anyway')
    expect(screen.queryByLabelText(/reason for override/i)).not.toBeInTheDocument()
    await user.click(saveButton())

    expect(mockCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1', staffId: null, serviceDate: '2026-08-17', startTime: '09:00', endTime: '10:00', endsNextDay: false, ratio: 'OneToOne', nightType: 'None',
      status: 'Draft', notes: null, overrideReason: null, acknowledgedFindingCodes: ['BUDGET_FORECAST_OVER'],
    })
  })

  it('sends a code once, even when two pools are both past their funding', async () => {
    const user = userEvent.setup()
    const second: RosterFindingDto = { ...forecastOverWithCost, severity: 'Warning', budget: { ...forecastOverWithFigures.budget!, poolName: 'Daily Activities' } }
    answerCheckWith({ findings: [{ ...forecastOverWithCost, severity: 'Warning' }, second] })
    renderCreate()
    await screen.findAllByText(/Takes Core/)

    await user.click(saveButton())

    expect(mockCreateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ acknowledgedFindingCodes: ['BUDGET_FORECAST_OVER'] }))
  })
})

describe('an Admin’s override (a warning that asks for a reason)', () => {
  it('uses the existing reason field: required, and stored with the shift', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [{ ...forecastOverWarningForAdmin, message: forecastOverWithCost.message }] })
    renderCreate()
    await screen.findByText(/Reason required/)
    expect(saveButton()).toHaveTextContent('Save with override')   // a reason IS being asked for here
    // M5: the field says why it is asked for and that it is kept, in the budget's own words.
    expect(screen.getByLabelText(/reason for override/i)).toHaveAccessibleDescription('The hard limit is on. This reason is recorded in the audit log.')
    expect(screen.getByPlaceholderText('Why this shift should go ahead over budget')).toBeInTheDocument()

    await user.click(saveButton())
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Add a reason to save this shift over budget.')).toBeInTheDocument()
    expect(screen.queryByText(/A reason is required to save over the warnings/)).not.toBeInTheDocument()

    // M6: the error goes the moment there is a real answer under it, not only on the next save.
    await user.type(screen.getByLabelText(/reason for override/i), 'C')
    expect(screen.queryByText('Add a reason to save this shift over budget.')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/reason for override/i)).not.toBeInvalid()
    await user.type(screen.getByLabelText(/reason for override/i), 'lient’s carer is in hospital')
    await user.click(saveButton())

    expect(mockCreateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ overrideReason: 'Client’s carer is in hospital', acknowledgedFindingCodes: ['BUDGET_FORECAST_OVER'] }))
    expect(mockCreateMutateAsync.mock.calls[0][0]).not.toHaveProperty('emergency')
    expect(screen.queryByRole('button', { name: /^Emergency or safety/i })).not.toBeInTheDocument()
  })
})

describe('a Coordinator the budget refused', () => {
  it('names the figures, disables the primary save, and offers "Emergency or safety" as a secondary action', async () => {
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()

    expect(await screen.findByText(/Takes Core \(flexible\) to \$8,640\.00 of \$8,000\.00/)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(emergencyAction()).toBeEnabled()
    expect(screen.queryByLabelText(/What made this an emergency or safety need/i)).not.toBeInTheDocument()
  })

  it('moves focus to the description once the emergency path is chosen, and keeps Save disabled until it is real', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(/Takes Core/)

    await user.click(emergencyAction())

    expect(description()).toHaveFocus()
    expect(saveButton()).toBeDisabled()
    await user.type(description(), 'too short')   // nine characters
    expect(saveButton()).toBeDisabled()
    await user.type(description(), '!')
    expect(saveButton()).toBeEnabled()
    expect(saveButton()).toHaveTextContent('Save as emergency')
    expect(screen.queryByText(/can.t be saved as it is/)).not.toBeInTheDocument()   // the refusal is answered
  })

  it('saves as an emergency: the description in the reason, the flag set, and nothing else changed', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [forecastOverWithCost, approachingFinding] })
    const onClose = renderCreate()
    await screen.findByText(/Takes Core/)
    await user.click(emergencyAction())
    await user.type(description(), `  ${DESCRIPTION}  `)

    await user.click(saveButton())

    expect(mockCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1', staffId: null, serviceDate: '2026-08-17', startTime: '09:00', endTime: '10:00', endsNextDay: false, ratio: 'OneToOne', nightType: 'None',
      status: 'Draft', notes: null, overrideReason: DESCRIPTION, emergency: true, acknowledgedFindingCodes: ['BUDGET_APPROACHING'],
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('stays on the emergency path with the description intact when the server refuses the save', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [forecastOverWithCost] })
    mockCreateMutateAsync.mockRejectedValue(new Error('Network Error'))
    const onClose = renderCreate()
    await screen.findByText(/Takes Core/)
    await user.click(emergencyAction())
    await user.type(description(), DESCRIPTION)

    await user.click(saveButton())

    expect(await screen.findByText('Something went wrong saving this shift. Please try again.')).toBeInTheDocument()
    expect(description()).toHaveValue(DESCRIPTION)
    expect(saveButton()).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets the user step back out: the refusal stands, Save is disabled again, and the description is kept for next time', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(/Takes Core/)
    await user.click(emergencyAction())
    await user.type(description(), DESCRIPTION)

    await user.click(screen.getByRole('button', { name: /^Back: this is not an emergency$/ }))

    expect(saveButton()).toBeDisabled()
    await user.click(emergencyAction())
    expect(description()).toHaveValue(DESCRIPTION)
  })

  it('drops the emergency path when a fresh check no longer refuses the shift', async () => {
    const user = userEvent.setup()
    let refuse = true
    mockCheckMutate.mockImplementation((_c: unknown, opts?: { onSuccess?: (r: ShiftCheckResult) => void }) => opts?.onSuccess?.({ findings: refuse ? [forecastOverWithCost] : [] }))
    renderCreate()
    await screen.findByText(/Takes Core/)
    await user.click(emergencyAction())
    await user.type(description(), DESCRIPTION)

    refuse = false
    await user.clear(screen.getByLabelText(/^End time/))
    await user.type(screen.getByLabelText(/^End time/), '10:00')

    await waitFor(() => expect(screen.queryByLabelText(/What made this an emergency or safety need/i)).not.toBeInTheDocument())
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    expect(mockCreateMutateAsync.mock.calls[0][0]).not.toHaveProperty('emergency')
    expect(mockCreateMutateAsync.mock.calls[0][0].overrideReason).toBeNull()
  })

  it('still refuses when something other than the budget blocks the save', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [forecastOverWithCost, makeFinding({ code: 'WSC_EXPIRED', severity: 'Blocking', message: 'Screening has expired' })] })
    renderCreate()
    await screen.findByText(/Takes Core/)
    await user.click(emergencyAction())
    await user.type(description(), DESCRIPTION)

    expect(saveButton()).toBeDisabled()
  })
})

describe('the figures', () => {
  it('are in a disclosure, printed from the server’s numbers and without a second copy of the sentence', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(/Takes Core/)

    await user.click(screen.getByText('Budget figures', { selector: 'summary' }))

    const region = screen.getByRole('region', { name: 'Budget figures for this shift' })
    expect(within(region).getByText('$8,000.00')).toBeInTheDocument()
    expect(within(region).getByText('$4,200.00')).toBeInTheDocument()   // used so far
    expect(within(region).getByText('$4,147.68')).toBeInTheDocument()   // booked ahead
    expect(within(region).getByText('$292.32')).toBeInTheDocument()
    expect(within(region).getByText('$640.00')).toBeInTheDocument()
    expect(within(region).queryByText(/^Takes Core/)).not.toBeInTheDocument()
  })

  it('has a summary row that reaches the 44 px touch floor, with a chevron of its own (M8)', async () => {
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(/Takes Core/)

    const summary = screen.getByText('Budget figures', { selector: 'summary' })
    expect(summary.className).toContain('min-h-[var(--tap-min)]')
    expect(summary.querySelector('svg')).not.toBeNull()
  })
})

describe('a shift the budget could not check', () => {
  it('says so in one quiet line, and blocks nothing', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [], budgetNote: 'Budget not checked: sleepover shifts are not priced yet.' })
    renderCreate()

    expect(await screen.findByText('Budget not checked: sleepover shifts are not priced yet.')).toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    expect(mockCreateMutateAsync).toHaveBeenCalled()
  })

  it('draws no line when the budget was checked', async () => {
    answerCheckWith({ findings: [] })
    renderCreate()
    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalled())

    expect(screen.queryByText(/Budget not checked/)).not.toBeInTheDocument()
  })
})

describe('a shift saved over budget', () => {
  const emergencyShift = makeShift({
    overrideReason: 'Emergency or safety: Participant unsafe at home tonight',
    acknowledgedFindingCodes: ['BUDGET_EMERGENCY'],
    budgetReview: { state: 'Pending', recordedAt: '2026-10-04T03:12:00Z', reviewTaskTitle: 'Review emergency shift over budget: Mia Chen on 17 Aug 2026' },
  })

  function renderEdit(shift = emergencyShift) {
    return render(<ShiftSlideOver target={{ mode: 'edit', shift }} onClose={vi.fn()} canWrite participantOptions={participantOptions} staffOptions={staffOptions} />)
  }

  it('shows the emergency marker with the review pending, the reason, and the review task', () => {
    renderEdit()

    const marker = document.querySelector('[data-budget-marker="emergency"]') as HTMLElement
    expect(within(marker).getByText('Over budget: emergency')).toBeInTheDocument()
    expect(within(marker).getByText('Admin review pending')).toBeInTheDocument()
    expect(within(marker).getByText('Participant unsafe at home tonight')).toBeInTheDocument()   // the server's prefix is the pill's job, not a second line of the box
    expect(within(marker).getByText('Review emergency shift over budget: Mia Chen on 17 Aug 2026')).toBeInTheDocument()
  })

  it('does not copy the stored emergency text into the ordinary reason field, and a later save sends no reason and no flag', async () => {
    const user = userEvent.setup()
    renderEdit()

    expect(screen.queryByLabelText(/reason for override/i)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Notes/), 'bring the swimming bag')
    await user.click(saveButton())

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: expect.objectContaining({ overrideReason: null, notes: 'bring the swimming bag', acknowledgedFindingCodes: [] }),
    })
    expect(mockUpdateMutateAsync.mock.calls[0][0].data).not.toHaveProperty('emergency')
  })

  it('shows the Admin override marker without a review badge: an Admin’s own act has none to wait for', () => {
    renderEdit(makeShift({ overrideReason: 'Client’s carer is in hospital', acknowledgedFindingCodes: ['BUDGET_FORECAST_OVER'] }))

    const marker = document.querySelector('[data-budget-marker="adminOverride"]') as HTMLElement
    expect(within(marker).getByText('Over budget: Admin override')).toBeInTheDocument()
    expect(within(marker).queryByText(/Admin review pending|Reviewed/)).not.toBeInTheDocument()
    expect(within(marker).getByText('Client’s carer is in hospital')).toBeInTheDocument()
  })

  it('draws no marker for a shift that only had a warning, or whose codes are not the server’s acknowledgement', () => {
    renderEdit(makeShift({ overrideReason: 'Emergency or safety: typed by hand', acknowledgedFindingCodes: ['BUDGET_APPROACHING', 'BUDGET_OVER'] }))

    expect(document.querySelector('[data-budget-marker]')).toBeNull()
  })

  it('reads a reviewed emergency as reviewed, with the day it was reviewed', () => {
    renderEdit(makeShift({ ...emergencyShift, budgetReview: { state: 'Reviewed', recordedAt: '2026-10-04T03:12:00Z', reviewedOn: '2026-10-05', reviewedBy: 'Ada Admin' } }))

    const marker = document.querySelector('[data-budget-marker="emergency"]') as HTMLElement
    expect(within(marker).getByText('Reviewed')).toBeInTheDocument()
    expect(within(marker).getByText('5 Oct 2026')).toBeInTheDocument()
    expect(within(marker).getByText('Ada Admin')).toBeInTheDocument()   // M10: who looked, from the completion record
  })

  it('asks the dry run about the status the shift would be saved with, so a cancel is checked as a cancel', async () => {
    answerCheckWith({ findings: [] })
    const user = userEvent.setup()
    renderEdit(makeShift({ status: 'Published' }))
    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalled())

    await user.click(screen.getByLabelText('Status'))
    await user.click(await screen.findByRole('option', { name: 'Cancelled' }))

    await waitFor(() => expect(mockCheckMutate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'shift-1', status: 'Cancelled' }), expect.anything()))
  })
})

describe('a viewer who cannot write', () => {
  it('is never offered a way through and the dry run is not asked', () => {
    render(<ShiftSlideOver target={{ mode: 'edit', shift: makeShift({ findings: [forecastOverFinding] }) }} onClose={vi.fn()} canWrite={false} participantOptions={participantOptions} staffOptions={staffOptions} />)

    expect(screen.getByRole('region', { name: 'Emergency or safety' })).toBeInTheDocument()   // the refusal is still visible, as a read-only form
    expect(emergencyAction()).toBeDisabled()
    expect(mockCheckMutate).not.toHaveBeenCalled()
  })
})

// ── Phase 3 design review, round 1 ───────────────────────────────────────────────────────────────────────────────────────

const REFUSAL = "The hard limit is on, so this shift can't be saved as it is."
const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('the reason box keeps the generic words when the budget is not the only thing asking (M5)', () => {
  it('asks in the roster’s words when another finding wants a reason too', async () => {
    answerCheckWith({
      findings: [{ ...forecastOverWarningForAdmin, message: forecastOverWithCost.message }, makeFinding({ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Staff is on approved leave.', requiresReason: true })],
    })
    renderCreate()
    await screen.findAllByText(/Reason required/)

    expect(screen.getByPlaceholderText('Why this assignment should proceed despite the warnings above')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Why this shift should go ahead over budget')).not.toBeInTheDocument()
  })
})

describe('the refusal, read in the order a coordinator needs it (H2, H3)', () => {
  it('says the hard limit in one line of the budget’s own words, not the roster’s', async () => {
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()

    expect(await screen.findByText(REFUSAL)).toBeInTheDocument()
    expect(screen.queryByText(/blocking finding is open/)).not.toBeInTheDocument()
    expect(screen.queryByText(/assignment/i)).not.toBeInTheDocument()
  })

  it('points the disabled Save at that line, so a screen reader that lands on it hears why', async () => {
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(REFUSAL)

    expect(saveButton()).toBeDisabled()
    expect(saveButton()).toHaveAccessibleDescription(REFUSAL)
  })

  it('keeps the roster’s own sentence when something other than the budget blocks too', async () => {
    answerCheckWith({ findings: [forecastOverWithCost, makeFinding({ code: 'WSC_EXPIRED', severity: 'Blocking', message: 'Screening has expired' })] })
    renderCreate()

    expect(await screen.findByText(/blocking finding is open/)).toBeInTheDocument()
    expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument()
  })

  it('orders the block: the finding, the one-line refusal, the way through, and the figures last', async () => {
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    const refusal = await screen.findByText(REFUSAL)

    const finding = screen.getByText(/Takes Core/)
    const card = screen.getByRole('region', { name: 'Emergency or safety' })
    const figures = screen.getByText('Budget figures', { selector: 'summary' })
    expect(follows(finding, refusal)).toBe(true)
    expect(follows(refusal, card)).toBe(true)
    expect(follows(card, figures)).toBe(true)
  })

  it('names the three ways out in the card: change the shift, ask an Admin, or book it as an emergency', async () => {
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()

    expect(await screen.findByText('You can change the shift so it costs less, ask an Admin to save it with a reason, or, if it is an emergency or a safety need, book it now. An Admin reviews it afterwards.')).toBeInTheDocument()
  })

  it('says nothing about "the server": the coordinator sees a refusal and a way through, not a system', async () => {
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(REFUSAL)

    expect(screen.getByRole('region', { name: 'Emergency or safety' }).textContent).not.toMatch(/\bserver\b/i)
  })
})

describe('the refusal comes into view (H2)', () => {
  const scrollIntoView = vi.fn()
  const realMatchMedia = window.matchMedia

  beforeEach(() => {
    scrollIntoView.mockReset()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    window.matchMedia = realMatchMedia
  })

  const motion = (reduce: boolean) => {
    window.matchMedia = ((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia
  }

  it('scrolls the finding, the refusal and the way through into view when the refusal first appears', async () => {
    motion(false)
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    const refusal = await screen.findByText(REFUSAL)

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    expect(scrollIntoView.mock.contexts[0]).toContainElement(refusal)
    expect(scrollIntoView.mock.contexts[0]).toContainElement(screen.getByRole('region', { name: 'Emergency or safety' }))
  })

  it('is instant under reduced motion', async () => {
    motion(true)
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(REFUSAL)

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' }))
  })

  it('does nothing for a warning, which blocks nothing and needs no way through', async () => {
    answerCheckWith({ findings: [{ ...forecastOverWithCost, severity: 'Warning' }] })
    renderCreate()
    await screen.findByText(/Takes Core/)

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not pull the panel back down on every re-check while the coordinator adjusts the times above', async () => {
    const user = userEvent.setup()
    let cost = 292.32
    mockCheckMutate.mockImplementation((_c: unknown, opts?: { onSuccess?: (r: ShiftCheckResult) => void }) =>
      opts?.onSuccess?.({ findings: [{ ...forecastOverWithCost, budget: { ...forecastOverWithFigures.budget!, shiftCost: cost } }] }))
    renderCreate()
    await screen.findByText(REFUSAL)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))

    cost = 180
    await user.clear(screen.getByLabelText(/^End time/))
    await user.type(screen.getByLabelText(/^End time/), '10:00')
    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalledTimes(2))

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('brings it into view again when the refusal has gone and comes back', async () => {
    const user = userEvent.setup()
    let refuse = true
    mockCheckMutate.mockImplementation((_c: unknown, opts?: { onSuccess?: (r: ShiftCheckResult) => void }) => opts?.onSuccess?.({ findings: refuse ? [forecastOverWithCost] : [] }))
    renderCreate()
    await screen.findByText(REFUSAL)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))

    refuse = false
    await user.clear(screen.getByLabelText(/^End time/))
    await user.type(screen.getByLabelText(/^End time/), '10:00')
    await waitFor(() => expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument())

    refuse = true
    await user.clear(screen.getByLabelText(/^End time/))
    await user.type(screen.getByLabelText(/^End time/), '15:00')
    await screen.findByText(REFUSAL)

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2))
  })
})

describe('what a screen reader is told (M7)', () => {
  const liveText = () => document.querySelector('[aria-live="polite"]')!.textContent

  it('says in the one polite summary that the shift is over budget, Save is off, and the way through is below', async () => {
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(REFUSAL)

    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1)
    expect(liveText()).toBe('Roster check complete: 1 finding, 1 blocking. Over budget. Save is off. Emergency or safety is available below.')
  })

  it('says what is left to do once the emergency path is open, and when Save is on', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(REFUSAL)

    await user.click(emergencyAction())
    expect(liveText()).toContain('Over budget. Describe the emergency to turn Save on.')

    await user.type(description(), DESCRIPTION)
    expect(liveText()).toContain('Over budget. Save as emergency is on.')
  })

  it('carries the "Budget not checked" line, which is in no live region of its own', async () => {
    answerCheckWith({ findings: [], budgetNote: 'Budget not checked: sleepover shifts are not priced yet.' })
    renderCreate()
    await screen.findByText('Budget not checked: sleepover shifts are not priced yet.')

    expect(liveText()).toBe('Roster check complete: no conflicts found. Budget not checked: sleepover shifts are not priced yet.')
  })

  it('puts focus on "Emergency or safety" again when the coordinator steps back, so it is not lost to the page', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(REFUSAL)
    await user.click(emergencyAction())
    await user.type(description(), DESCRIPTION)

    await user.click(screen.getByRole('button', { name: /^Back: this is not an emergency$/ }))

    expect(emergencyAction()).toHaveFocus()
  })
})

describe('the description (C10, L5)', () => {
  it('stops at the 1,900 characters the server accepts, so a long paste is cut rather than refused', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(REFUSAL)
    await user.click(emergencyAction())

    expect(description()).toHaveAttribute('maxlength', '1900')
  })

  it('keeps the refusal box from contradicting a Save that now works: it reads as booked as an emergency', async () => {
    const user = userEvent.setup()
    answerCheckWith({ findings: [forecastOverWithCost] })
    renderCreate()
    await screen.findByText(REFUSAL)
    const refusedRow = () => screen.getByText(/Takes Core/).closest('li')!
    expect(refusedRow().className).toMatch(/error-container/)

    await user.click(emergencyAction())
    await user.type(description(), DESCRIPTION)

    expect(saveButton()).toBeEnabled()
    expect(refusedRow().className).not.toMatch(/error-container/)
    expect(refusedRow()).toHaveTextContent('Booking as an emergency')
  })
})
