import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ApprovalReasonDto, DraftApprovalPreviewDto, ServiceAgreementDraftDto } from '@/api/types'
import { draftBlock, mondayWednesday } from '@/test/fixtures/planPricing'
import { ApprovalDialog } from './ApprovalDialog'

const { previewCall, previewState, approveMutate, approveState } = vi.hoisted(() => ({
  previewCall: vi.fn(),
  previewState: { current: {} as Record<string, unknown> },
  approveMutate: vi.fn(),
  approveState: { current: { isPending: false } },
}))

vi.mock('@/api/hooks', () => ({
  useApprovalPreview: (participantId: string, id: string, enabled: boolean) => { previewCall(participantId, id, enabled); return previewState.current },
  useApproveServiceAgreementDraft: () => ({ mutate: approveMutate, ...approveState.current }),
}))

const draft = (): ServiceAgreementDraftDto => ({
  id: 'd-2', participantId: 'p-1', version: 2, status: 'UnapprovedDraft', templateVersion: 't', templateDocxSha256: 'a', templatePdfSha256: 'b', state: 'NSW',
  planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-11-02', agreementEndDate: '2027-03-31',
  blocks: [draftBlock(mondayWednesday('b1')), draftBlock(mondayWednesday('b2', { supportType: 'GroupActivity', days: ['Saturday'], start: '09:00:00', end: '15:00:00', participantsPresent: 3 }))],
  lines: [], isSummary: false, blockCount: 2, lineCount: 0, total: 0, caveats: [],
})

const preview = (changes: Partial<DraftApprovalPreviewDto> = {}): DraftApprovalPreviewDto => ({
  canApprove: true, alreadyApproved: false, reasons: [], patternsToCreate: 5, patternsToEnd: 0, shiftsToCreate: 40, horizonEnd: '2026-12-05',
  oldShiftsRemaining: { open: 0, assigned: 0 }, overlappingPatterns: [], ...changes,
})

const ready = (data: DraftApprovalPreviewDto) => { previewState.current = { data, isLoading: false, isError: false, error: null, refetch: vi.fn() } }

function setUp(props: Partial<Parameters<typeof ApprovalDialog>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onApproved: vi.fn(), onGoToBlock: vi.fn() }
  render(
    <MemoryRouter>
      <ApprovalDialog open participantId="p-1" draft={draft()} {...handlers} {...props} />
    </MemoryRouter>,
  )
  return handlers
}

beforeEach(() => {
  previewCall.mockReset(); approveMutate.mockReset()
  approveState.current = { isPending: false }
  ready(preview())
})

