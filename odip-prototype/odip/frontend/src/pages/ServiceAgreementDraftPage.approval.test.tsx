import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { DraftApprovalDto, ServiceAgreementDraftDto } from '@/api/types'
import { budgetOf, draftBlock, mondayWednesday, quote, settings as makeSettings } from '@/test/fixtures/planPricing'
import ServiceAgreementDraftPage from './ServiceAgreementDraftPage'

const { createMutate, drafts, participant, budget, budgetCall, previewState } = vi.hoisted(() => ({
  createMutate: vi.fn(), drafts: vi.fn(), participant: vi.fn(), budget: vi.fn(), budgetCall: vi.fn(), previewState: { current: {} as Record<string, unknown> },
}))
vi.mock('@/api/hooks', () => ({
  useParticipant: () => participant(),
  useServiceAgreementDrafts: () => drafts(),
  useServiceAgreementDraft: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateServiceAgreementDraft: () => ({ mutate: createMutate, isPending: false }),
  useDownloadServiceAgreementDraftPdf: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCreateElectronicSigningSnapshot: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitElectronicSigningEvidence: () => ({ mutate: vi.fn(), isPending: false }),
  useDemoJourneySimulation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useApprovalPreview: () => previewState.current,
  useApproveServiceAgreementDraft: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanPricingSettings: () => ({ data: makeSettings() }),
  usePlanBudget: (blocks: unknown[], from: string, to: string, enabled: boolean) => { budgetCall(blocks, from, to, enabled); return budget() },
  usePlanBlockQuote: () => ({ data: quote(), isLoading: false, isError: false, refetch: vi.fn() }),
  useAgreementCheck: () => ({ data: undefined, isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn() }),
}))

const asRole = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role, id: 'u-1' }))

const approval = (changes: Partial<DraftApprovalDto> = {}): DraftApprovalDto => ({
  approvedAt: '2026-10-10T02:00:00Z', approvedByName: 'Alex Admin', patternsCreated: 5, patternsEnded: 0, shiftsCreated: 40, horizonEnd: '2026-12-05', firstShiftDate: '2026-10-12', ...changes,
})

const storedPricing = quote({
  totals: { ...quote().totals, amount: 30610.28, supportHours: 416, byBlock: [{ blockId: 'b1', amount: 30610.28, supportHours: 416, occurrences: 104, skippedOccurrences: 0 }] },
})

/** The newest revision, in full, as the list sends it. */
const revision = (changes: Partial<ServiceAgreementDraftDto> = {}): ServiceAgreementDraftDto => ({
  id: 'd-2', participantId: 'p-1', version: 2, status: 'UnapprovedDraft', templateVersion: 't', templateDocxSha256: 'a', templatePdfSha256: 'b', state: 'NSW',
  planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-10-12', agreementEndDate: '2027-03-31',
  blocks: [draftBlock(mondayWednesday('b1'))], pricing: storedPricing, lines: [], isSummary: false, blockCount: 1, lineCount: 0, total: 30610.28, caveats: [], ...changes,
})

const show = (...list: ServiceAgreementDraftDto[]) => drafts.mockReturnValue({ data: list, isLoading: false, isError: false, refetch: vi.fn() })

function renderPage() {
  const router = createMemoryRouter([{ path: '/participants/:id/agreement-draft', element: <ServiceAgreementDraftPage /> }], { initialEntries: ['/participants/p-1/agreement-draft'] })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  asRole('Admin')
  participant.mockReturnValue({ data: { id: 'p-1', fullName: 'Marcus Tran', ndisNumber: '430000001', dateOfBirth: '1990-01-02' }, isLoading: false, isError: false, refetch: vi.fn() })
  // The live quote says something else, so a figure on screen that is the stored one cannot be the live one.
  budget.mockReturnValue({ data: { ...budgetOf('b1'), period: quote({ totals: { ...quote().totals, amount: 1.23, byBlock: [{ blockId: 'b1', amount: 1.23, supportHours: 1, occurrences: 1, skippedOccurrences: 0 }] } }) }, isError: false, isFetching: false, error: null, refetch: vi.fn() })
  previewState.current = { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() }
  createMutate.mockReset(); budgetCall.mockReset()
})
afterEach(() => localStorage.clear())

