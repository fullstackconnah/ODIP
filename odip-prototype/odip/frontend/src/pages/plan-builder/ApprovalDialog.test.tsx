import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ApprovalReasonDto, DraftApprovalPreviewDto, ServiceAgreementDraftDto } from '@/api/types'
import { REASON_COPY } from '@/lib/planQuote'
import { draftBlock, mondayWednesday } from '@/test/fixtures/planPricing'
import { ApprovalDialog } from './ApprovalDialog'
import { BUDGET_WARNINGS_TITLE } from '@/components/BudgetWarnings'

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

  it('names the version, says what it makes and up to when, that it keeps adding shifts, that it is not signing, and that it cannot be undone', () => {
    setUp()

    const dialog = screen.getByRole('dialog', { name: 'Approve version 2 for rostering?' })
    // A short line for each fact, so it scans: the patterns, the shifts, (below) what ends.
    expect(within(dialog).getByText('Creates 5 weekly patterns, Mon 2 Nov 2026 to Wed 31 Mar 2027.')).toBeInTheDocument()
    expect(within(dialog).getByText('Makes 40 unfilled shifts up to Sat 5 Dec 2026. After that, unfilled shifts are added each day until the agreement ends.')).toBeInTheDocument()
    expect(within(dialog).getByText(/separate from signing: nothing is signed or sent/)).toBeInTheDocument()
    expect(within(dialog).getByText("You can't undo an approval. To change the roster later, save a new revision and approve that.")).toBeInTheDocument()
    expect(previewCall).toHaveBeenCalledWith('p-1', 'd-2', true)
  })

  it('does not promise later shifts when the agreement ends inside the horizon: everything is made now', () => {
    ready(preview({ horizonEnd: '2027-03-31' }))
    setUp()

    expect(screen.getByText('Makes 40 unfilled shifts up to Wed 31 Mar 2027.')).toBeInTheDocument()
    expect(screen.queryByText(/After that/)).not.toBeInTheDocument()
  })

  it('says each fact on a line of its own: what it creates, the shifts it makes, and what ends', () => {
    ready(preview({ patternsToEnd: 5, endsFromVersion: 1, endsOn: '2026-11-01' }))
    setUp()

    const lines = screen.getByText('Creates 5 weekly patterns, Mon 2 Nov 2026 to Wed 31 Mar 2027.').parentElement!
    expect([...lines.children].map(line => line.textContent)).toEqual([
      'Creates 5 weekly patterns, Mon 2 Nov 2026 to Wed 31 Mar 2027.',
      'Makes 40 unfilled shifts up to Sat 5 Dec 2026. After that, unfilled shifts are added each day until the agreement ends.',
      'Ends 5 patterns from version 1 the day before Mon 2 Nov 2026.',
    ])
  })

  // "Added each day" is the daily top-up's work: RosterTopUp:Enabled=false stops the job, and an approval then makes what it makes and nothing more.
  it('promises nothing past the horizon when the daily top-up is off, and says no shifts are made when there are none to make', () => {
    ready(preview({ topUpEnabled: false }))
    const { unmount } = render(<MemoryRouter><ApprovalDialog open participantId="p-1" draft={draft()} onClose={vi.fn()} onApproved={vi.fn()} /></MemoryRouter>)

    expect(screen.getByText('Makes 40 unfilled shifts up to Sat 5 Dec 2026.')).toBeInTheDocument()
    expect(screen.queryByText(/added each day/)).not.toBeInTheDocument()
    unmount()

    ready(preview({ topUpEnabled: false, shiftsToCreate: 0, horizonEnd: undefined }))
    render(<MemoryRouter><ApprovalDialog open participantId="p-1" draft={draft()} onClose={vi.fn()} onApproved={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText('No unfilled shifts are made now.')).toBeInTheDocument()
    expect(screen.queryByText(/added each day/)).not.toBeInTheDocument()
  })

  it('reads a server that does not say whether the top-up is on as on, which it was', () => {
    ready(preview({ topUpEnabled: undefined }))
    setUp()

    expect(screen.getByText(/After that, unfilled shifts are added each day until the agreement ends\./)).toBeInTheDocument()
  })

  it('says how many patterns of the revision before it end, and the day before this one starts', () => {
    ready(preview({ patternsToEnd: 5, endsFromVersion: 1, endsOn: '2026-11-01' }))
    setUp()

    expect(screen.getByText(/Ends 5 patterns from version 1 the day before Mon 2 Nov 2026\./)).toBeInTheDocument()
  })

  it('agrees its nouns with its counts', () => {
    ready(preview({ patternsToCreate: 1, shiftsToCreate: 1, patternsToEnd: 1, endsFromVersion: 3, endsOn: '2026-11-01' }))
    setUp()

    expect(screen.getByText('Creates 1 weekly pattern, Mon 2 Nov 2026 to Wed 31 Mar 2027.')).toBeInTheDocument()
    expect(screen.getByText(/Makes 1 unfilled shift up to Sat 5 Dec 2026\./)).toBeInTheDocument()
    expect(screen.getByText(/Ends 1 pattern from version 3 the day before Mon 2 Nov 2026\./)).toBeInTheDocument()
  })

  it("names the old version's shifts that stay, unfilled and assigned apart, says the new ones will sit beside them, and offers them on the roster in a new tab", () => {
    ready(preview({ patternsToEnd: 5, endsFromVersion: 1, endsOn: '2026-11-01', oldShiftsRemaining: { open: 21, assigned: 3, firstDate: '2026-11-04', fromVersion: 1 } }))
    setUp()

    expect(screen.getByText(/21 unfilled and 3 assigned shifts from version 1, from Wed 4 Nov 2026 on, stay on the roster\. The new version's unfilled shifts will sit beside them on the same days\./)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /See them on the roster/ })
    expect(link).toHaveAttribute('href', '/rostering?date=2026-11-02&participant=p-1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('says it in the singular for one old shift', () => {
    ready(preview({ patternsToEnd: 5, endsFromVersion: 1, endsOn: '2026-11-01', oldShiftsRemaining: { open: 1, assigned: 0, firstDate: '2026-11-04', fromVersion: 1 } }))
    setUp()

    expect(screen.getByText(/1 unfilled and 0 assigned shift from version 1, from Wed 4 Nov 2026 on, stays on the roster. The new version's unfilled shifts will sit beside it on the same days./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /See it on the roster/ })).toBeInTheDocument()
  })

  it('draws no sentence about old shifts when there are none', () => {
    setUp()

    expect(screen.queryByText(/stay on the roster/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /on the roster/ })).not.toBeInTheDocument()
  })

  it('says when shifts will come for a participant who is not active yet, and makes only the patterns', () => {
    ready(preview({ shiftsToCreate: 0, horizonEnd: '2026-12-05', shiftsNote: 'Unfilled shifts are created once Jordan is active.' }))
    setUp()

    expect(screen.getByText('Creates 5 weekly patterns, Mon 2 Nov 2026 to Wed 31 Mar 2027.')).toBeInTheDocument()
    expect(screen.queryByText(/^Makes /)).not.toBeInTheDocument()
    expect(screen.getByText('Unfilled shifts are created once Jordan is active.')).toBeInTheDocument()
  })

  it('says when no shifts are due yet because the agreement starts beyond the horizon, without a number of weeks', () => {
    ready(preview({ shiftsToCreate: 0, horizonEnd: undefined }))
    setUp()

    expect(screen.getByText("No unfilled shifts yet. They are added each day as the agreement's dates come near.")).toBeInTheDocument()
    expect(screen.queryByText(/weeks/)).not.toBeInTheDocument()
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

  it('says it in the singular for one overlapping pattern, down to the box and its label', async () => {
    ready(preview({ overlappingPatterns: [overlapping.overlappingPatterns[0]] }))
    const user = userEvent.setup()
    setUp()

    expect(screen.getByText('1 hand-made pattern overlaps')).toBeInTheDocument()
    expect(screen.getByText('It is not ended or changed. The new patterns are made beside it, so the roster will show shifts for both until you decide.')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'This hand-made pattern stays as it is. I have checked it.' }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
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

  it('runs the server\'s sentences for a refusal through the screen\'s own words: block numbers and dates a person reads', async () => {
    approveMutate.mockImplementation((_vars, options) => options.onError({ response: { status: 400, data: { success: false, errors: ["Block 'b2': no item on 2026-11-03."] } } }))
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(within(screen.getByRole('alert')).getByText('Block 2: no item on Tue 3 Nov 2026.')).toBeInTheDocument()
  })

  it('holds everything that would close it while the approval is on its way: the button, Cancel, the cross, Escape and the backdrop', async () => {
    approveState.current = { isPending: true }
    const user = userEvent.setup()
    const { onClose } = setUp()

    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('dialog').parentElement!)                    // the backdrop

    expect(onClose).not.toHaveBeenCalled()
    expect(approveMutate).not.toHaveBeenCalled()
  })

  // The hold above ends when the request does. The shared client has no timeout, so the approval sets its own (APPROVE_TIMEOUT_MS): a request given up on rejects with the client's timeout error, and the dialog
  // must then be one a person can leave, and must not say "not approved": no answer is not a refusal, and the revision may well have been approved (approving twice is safe, so looking and trying again are both fine).
  const TIMEOUT = { code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' }

  it('says it took too long, and to check the card, when the request is given up on: not that it was refused', async () => {
    approveMutate.mockImplementation((_vars, options) => options.onError(TIMEOUT))
    const user = userEvent.setup()
    const { onApproved } = setUp()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onApproved).not.toHaveBeenCalled()
    const callout = screen.getByRole('alert')
    expect(within(callout).getByText('No answer came back')).toBeInTheDocument()
    expect(within(callout).getByText('It took too long. Close this and check the card: it may have been approved. If it was not, approve it again (approving twice is safe).')).toBeInTheDocument()
    expect(screen.queryByText('Not approved')).not.toBeInTheDocument()
    expect(screen.queryByText(/could not approve this revision/)).not.toBeInTheDocument()
  })

  it('gives every way out back once the request has been given up on, and Approve can be pressed again', async () => {
    approveMutate.mockImplementationOnce((_vars, options) => options.onError(TIMEOUT))                     // the first press times out; the request is over, so nothing is pending any more
    const user = userEvent.setup()
    const { onClose } = setUp()
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(4)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(approveMutate).toHaveBeenCalledTimes(2)                                                       // asking again is allowed
  })

  it('recognises a time limit by its code and message, and takes any other failure for what it says', async () => {
    for (const [error, shown] of [
      [{ code: 'ETIMEDOUT', message: 'timeout of 30000ms exceeded' }, 'No answer came back'],
      [{ code: 'ECONNABORTED', message: 'Request aborted' }, 'Not approved'],                                // aborted by something else: not a time limit
      [{ code: 'ERR_NETWORK', message: 'Network Error' }, 'Not approved'],
    ] as const) {
      approveMutate.mockReset()
      approveMutate.mockImplementation((_vars, options) => options.onError(error))
      const user = userEvent.setup()
      const { unmount } = render(<MemoryRouter><ApprovalDialog open participantId="p-1" draft={draft()} onClose={vi.fn()} onApproved={vi.fn()} /></MemoryRouter>)
      await user.click(screen.getByRole('button', { name: 'Approve' }))
      expect(within(screen.getByRole('alert')).getByText(shown), JSON.stringify(error)).toBeInTheDocument()
      unmount()
    }
  })

  it('closes with Cancel, Escape and the backdrop when nothing is on its way', async () => {
    const user = userEvent.setup()
    const { onClose } = setUp()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('dialog').parentElement!)

    expect(onClose).toHaveBeenCalledTimes(3)
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

  it('writes what to do under each engine reason, and a next step under the time zones, in muted words; the approval-only sentences already say it', () => {
    ready(preview({ canApprove: false, reasons }))
    setUp()

    const items = within(screen.getByRole('dialog', { name: 'Not ready to approve' })).getAllByRole('listitem')
    expect(within(items[0]).getByText(REASON_COPY.NoItem.advice)).toBeInTheDocument()
    expect(within(items[2]).getByText("Check the delivery state of this draft, or ask an Admin to check the organisation's state in Settings.")).toBeInTheDocument()
    // a sentence that already says what to do gets no second line under it: the badge, the sentence and the way to the block, and nothing else
    expect(items[1].textContent).toBe('ReviewBlock 1: a public holiday has no decision yet (Labour Day on Mon 5 Oct 2026). Choose Charge or Skip for it, then save a new revision.Go to block 1')
  })

  it('opens with what the person does next, and says nothing has been changed', () => {
    ready(preview({ canApprove: false, reasons }))
    setUp()

    expect(screen.getByText('Nothing has been changed. Fix each item, then approve the version you save.')).toBeInTheDocument()
  })

  it('drops that preface for a revision that has been superseded: the thing to do is a different one', () => {
    ready(preview({ canApprove: false, reasons: [{ code: 'Superseded', message: 'A newer revision of this agreement draft exists. Approve the latest revision instead.' }] }))
    setUp()

    expect(screen.queryByText(/Fix each item/)).not.toBeInTheDocument()
    expect(screen.getByText('A newer revision of this agreement draft exists. Approve the latest revision instead.')).toBeInTheDocument()
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

describe('ApprovalDialog: what the shifts would do to the budget (budget phase 3)', () => {
  const warning = {
    poolName: 'Core (flexible)', periodStart: '2026-10-01', periodEnd: '2026-12-31', available: 1000, used: 0, forecast: 9600, added: 9600, overBy: 8600, count: 40,
    message: 'These 40 shifts take Core (flexible) to $9,600.00 of $1,000.00 for 1 Oct–31 Dec 2026.',
  }

  it('shows the server\u2019s warning for each pool and period as a warning only, and still lets the revision be approved', async () => {
    const user = userEvent.setup()
    ready(preview({ budgetWarnings: [warning] }))
    const handlers = setUp()

    const dialog = screen.getByRole('dialog', { name: 'Approve version 2 for rostering?' })
    expect(within(dialog).getByText('These 40 shifts take Core (flexible) to $9,600.00 of $1,000.00 for 1 Oct–31 Dec 2026.')).toBeInTheDocument()
    expect(within(dialog).getByText('This is a warning only. Approving is not blocked.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))

    expect(approveMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-2', acknowledgeOverlaps: false }, expect.anything())
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it('says nothing about a budget when the server sent no warning', () => {
    setUp()

    expect(screen.queryByText(BUDGET_WARNINGS_TITLE)).not.toBeInTheDocument()
  })

  it('is not part of a refusal: a revision that cannot be approved lists its reasons and no budget warning', () => {
    ready(preview({ canApprove: false, reasons: [{ code: 'HandTyped', message: 'Rebuild it from blocks.' }], budgetWarnings: [warning] }))
    setUp()

    expect(screen.queryByText(BUDGET_WARNINGS_TITLE)).not.toBeInTheDocument()
  })
})
