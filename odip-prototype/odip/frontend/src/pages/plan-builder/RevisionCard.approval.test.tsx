import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { DraftApprovalDto, ServiceAgreementDraftDto } from '@/api/types'
import { draftBlock, mondayWednesday, quote, settings as makeSettings } from '@/test/fixtures/planPricing'
import { RevisionCard } from './RevisionCard'

const { previewState, settingsState, approveMutate } = vi.hoisted(() => ({
  previewState: { current: {} as Record<string, unknown> },
  settingsState: { current: {} as Record<string, unknown> },
  approveMutate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useDemoJourneySimulation: () => ({ mutate: vi.fn(), isPending: false }),
  useServiceAgreementDraft: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateElectronicSigningSnapshot: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitElectronicSigningEvidence: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanPricingSettings: () => settingsState.current,
  useApprovalPreview: () => previewState.current,
  useApproveServiceAgreementDraft: () => ({ mutate: approveMutate, isPending: false }),
}))

const asRole = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role, id: 'u-1' }))

const approval = (changes: Partial<DraftApprovalDto> = {}): DraftApprovalDto => ({
  approvedAt: '2026-10-10T02:00:00Z', approvedByName: 'Alex Admin', patternsCreated: 5, patternsEnded: 0, shiftsCreated: 40, horizonEnd: '2026-12-05', firstShiftDate: '2026-10-12', ...changes,
})

/** The newest revision, in full, as the list sends it. */
const draft = (changes: Partial<ServiceAgreementDraftDto> = {}): ServiceAgreementDraftDto => ({
  id: 'd-2', participantId: 'p-1', version: 2, status: 'UnapprovedDraft', templateVersion: 't', templateDocxSha256: 'a', templatePdfSha256: 'b', state: 'NSW',
  planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-10-12', agreementEndDate: '2027-03-31',
  blocks: [draftBlock(mondayWednesday('b1'))], lines: [], isSummary: false, blockCount: 1, lineCount: 0, total: 0, caveats: [], ...changes,
})

function setUp(props: Partial<Parameters<typeof RevisionCard>[0]> = {}) {
  const onGoToBlock = vi.fn()
  render(
    <MemoryRouter>
      <RevisionCard participantId="p-1" draft={draft()} onDownload={vi.fn()} downloading={false} isNewest onGoToBlock={onGoToBlock} {...props} />
    </MemoryRouter>,
  )
  return { onGoToBlock }
}

beforeEach(() => {
  asRole('Admin')
  approveMutate.mockReset()
  settingsState.current = { data: makeSettings() }
  previewState.current = { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() }
})
afterEach(() => localStorage.clear())