describe('ServiceAgreementDraftPage: when the newest revision is approved', () => {
  it('shows the plan read only with its note, the figures it was approved at, and nothing that changes it', () => {
    show(revision({ approval: approval() }))
    renderPage()

    const plan = screen.getByRole('region', { name: 'Support plan' })
    expect(within(plan).getByText('Approved for rostering. Start a new revision to change.')).toBeInTheDocument()
    expect(within(plan).getByText('Mon, Wed · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
    expect(within(plan).getAllByText('$30,610.28')).toHaveLength(2)                    // the stored answer (the block, and the total under the blocks), not the live quote's $1.23
    expect(within(plan).queryByText('$1.23')).not.toBeInTheDocument()
    expect(budgetCall.mock.calls.every(call => call[3] === false)).toBe(true)           // nothing is priced live while it is locked
    expect(screen.queryByRole('button', { name: 'Add block' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
    // the details are facts, not a form of greyed-out inputs
    expect(screen.queryByLabelText('Agreement start')).not.toBeInTheDocument()
    expect(screen.getByText('Mon 12 Oct 2026 to Wed 31 Mar 2027')).toBeInTheDocument()
    expect(screen.getByText('Wed 1 Jul 2026 to Wed 30 Jun 2027')).toBeInTheDocument()
  })

  it("gives the plan the agreement's total as its stored figures say it, since the budget bar is not drawn for a plan that cannot change", () => {
    show(revision({ approval: approval() }))
    renderPage()

    expect(within(screen.getByRole('region', { name: 'Support plan' })).getByText(/^The agreement:/).textContent).toBe('The agreement: $30,610.28, 416 h of support.')
  })

  it("puts focus on the plan's heading when Start a new revision is pressed: the button it was on is gone, and the heading is brought to the top only once the page has unlocked", async () => {
    show(revision({ approval: approval() }))
    renderPage()
    const user = userEvent.setup()
    // jsdom has no scrollIntoView: a stand-in that notes what the page looked like the moment it was called.
    const proto = Element.prototype as { scrollIntoView?: (arg?: boolean | ScrollIntoViewOptions) => void }
    const original = proto.scrollIntoView
    const calls: { id: string; options: unknown; unlocked: boolean }[] = []
    proto.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
      calls.push({ id: this.id, options, unlocked: screen.queryByRole('button', { name: 'Start a new revision' }) === null && screen.getByLabelText('Agreement start') !== null })
    }
    try {
      await user.click(screen.getByRole('button', { name: 'Start a new revision' }))

      await waitFor(() => expect(document.activeElement).toBe(document.getElementById('plan-heading')))
      // Unlocking turns a short list of facts into a tall form above the plan: the heading is moved to the top of the view after that, not before it (it used to be focused first and then pushed down).
      expect(calls).toEqual([{ id: 'plan-heading', options: { block: 'start' }, unlocked: true }])
      expect(document.getElementById('plan-heading')).toHaveClass('scroll-mt-20')                 // so it stops clear of the sticky header
    } finally {
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
  })

  it('says on an older approved revision that a newer one replaced it, and keeps the roster link for the live one only', () => {
    show(
      revision({ id: 'd-3', version: 3, agreementStartDate: '2026-10-20', approval: approval({ approvedAt: '2026-10-19T03:00:00Z', approvedByName: 'Casey Coordinator' }) }),
      revision({ approval: approval() }),
    )
    renderPage()

    expect(screen.getByText('Replaced by version 3 on 19 Oct 2026: these patterns end on Mon 19 Oct 2026.')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Open on the roster' })).toHaveLength(1)
  })

  it('says who approved it, and where to see the shifts, on the revision\'s card', () => {
    show(revision({ approval: approval() }))
    renderPage()

    expect(screen.getByText('Approved for rostering by Alex Admin on 10 Oct 2026')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open on the roster' })).toHaveAttribute('href', '/rostering?date=2026-10-12&participant=p-1&unfilled=1')
    expect(screen.queryByRole('button', { name: 'Mark approved' })).not.toBeInTheDocument()
  })

  it('unlocks the working copy on Start a new revision, and persists nothing until Save', async () => {
    show(revision({ approval: approval() }))
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Start a new revision' }))

    expect(createMutate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add block' })).toBeInTheDocument()
    expect(screen.getByLabelText('Agreement start')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Start a new revision' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(createMutate).toHaveBeenCalledTimes(1)
    expect(createMutate.mock.calls[0][0].data).toMatchObject({ baseVersion: 2, agreementStartDate: '2026-10-12', state: 'NSW' })     // the next version, started from the approved one
  })

  it('locks again when the revision that was just saved is itself approved: the unlock was for the revision it was pressed on', async () => {
    show(revision({ approval: approval() }))
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Start a new revision' }))
    expect(screen.getByRole('button', { name: 'Add block' })).toBeInTheDocument()

    show(revision({ id: 'd-3', version: 3, approval: approval({ approvedByName: 'Casey Coordinator' }) }), revision({ approval: approval() }))
    fireEvent.change(screen.getByLabelText('Representative'), { target: { value: 'R. Tran' } })           // any change on the page draws it again

    expect(screen.getByRole('button', { name: 'Start a new revision' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add block' })).not.toBeInTheDocument()
  })

  it('is read only for somebody who cannot edit, with the same note, and offers them no way to start a revision', () => {
    asRole('ReadOnly')
    show(revision({ approval: approval() }))
    renderPage()

    expect(screen.queryByRole('button', { name: 'Start a new revision' })).not.toBeInTheDocument()
    expect(screen.getByText('You can read this plan; Admins and Coordinators change it.')).toBeInTheDocument()
  })
})

describe('ServiceAgreementDraftPage: a revision not yet approved', () => {
  it('stays editable and offers Mark approved on its card, with the plan above it unchanged', () => {
    show(revision())
    renderPage()

    expect(screen.getByRole('button', { name: 'Add block' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark approved' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start a new revision' })).not.toBeInTheDocument()
  })

  it('offers Mark approved on the newest revision only, not on an older summary', () => {
    show(revision(), revision({ id: 'd-1', version: 1, isSummary: true, blocks: [], blockCount: 1 }))
    renderPage()

    expect(screen.getAllByRole('button', { name: 'Mark approved' })).toHaveLength(1)
  })

  it('takes you to the block a refusal is about: Go to block puts focus on the chip that fixes it', async () => {
    previewState.current = {
      data: { canApprove: false, alreadyApproved: false, patternsToCreate: 0, patternsToEnd: 0, shiftsToCreate: 0, oldShiftsRemaining: { open: 0, assigned: 0 }, overlappingPatterns: [],
        reasons: [{ code: 'HolidayUndecided', message: "Block 'b1': a public holiday has no decision yet.", blockId: 'b1', count: 1 }] },
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    }
    show(revision())
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Mark approved' }))
    await user.click(screen.getByRole('button', { name: 'Go to block 1' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review prices of block 1' })).toHaveFocus())
  })
})

describe('ServiceAgreementDraftPage: what the banner says now that approval exists', () => {
  it('no longer says a draft cannot roster shifts: approval makes patterns and shifts, and is separate from signing', () => {
    show(revision())
    renderPage()

    const banner = screen.getByRole('note')
    expect(banner).toHaveTextContent("Draft only: not approved for signing or use. It can't activate the participant, invoice or claim.")
    expect(banner).toHaveTextContent("Approving a revision for rostering is separate: it only makes that revision's weekly patterns and unfilled shifts.")
    expect(banner).not.toHaveTextContent(/can't be used to activate the participant, roster shifts/)
  })
})