describe('ApprovalDialog: what approving does, said plainly', () => {
  it('asks the server what it would do only while it is open', () => {
    setUp({ open: false })

    expect(previewCall).toHaveBeenCalledWith('p-1', 'd-2', false)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('says it makes the weekly patterns and the open shifts up to the horizon, and that it is not signing', () => {
    setUp()

    const dialog = screen.getByRole('dialog', { name: 'Approve for rostering?' })
    expect(within(dialog).getByText('Creates 5 weekly patterns and the open shifts up to Sat 5 Dec 2026.')).toBeInTheDocument()
    expect(within(dialog).getByText(/separate from signing/)).toBeInTheDocument()
    expect(previewCall).toHaveBeenCalledWith('p-1', 'd-2', true)
  })

  it('says how many patterns of the revision before it end, and the day before this one starts', () => {
    ready(preview({ patternsToEnd: 5, endsFromVersion: 1, endsOn: '2026-11-01' }))
    setUp()

    expect(screen.getByText('Creates 5 weekly patterns and the open shifts up to Sat 5 Dec 2026. Ends 5 patterns from version 1 the day before Mon 2 Nov 2026.')).toBeInTheDocument()
  })

  it('agrees its nouns with its counts', () => {
    ready(preview({ patternsToCreate: 1, patternsToEnd: 1, endsFromVersion: 3, endsOn: '2026-11-01' }))
    setUp()

    expect(screen.getByText('Creates 1 weekly pattern and the open shifts up to Sat 5 Dec 2026. Ends 1 pattern from version 3 the day before Mon 2 Nov 2026.')).toBeInTheDocument()
  })

  it('names the old version\'s shifts that stay, open and assigned apart, and links to the roster at that week for the participant', () => {
    ready(preview({ patternsToEnd: 5, endsFromVersion: 1, endsOn: '2026-11-01', oldShiftsRemaining: { open: 21, assigned: 3, firstDate: '2026-11-04', fromVersion: 1 } }))
    setUp()

    expect(screen.getByText(/21 open and 3 assigned shifts from version 1 on or after Mon 2 Nov 2026 stay on the roster\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review them' })).toHaveAttribute('href', '/rostering?date=2026-11-02&participant=p-1')
  })

  it('draws no sentence about old shifts when there are none', () => {
    setUp()

    expect(screen.queryByText(/stay on the roster/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Review them' })).not.toBeInTheDocument()
  })

  it('says when shifts will come for a participant who is not active yet, and makes only the patterns', () => {
    ready(preview({ shiftsToCreate: 0, horizonEnd: '2026-12-05', shiftsNote: 'Open shifts are created once Jordan is active.' }))
    setUp()

    expect(screen.getByText('Creates 5 weekly patterns.')).toBeInTheDocument()
    expect(screen.getByText('Open shifts are created once Jordan is active.')).toBeInTheDocument()
  })
})

describe('ApprovalDialog: hand-made patterns that overlap', () => {
  const overlapping = preview({
    overlappingPatterns: [
      { id: 'hp-1', dayOfWeek: 'Monday', startTime: '12:00:00', endTime: '15:00:00', endsNextDay: false, effectiveFrom: '2026-01-01', notes: 'Weekly outing' },
      { id: 'hp-2', dayOfWeek: 'Friday', startTime: '20:00:00', endTime: '06:00:00', endsNextDay: true, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' },
    ],
  })

  it('lists them, says they are never changed, and holds Approve until the box is ticked', async () => {
    ready(overlapping)
    const user = userEvent.setup()
    setUp()

    expect(screen.getByText('2 hand-made patterns overlap')).toBeInTheDocument()
    expect(screen.getByText(/Mon 12pm–3pm/)).toBeInTheDocument()
    expect(screen.getByText('Weekly outing')).toBeInTheDocument()
    expect(screen.getByText(/Fri 8pm–6am \+1/)).toBeInTheDocument()
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /These hand-made patterns stay as they are/ }))

    expect(approve).toBeEnabled()
    await user.click(approve)
    expect(approveMutate).toHaveBeenCalledTimes(1)
    expect(approveMutate.mock.calls[0][0]).toEqual({ participantId: 'p-1', draftId: 'd-2', acknowledgeOverlaps: true })
  })

  it('shows no box when nothing overlaps and sends the acknowledgement as false', async () => {
    const user = userEvent.setup()
    setUp()

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(approveMutate.mock.calls[0][0]).toEqual({ participantId: 'p-1', draftId: 'd-2', acknowledgeOverlaps: false })
  })
})

describe('ApprovalDialog: approving', () => {
  it('closes and tells the page when the server approves', async () => {
    approveMutate.mockImplementation((_vars, options) => options.onSuccess({ id: 'd-2' }))
    const user = userEvent.setup()
    const { onApproved } = setUp()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onApproved).toHaveBeenCalledTimes(1)
  })

  it('keeps the dialog open and says what the server said when it refuses, every reason', async () => {
    approveMutate.mockImplementation((_vars, options) => options.onError({ response: { status: 400, data: { success: false, errors: ['First reason.', 'Second reason.'] } } }))
    const user = userEvent.setup()
    const { onApproved } = setUp()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onApproved).not.toHaveBeenCalled()
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('First reason.')).toBeInTheDocument()
    expect(within(alert).getByText('Second reason.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })

  it('says a newer revision exists when somebody saved one meanwhile (409)', async () => {
    approveMutate.mockImplementation((_vars, options) => options.onError({ response: { status: 409, data: { success: false, code: 'draft-superseded', errors: ['A newer revision of this agreement draft exists. Approve the latest revision instead.'] } } }))
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(within(screen.getByRole('alert')).getByText('A newer revision of this agreement draft exists. Approve the latest revision instead.')).toBeInTheDocument()
  })

  it('holds the button while it is working, and Cancel closes without approving', async () => {
    approveState.current = { isPending: true }
    const user = userEvent.setup()
    const { onClose } = setUp()

    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(approveMutate).not.toHaveBeenCalled()
  })
})

describe('ApprovalDialog: when it cannot be approved yet', () => {
  const reasons: ApprovalReasonDto[] = [
    { code: 'NoItem', message: "Block 'b2': no item for the night.", blockId: 'b2', count: 4, firstDate: '2026-11-03' },
    { code: 'HolidayUndecided', message: "Block 'b1': a public holiday has no decision yet (Labour Day on 2026-10-05). Choose Charge or Skip for it, then save a new revision.", blockId: 'b1', count: 1, firstDate: '2026-10-05' },
    { code: 'TimeZoneMismatch', message: "This agreement is delivered in QLD (Australia/Brisbane), but your organisation's roster runs on Australia/Sydney time." },
  ]

  it('lists each reason in the words of the block numbers the screen uses, and offers no Approve', () => {
    ready(preview({ canApprove: false, reasons, patternsToCreate: 0, shiftsToCreate: 0 }))
    setUp()

    const dialog = screen.getByRole('dialog', { name: 'Not ready to approve' })
    const items = within(dialog).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    // The engine's own reasons keep their title and say how many shifts are meant; the sentences only approval has are complete as the server wrote them, so they are not given a title that says it again.
    expect(items[0]).toHaveTextContent('Part of this block has no price item: Block 2: no item for the night. (4 shifts, from Tue 3 Nov 2026)')
    expect(within(items[1]).getByText(/^Block 1: a public holiday has no decision yet \(Labour Day on Mon 5 Oct 2026\)\. Choose Charge or Skip for it, then save a new revision\.$/)).toBeInTheDocument()
    expect(within(items[2]).getByText(/^This agreement is delivered in QLD \(Australia\/Brisbane\), but your organisation's roster runs on Australia\/Sydney time\.$/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('does not count the shifts of a holiday reason a second time: its sentence already says how many holidays and the first', () => {
    ready(preview({
      canApprove: false,
      reasons: [{ code: 'HolidayUndecided', message: "Block 'b1': 5 public holidays have no decision yet (the first is Labour Day on 2026-10-05). Choose Charge or Skip for each, then save a new revision.", blockId: 'b1', count: 5, firstDate: '2026-10-05' }],
    }))
    setUp()

    const item = within(screen.getByRole('dialog', { name: 'Not ready to approve' })).getByRole('listitem')
    expect(within(item).getByText(/^Block 1: 5 public holidays have no decision yet \(the first is Labour Day on Mon 5 Oct 2026\)\. Choose Charge or Skip for each, then save a new revision\.$/)).toBeInTheDocument()
    expect(item).not.toHaveTextContent('5 shifts')
  })

  it('takes you to the block a reason is about, at the step that fixes it, and closes', async () => {
    ready(preview({ canApprove: false, reasons }))
    const user = userEvent.setup()
    const { onGoToBlock, onClose } = setUp()

    await user.click(screen.getByRole('button', { name: 'Go to block 2' }))

    expect(onGoToBlock).toHaveBeenCalledWith('b2', 'times')                      // NoItem is fixed on the times step
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Go to block 1' }))
    expect(onGoToBlock).toHaveBeenLastCalledWith('b1', 'review')                // a holiday is decided on the review step
    expect(screen.queryByRole('button', { name: /Go to block 3/ })).not.toBeInTheDocument()   // a reason about the whole revision has no block to go to
  })

  it('says a hand-typed revision has to be rebuilt from blocks', () => {
    ready(preview({ canApprove: false, reasons: [{ code: 'HandTyped', message: "Rebuild it from blocks to approve it. This revision's lines were typed by hand." }] }))
    setUp()

    expect(screen.getByText(/Rebuild it from blocks to approve it/)).toBeInTheDocument()
  })
})

describe('ApprovalDialog: loading and failing', () => {
  it('says it is checking while the preview is on its way, and offers nothing to press but Cancel', () => {
    previewState.current = { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() }
    setUp()

    expect(screen.getByRole('status')).toHaveTextContent('Loading approval summary…')
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('offers to try again when the preview could not be read', async () => {
    const refetch = vi.fn()
    previewState.current = { data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch }
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says in words when the role may not approve, with the server\'s own sentence, and no retry', () => {
    previewState.current = { data: undefined, isLoading: false, isError: true, error: { response: { status: 403, data: { success: false, errors: ['Your role cannot approve agreements in your organisation.'] } } }, refetch: vi.fn() }
    setUp()

    expect(screen.getByText('Your role cannot approve agreements in your organisation.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