describe('RevisionCard: Mark approved', () => {
  it('offers it on the newest revision that has blocks and is not approved, and says it is not signing', () => {
    setUp()

    expect(screen.getByRole('button', { name: 'Mark approved' })).toBeEnabled()
    expect(screen.getByText(/Makes this plan's weekly roster patterns and unfilled shifts/)).toBeInTheDocument()
    expect(screen.getByText(/Separate from signing/)).toBeInTheDocument()
  })

  it('keeps the e-signing status where it was: approval for rostering is a different thing from the template\'s state', () => {
    setUp()

    expect(screen.getByText('Not approved for e-signing')).toBeInTheDocument()
    expect(screen.queryByText('Approved for rostering')).not.toBeInTheDocument()
    expect(screen.queryByText('Unapproved draft')).not.toBeInTheDocument()
    expect(screen.getByText(/until this agreement template is approved for e-signing/)).toBeInTheDocument()
  })

  it('opens the confirm dialog, which reads what approval would do, and stays open until it is answered', async () => {
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('button', { name: 'Mark approved' }))

    expect(screen.getByRole('dialog', { name: 'Approve version 2 for rostering?' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Approve version 2 for rostering?' })).not.toBeInTheDocument()
  })

  it('stays enabled and says why when the preview says no: the reasons are in the dialog, the button is not hidden or disabled', async () => {
    previewState.current = {
      data: { canApprove: false, alreadyApproved: false, reasons: [{ code: 'NoItem', message: "Block 'b1': no item." , blockId: 'b1', count: 2 }], patternsToCreate: 0, patternsToEnd: 0, shiftsToCreate: 0, oldShiftsRemaining: { open: 0, assigned: 0 }, overlappingPatterns: [] },
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    }
    const user = userEvent.setup()
    const { onGoToBlock } = setUp()

    await user.click(screen.getByRole('button', { name: 'Mark approved' }))
    await user.click(screen.getByRole('button', { name: 'Go to block 1' }))

    expect(onGoToBlock).toHaveBeenCalledWith('b1', 'times')
  })

  it.each([
    ['an older revision', { isNewest: false }],
    ['a revision typed by hand, which has no blocks', { draft: draft({ blocks: [], blockCount: 0 }) }],
    ['a revision that has been approved', { draft: draft({ approval: approval() }) }],
  ])('is not offered for %s', (_, props) => {
    setUp(props)

    expect(screen.queryByRole('button', { name: 'Mark approved' })).not.toBeInTheDocument()
  })

  it('is not offered to somebody who cannot approve: a support worker, a read-only user, or a coordinator the organisation has taken off the approver list', () => {
    asRole('SupportWorker')
    const { unmount } = render(<MemoryRouter><RevisionCard participantId="p-1" draft={draft()} onDownload={vi.fn()} downloading={false} isNewest /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Mark approved' })).not.toBeInTheDocument()
    unmount()

    asRole('Coordinator')
    settingsState.current = { data: makeSettings({ approverRoles: ['Admin'] }) }
    setUp()
    expect(screen.queryByRole('button', { name: 'Mark approved' })).not.toBeInTheDocument()
    expect(screen.getByText('Your organisation lets only Admin approve plans.')).toBeInTheDocument()
  })

  it('is offered to a SuperAdmin whatever the list says, and while the settings are still loading (the server decides)', () => {
    asRole('SuperAdmin')
    settingsState.current = { data: makeSettings({ approverRoles: ['Admin'] }) }
    const { unmount } = render(<MemoryRouter><RevisionCard participantId="p-1" draft={draft()} onDownload={vi.fn()} downloading={false} isNewest /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Mark approved' })).toBeInTheDocument()
    unmount()

    asRole('Coordinator')
    settingsState.current = { data: undefined }
    setUp()
    expect(screen.getByRole('button', { name: 'Mark approved' })).toBeInTheDocument()
  })
})

describe('RevisionCard: approved', () => {
  it('says who approved it and when, the patterns it made and how far the shifts go, and names it as separate from signing', () => {
    setUp({ draft: draft({ approval: approval() }) })

    expect(screen.getByText('Approved for rostering by Alex Admin on 10 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('5 weekly patterns, unfilled shifts to Sat 5 Dec 2026.')).toBeInTheDocument()
    expect(screen.getByText('Separate from signing: the agreement itself is not signed.')).toBeInTheDocument()
    // the header says both, each for what it is: approved for rostering, and (the template's own state, untouched) not approved for e-signing
    expect(screen.getByText('Approved for rostering')).toBeInTheDocument()
    expect(screen.getByText('Not approved for e-signing')).toBeInTheDocument()
  })

  it('lays the version and its badges out as one wrapping row of whole badges: on a phone a badge moves to the next line, it is not split at the hyphen of "e-signing"', () => {
    setUp({ draft: draft({ approval: approval() }) })

    const row = screen.getByText(/^Version \d+$/).parentElement!
    expect(row).toHaveClass('flex', 'flex-wrap')
    for (const label of ['Approved for rostering', 'Not approved for e-signing']) {
      expect(screen.getByText(label)).toHaveClass('whitespace-nowrap')
      expect(screen.getByText(label).parentElement).toBe(row)
    }
  })

  it('links to the roster at the first week of shifts, for the participant, open shifts only', () => {
    setUp({ draft: draft({ approval: approval({ firstShiftDate: '2026-10-14' }) }) })

    expect(screen.getByRole('link', { name: 'Open on the roster' })).toHaveAttribute('href', '/rostering?date=2026-10-12&participant=p-1&unfilled=1')
  })

  it('agrees its nouns with the counts', () => {
    setUp({ draft: draft({ approval: approval({ patternsCreated: 1 }) }) })

    expect(screen.getByText('1 weekly pattern, unfilled shifts to Sat 5 Dec 2026.')).toBeInTheDocument()
  })

  it('says when shifts will come for a participant who was not active yet, and has no roster link to go to', () => {
    setUp({ draft: draft({ approval: approval({ shiftsCreated: 0, horizonEnd: undefined, firstShiftDate: undefined }) }) })

    expect(screen.getByText("5 weekly patterns. Unfilled shifts are added each day, once the participant is active and the agreement's dates come near.")).toBeInTheDocument()
    expect(screen.queryByText(/weeks/)).not.toBeInTheDocument()                                // no number of weeks: the organisation sets how far ahead
    expect(screen.queryByRole('link', { name: 'Open on the roster' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the shift patterns' })).toHaveAttribute('href', '/rostering/patterns')
  })

  it('puts the way to the roster on a line of its own, so the main follow-up is a target a thumb can hit', () => {
    setUp({ draft: draft({ approval: approval() }) })

    const link = screen.getByRole('link', { name: 'Open on the roster' })
    expect(link.closest('p')).toHaveTextContent(/^Open on the roster$/)
  })

  it('shows the approval on an older revision\'s summary too, so the list says which revision was approved', () => {
    setUp({ isNewest: false, draft: draft({ version: 1, isSummary: true, blocks: [], approval: approval() }) })

    expect(screen.getByText('Approved for rostering by Alex Admin on 10 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('Approved for rostering')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark approved' })).not.toBeInTheDocument()
  })

  it('says a newer approved revision replaced it, and when its patterns end, instead of offering the roster as if they were live', () => {
    setUp({
      isNewest: false,
      draft: draft({ version: 1, approval: approval() }),
      replacedBy: { version: 2, approvedAt: '2026-10-19T03:00:00Z', agreementStartDate: '2026-10-20' },
    })

    expect(screen.getByText('Replaced by version 2 on 19 Oct 2026: these patterns end on Mon 19 Oct 2026.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open on the roster' })).not.toBeInTheDocument()
    expect(screen.queryByText('Approved for rostering')).not.toBeInTheDocument()                   // the live badge is for the live approval
    expect(screen.getByText('Replaced')).toBeInTheDocument()
  })
})

describe('RevisionCard: the dates and the way a plan that is not ready looks', () => {
  it('says the agreement dates the way the rest of the screen does, not as ISO text', () => {
    setUp()

    expect(screen.getByText('NSW · Mon 12 Oct 2026 to Wed 31 Mar 2027')).toBeInTheDocument()
  })

  it('says it is not ready and makes the button secondary when the stored pricing needs a decision, and still opens the dialog', async () => {
    const user = userEvent.setup()
    setUp({ draft: draft({ pricing: quote({ needsReview: true }) }) })

    expect(screen.getByText('Not ready yet: some lines need fixing or a decision. Select to see which.')).toBeInTheDocument()
    expect(screen.queryByText(/Makes this plan's weekly roster patterns/)).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Mark approved' })
    expect(button.className).toContain('--color-card')                                           // secondary, not the primary colour that promises an approval
    await user.click(button)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps the primary button and the promise for a plan that needs nothing', () => {
    setUp({ draft: draft({ pricing: quote({ needsReview: false }) }) })

    expect(screen.getByRole('button', { name: 'Mark approved' }).className).toContain('--color-primary')
    expect(screen.queryByText(/Not ready yet/)).not.toBeInTheDocument()
  })
})

describe('RevisionCard: where focus goes', () => {
  const renderIn = (value: ServiceAgreementDraftDto) => (
    <MemoryRouter>
      <RevisionCard participantId="p-1" draft={value} onDownload={vi.fn()} downloading={false} isNewest />
    </MemoryRouter>
  )

  it('moves to the approval when the approval appears while the dialog is open: the button and the dialog go with it, and focus must not fall to the top of the page', async () => {
    const user = userEvent.setup()
    const { rerender } = render(renderIn(draft()))
    await user.click(screen.getByRole('button', { name: 'Mark approved' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    rerender(renderIn(draft({ approval: approval() })))                                         // the drafts were read again: this one is approved

    const note = screen.getByRole('group', { name: 'Approved for rostering by Alex Admin on 10 Oct 2026' })
    expect(note).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Where the page scrolls for that focus it stops clear of the sticky header and the phone's bottom bar (the first line was left under the header at 390px).
    expect(note).toHaveClass('scroll-mt-20', 'scroll-mb-24')
  })

  it('does not take focus when the page simply loads a revision that was approved already', () => {
    render(renderIn(draft({ approval: approval() })))

    expect(screen.getByRole('group', { name: /Approved for rostering by Alex Admin/ })).not.toHaveFocus()
  })
})
