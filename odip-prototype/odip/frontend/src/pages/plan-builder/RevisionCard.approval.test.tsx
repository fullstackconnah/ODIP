import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { DraftApprovalDto, ServiceAgreementDraftDto } from '@/api/types'
import { draftBlock, mondayWednesday, settings as makeSettings } from '@/test/fixtures/planPricing'
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
    expect(screen.getByText(/Makes this plan's weekly roster patterns and open shifts/)).toBeInTheDocument()
    expect(screen.getByText(/Separate from signing/)).toBeInTheDocument()
  })

  it('keeps the e-signing status where it was: approval for rostering is a different thing from the template\'s state', () => {
    setUp()

    expect(screen.getByText('Unapproved draft')).toBeInTheDocument()
    expect(screen.queryByText('Approved for rostering')).not.toBeInTheDocument()
  })

  it('opens the confirm dialog, which reads what approval would do, and stays open until it is answered', async () => {
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('button', { name: 'Mark approved' }))

    expect(screen.getByRole('dialog', { name: 'Approve for rostering?' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Approve for rostering?' })).not.toBeInTheDocument()
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
    expect(screen.getByText('5 weekly patterns, open shifts to Sat 5 Dec 2026.')).toBeInTheDocument()
    expect(screen.getByText(/Approved for rostering, separate from signing/)).toBeInTheDocument()
    expect(screen.getByText('Unapproved draft')).toBeInTheDocument()                         // the template's own e-signing state is untouched
  })

  it('links to the roster at the first week of shifts, for the participant, open shifts only', () => {
    setUp({ draft: draft({ approval: approval({ firstShiftDate: '2026-10-14' }) }) })

    expect(screen.getByRole('link', { name: 'Open on the roster' })).toHaveAttribute('href', '/rostering?date=2026-10-12&participant=p-1&unfilled=1')
  })

  it('agrees its nouns with the counts', () => {
    setUp({ draft: draft({ approval: approval({ patternsCreated: 1 }) }) })

    expect(screen.getByText('1 weekly pattern, open shifts to Sat 5 Dec 2026.')).toBeInTheDocument()
  })

  it('says when shifts will come for a participant who was not active yet, and has no roster link to go to', () => {
    setUp({ draft: draft({ approval: approval({ shiftsCreated: 0, horizonEnd: undefined, firstShiftDate: undefined }) }) })

    expect(screen.getByText(/Open shifts are created each day as the dates come within 8 weeks, once the participant is active/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open on the roster' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the shift patterns' })).toHaveAttribute('href', '/rostering/patterns')
  })

  it('shows the approval on an older revision\'s summary too, so the list says which revision was approved', () => {
    setUp({ isNewest: false, draft: draft({ version: 1, isSummary: true, blocks: [], approval: approval() }) })

    expect(screen.getByText('Approved for rostering by Alex Admin on 10 Oct 2026')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark approved' })).not.toBeInTheDocument()
  })
})
