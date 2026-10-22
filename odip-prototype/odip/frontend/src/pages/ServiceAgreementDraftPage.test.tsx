import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { AgreementCheck, ServiceAgreementDraftDto } from '@/api/types'
import { noBudgetCheck } from '@/test/fixtures/budgets'
import { budgetOf, draftBlock, mondayWednesday, settings as makeSettings } from '@/test/fixtures/planPricing'
import ServiceAgreementDraftPage from './ServiceAgreementDraftPage'

const { createMutate, downloadMutate, drafts, participant, plans, budget, check, refetchDrafts, previewFor, editor, renewMutate, oldDraft, pricingSettings, endingRows } = vi.hoisted(() => ({
  editor: vi.fn(), createMutate: vi.fn(), downloadMutate: vi.fn(), drafts: vi.fn(), participant: vi.fn(), plans: vi.fn(), budget: vi.fn(), check: vi.fn(), refetchDrafts: vi.fn(), previewFor: vi.fn(),
  renewMutate: vi.fn(), oldDraft: vi.fn(), pricingSettings: vi.fn(), endingRows: vi.fn(),
}))
vi.mock('@/api/hooks', () => ({
  useParticipant: () => participant(),
  useServiceAgreementDrafts: () => drafts(),
  useCreateServiceAgreementDraft: () => ({ mutate: createMutate, isPending: false }),
  useDownloadServiceAgreementDraftPdf: () => ({ mutate: downloadMutate, isPending: false, isError: false }),
  useFundingPlans: () => plans(),
  useApprovalPreview: (_participantId: string, draftId: string) => previewFor(draftId) ?? { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() },
  useApproveServiceAgreementDraft: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanPricingSettings: () => ({ data: pricingSettings() }),
  useRenewAgreement: () => ({ mutate: renewMutate, isPending: false }),
  useServiceAgreementDraft: () => oldDraft(),
  useAgreementsEnding: (enabled?: boolean) => endingRows(enabled),
  usePlanBudget: () => budget(),
  useAgreementCheck: () => check(),
}))

// The editor has its own tests: here it is a marker that says how the agreement opened it.
vi.mock('@/pages/funding/FundingPlanEditor', () => ({
  FundingPlanEditor: (props: { open: boolean; plan?: { id: string }; previousPlan?: { id: string }; defaultManagement: string; onClose: () => void; onSaved?: () => void }) => {
    editor(props)
    // A save, as the real editor does it: onSaved, then onClose. The marker returns no focus to its opener as the real SlideOver does (useDialogBehavior's cleanup); the page's
    // effect still wins there because React runs a removed child's effect cleanups before its parent's effects in the same commit. The real editor needs the funding hooks, which
    // this file mocks whole, so it is not mounted here.
    return props.open ? <div data-testid="editor" data-plan={props.plan?.id ?? 'new'} data-previous={props.previousPlan?.id ?? 'none'} data-management={props.defaultManagement}><button type="button" onClick={() => { props.onSaved?.(); props.onClose() }}>Save the plan</button></div> : null
  },
}))

const asRole = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role, id: 'u-1' }))

const draft = (changes: Partial<ServiceAgreementDraftDto> = {}): ServiceAgreementDraftDto => ({
  id: 'd-2', participantId: 'p-1', version: 2, state: 'NSW', planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-10-01', agreementEndDate: '2027-06-30',
  blocks: [draftBlock(mondayWednesday('b1', { onPublicHoliday: 'Charge' }))], lines: [], isSummary: false, blockCount: 1, lineCount: 0, total: 0, caveats: [], ...changes,
}) as ServiceAgreementDraftDto

const approval = { approvedAt: '2026-10-03T01:00:00Z', approvedByName: 'Alex', patternsCreated: 2, patternsEnded: 0, shiftsCreated: 8 }

const agreementCheck = (overBy: number): AgreementCheck => ({
  hasBudget: true, asOf: '2026-10-12', periodFrom: '2026-10-01', periodTo: '2027-06-30', agreementCost: 30610.28, notInARecordedPool: 0, outsideThePlan: 0,
  pools: [{
    poolName: 'Core', agreementCost: 30610.28, overBy, alreadyOverBy: 0,
    periods: [{ periodStart: '2026-10-01', periodEnd: '2026-12-31', agreementCost: 30610.28, remaining: 29000, overBy }],
  }],
} as unknown as AgreementCheck)

function renderPage(path = '/participants/p-1/agreement-draft') {
  const router = createMemoryRouter([{ path: '/participants/:id/agreement-draft', element: <ServiceAgreementDraftPage /> }, { path: '*', element: <p>elsewhere</p> }], { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T10:00:00') })
  asRole('Admin')
  drafts.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: refetchDrafts })
  participant.mockReturnValue({ data: { id: 'p-1', fullName: 'Marcus Tran', addressState: 'VIC', planType: 'PlanManaged' }, isLoading: false, isError: false, refetch: vi.fn() })
  plans.mockReturnValue({ data: { plans: [{ id: 'f-1', participantId: 'p-1', planStart: '2026-07-01', planEnd: '2027-06-30' }] }, isLoading: false, isError: false })
  budget.mockReturnValue({ data: budgetOf('b1'), isError: false, isFetching: false, error: null, refetch: vi.fn() })
  check.mockReturnValue({ data: agreementCheck(0), isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn() })
  refetchDrafts.mockResolvedValue({ data: [], isError: false })
  createMutate.mockReset(); downloadMutate.mockReset(); previewFor.mockReset(); editor.mockReset()
  pricingSettings.mockReturnValue(makeSettings())
  oldDraft.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
  renewMutate.mockReset()
  endingRows.mockReset(); endingRows.mockReturnValue({ data: [], isLoading: false, isError: false })
})
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

/** A step of the rail: its accessible name is its number and its label. */
const stepButton = (label: string) => screen.getByRole('button', { name: new RegExp(`${label}$`) })
const next = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Next' }))

async function addCommunityWeekdays(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Start from a common week' }))
  await user.click(screen.getByRole('option', { name: /Community access weekdays/ }))
}

/** Agreement, then Week with a common week, then Check, then Save. */
async function toTheSaveStep(user: ReturnType<typeof userEvent.setup>) {
  await next(user)
  await addCommunityWeekdays(user)
  await next(user)
  await next(user)
}

describe('ServiceAgreementDraftPage: the wizard', () => {
  it('starts on the Agreement step with the dates of the participant\'s funding plan and no separate plan-date boxes', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 2, name: 'Agreement' })).toBeInTheDocument()
    expect(screen.getByLabelText('Agreement starts')).toHaveValue('2026-07-01')
    expect(screen.getByLabelText('Agreement ends')).toHaveValue('2027-06-30')
    expect(screen.getByLabelText('State')).toHaveValue('VIC')
    expect(screen.getByText('Different NDIS plan dates?')).toBeInTheDocument()
    for (const step of ['Agreement', 'Week', 'Check', 'Save']) expect(stepButton(step)).toBeInTheDocument()
  })

  it('says what is wrong with the dates and stays on the step', async () => {
    const user = userEvent.setup()
    renderPage()
    fireEvent.change(screen.getByLabelText('Agreement starts'), { target: { value: '' } })
    await next(user)
    expect(screen.getByText('Enter the day the agreement starts.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Agreement' })).toBeInTheDocument()
  })

  it('will not leave an empty week', async () => {
    const user = userEvent.setup()
    renderPage()
    await next(user)
    await next(user)
    expect(screen.getByText('Add at least one shift to go on.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Week' })).toBeInTheDocument()
  })

  it('sends the plan dates, the state and the blocks the shifts make, and nothing priced', async () => {
    const user = userEvent.setup()
    renderPage()
    fireEvent.change(screen.getByLabelText('Agreement starts'), { target: { value: '2026-10-01' } })
    await user.type(screen.getByLabelText('Representative (optional)'), 'A. Representative')
    await toTheSaveStep(user)
    await user.click(screen.getByRole('button', { name: 'Save agreement' }))

    expect(createMutate).toHaveBeenCalledTimes(1)
    const [request] = createMutate.mock.calls[0]
    expect(request).toEqual({
      participantId: 'p-1',
      data: {
        planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-10-01', agreementEndDate: '2027-06-30', state: 'VIC', serviceTypes: ['Community access'],
        representative: 'A. Representative', baseVersion: 0,
        blocks: [{
          block: {
            id: 'b1', supportType: 'CommunityAccess', intensity: 'Standard', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], start: '09:00:00', end: '13:00:00', workers: 1,
            participantsPresent: 1, headcountChanges: [], setting: 'Community', location: { state: 'VIC', zone: 'National' }, workerMaySleep: false, sleepoverActiveHours: 0, onPublicHoliday: 'Charge',
          },
          requirements: { workerGender: 'NoPreference', driver: false, skills: [] },
        }],
      },
    })
    expect(JSON.stringify(request)).not.toMatch(/itemCode|unitPrice|"lines"|price/i)
  })

  it('files the plan under the dates the coordinator gave when they differ from the funding plan', async () => {
    const user = userEvent.setup()
    renderPage()
    fireEvent.change(screen.getByLabelText('NDIS plan starts'), { target: { value: '2026-01-01' } })
    await toTheSaveStep(user)
    await user.click(screen.getByRole('button', { name: 'Save agreement' }))
    expect(createMutate.mock.calls[0][0].data).toMatchObject({ planStartDate: '2026-01-01', planEndDate: '2027-06-30' })
  })

  it('takes the agreement\'s own dates as the plan when no funding plan is recorded, and says so', async () => {
    plans.mockReturnValue({ data: { plans: [] }, isLoading: false, isError: false })
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByText(/No funding plan is recorded for this participant/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Agreement starts'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Agreement ends'), { target: { value: '2027-03-31' } })
    await toTheSaveStep(user)
    await user.click(screen.getByRole('button', { name: 'Save agreement' }))
    expect(createMutate.mock.calls[0][0].data).toMatchObject({ planStartDate: '2026-10-01', planEndDate: '2027-03-31' })
  })
})

describe('ServiceAgreementDraftPage: the words and the saved agreement', () => {
  it('loads the newest save as shifts and says block, version, template or hash nowhere', async () => {
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByLabelText('Agreement starts')).toHaveValue('2026-10-01')
    await user.click(stepButton('Week'))
    expect(screen.getByRole('button', { name: /Monday 09:00 to 13:00 · Community access · 1:1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Wednesday 09:00 to 13:00/ })).toBeInTheDocument()
    for (const key of ['Agreement', 'Week', 'Check', 'Save']) {
      await user.click(stepButton(key))
      expect(document.body.textContent).not.toMatch(/\bblocks?\b|version|template|sha-?256|provisional blank draft|legal review required|draft versions/i)
    }
  })

  it('shows the budget comparison first on the Check step and the running total in the footer, within budget', async () => {
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Check'))
    expect(screen.getByRole('heading', { name: /Against the participant's budget/ })).toBeInTheDocument()
    expect(screen.getAllByRole('status').some(status => /\$588\.64 a week · \$30,610\.28 for the agreement · within budget/.test(status.textContent ?? ''))).toBe(true)
  })

  it('says over by in the running total when a pool is over', () => {
    check.mockReturnValue({ data: agreementCheck(1355), isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn() })
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    renderPage()
    expect(screen.getAllByRole('status').some(status => /over by \$1,355\.00/.test(status.textContent ?? ''))).toBe(true)
  })

  it('offers the PDF of the saved agreement and the history of its approvals', async () => {
    drafts.mockReturnValue({ data: [draft(), draft({ id: 'd-1', version: 1, approval })], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Save'))
    await user.click(screen.getByRole('button', { name: 'Download agreement PDF' }))
    expect(downloadMutate).toHaveBeenCalledWith({ participantId: 'p-1', id: 'd-2' })
    expect(screen.getByText('Approved 3 Oct 2026 by Alex.')).toBeInTheDocument()
  })

  it('calls an agreement saved with undecided holidays unsaved, so Save comes before Approve', async () => {
    drafts.mockReturnValue({ data: [draft({ blocks: [draftBlock(mondayWednesday('b1', { onPublicHoliday: 'Review' }))] })], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Save'))
    expect(screen.getByText(/You have changes that are not saved/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark approved for rostering' })).toBeDisabled()
  })

  it('opens the approval from the Save step, once everything is saved', async () => {
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Save'))
    await user.click(screen.getByRole('button', { name: 'Mark approved for rostering' }))
    expect(screen.getByRole('dialog', { name: 'Approve this agreement for rostering?' })).toBeInTheDocument()
  })

  it('locks an approved agreement until a new revision is started', async () => {
    drafts.mockReturnValue({ data: [draft({ approval })], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByText('Approved for rostering')).toBeInTheDocument()
    expect(screen.queryByLabelText('Agreement starts')).not.toBeInTheDocument()
    await user.click(stepButton('Week'))
    expect(screen.queryByRole('button', { name: /Add a shift/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start a new revision' }))
    expect(screen.getAllByRole('button', { name: /Add a shift on/ })).toHaveLength(7)
  })

  it('names a save by somebody else, keeps what is on screen, and offers theirs', async () => {
    createMutate.mockImplementation((_request, options) => options.onError({ response: { status: 409, data: { code: 'draft-version-conflict', data: { currentVersion: 3 } } } }))
    const user = userEvent.setup()
    renderPage()
    await toTheSaveStep(user)
    await user.click(screen.getByRole('button', { name: 'Save agreement' }))
    expect(await screen.findByText('Somebody else saved this agreement')).toBeInTheDocument()
    expect(refetchDrafts).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Load their agreement' })).toBeInTheDocument()
  })

  it('asks for no "Confirm service needs", even from onboarding: the checklist reads the saved agreement itself', async () => {
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage('/participants/p-1/agreement-draft?from=onboarding')
    await user.click(stepButton('Save'))
    expect(screen.getByRole('button', { name: 'Download agreement PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm service needs' })).not.toBeInTheDocument()
  })

  it('shows what is saved to somebody who cannot change it, with Close in place of Save', async () => {
    asRole('ReadOnly')
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Save'))
    expect(within(screen.getByRole('form', { name: 'Service agreement' })).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save agreement' })).not.toBeInTheDocument()
  })

  it('NAV F6: Close goes where Back and Cancel go: back to the onboarding checklist when opened from it', async () => {
    asRole('ReadOnly')
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    const router = createMemoryRouter([
      { path: '/participants/:id/agreement-draft', element: <ServiceAgreementDraftPage /> },
      { path: '*', element: <p>elsewhere</p> },
    ], { initialEntries: ['/participants/p-1/agreement-draft?from=onboarding'] })
    render(<RouterProvider router={router} />)
    await user.click(stepButton('Save'))
    await user.click(within(screen.getByRole('form', { name: 'Service agreement' })).getByRole('button', { name: 'Close' }))
    expect(router.state.location.pathname).toBe('/onboarding/p-1')
  })

  it('keeps the draft-only notice and the participant identifiers on the Agreement step, and the PDF caveat on the Save step, in the words they always had', async () => {
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByText(/Draft only:/).closest('p')).toHaveTextContent("Draft only: not approved for signing or use. It can't activate the participant, invoice or claim. Approving a revision for rostering is separate: it only makes that revision's weekly patterns and unfilled shifts.")
    const identifiers = screen.getByText(/Participant identifiers come from the participant record/).closest('p') as HTMLElement
    expect(identifiers).toHaveTextContent('NDIS number: Not recorded on participant; date of birth: Not recorded on participant.')
    expect(identifiers).toHaveTextContent('A snapshot of both is stored with this draft and printed on its PDF, which Admins and Coordinators can open; a later change to the record does not change an existing draft.')
    expect(within(identifiers).getByRole('link', { name: 'View or edit participant details' })).toHaveAttribute('href', '/participants/p-1/profile')
    await user.click(stepButton('Save'))
    expect(screen.getByText('Draft PDFs are informational only — not signed and not billing authority.')).toBeInTheDocument()
  })

  it('acts on the version on screen, not on a newer one read since: the PDF and the approval', async () => {
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage('/participants/p-1/agreement-draft?from=onboarding')
    await user.click(stepButton('Save'))
    drafts.mockReturnValue({ data: [draft({ id: 'd-3', version: 3 }), draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    await user.click(stepButton('Agreement'))
    await user.click(stepButton('Save'))
    await user.click(screen.getByRole('button', { name: 'Download agreement PDF' }))
    expect(downloadMutate).toHaveBeenCalledWith({ participantId: 'p-1', id: 'd-2' })
    await user.click(screen.getByRole('button', { name: 'Mark approved for rostering' }))
    expect(previewFor).toHaveBeenLastCalledWith('d-2')
  })

  it('calls a week with every shift taken out unsaved, so Approve waits for a save', async () => {
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Week'))
    for (const day of ['Monday', 'Wednesday']) {
      screen.getByRole('button', { name: new RegExp('^' + day + ' ') }).focus()
      await user.keyboard('{Delete}')
    }
    await user.click(stepButton('Save'))
    expect(screen.getByText(/You have changes that are not saved/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark approved for rostering' })).toBeDisabled()
  })

  it('shows the shifts of the block a reason names, by the id the server stored (b1, b3)', async () => {
    const saturday = mondayWednesday('b3', { onPublicHoliday: 'Charge', days: ['Saturday'], start: '09:00:00', end: '15:00:00' })
    drafts.mockReturnValue({ data: [draft({ blocks: [draftBlock(mondayWednesday('b1', { onPublicHoliday: 'Charge' })), draftBlock(saturday)] })], isLoading: false, isError: false, refetch: refetchDrafts })
    previewFor.mockReturnValue({
      data: { canApprove: false, alreadyApproved: false, reasons: [{ code: 'NoItem', message: "Block 'b3': no item for the night.", blockId: 'b3', count: 1 }], patternsToCreate: 0, patternsToEnd: 0, shiftsToCreate: 0, horizonEnd: '2026-12-05', oldShiftsRemaining: { open: 0, assigned: 0 }, overlappingPatterns: [] },
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Save'))
    await user.click(screen.getByRole('button', { name: 'Mark approved for rostering' }))
    await user.click(screen.getByRole('button', { name: 'Show the shifts' }))
    expect(screen.getByRole('button', { name: /^Saturday 09:00 to 15:00/ })).toHaveAttribute('aria-pressed', 'true')
    for (const day of ['Monday', 'Wednesday']) expect(screen.getByRole('button', { name: new RegExp('^' + day + ' ') })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the budget comparison on an approved agreement, which the person may still price', async () => {
    drafts.mockReturnValue({ data: [draft({ approval })], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Check'))
    expect(screen.getByRole('heading', { name: /Against the participant's budget/ })).toBeInTheDocument()
  })

  it('does not say a saved agreement is shorter than a week when its week is only not priced, for a person who cannot change it', async () => {
    asRole('ReadOnly')
    drafts.mockReturnValue({ data: [draft({ pricing: budgetOf('b1').period })], isLoading: false, isError: false, refetch: refetchDrafts })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Check'))
    expect(screen.getByText('The whole agreement')).toBeInTheDocument()
    expect(screen.queryByText('The agreement is shorter than a week.')).not.toBeInTheDocument()
  })
})

// The budget is recorded over the agreement, in the Funding tab's own editor: the person never leaves, and what they typed stays.
describe('ServiceAgreementDraftPage: recording the plan budget in place', () => {
  const ended = { id: 'f-0', participantId: 'p-1', planStart: '2025-07-01', planEnd: '2026-06-30' }

  it('opens the editor from the Agreement step, outside the agreement form, with the participant\'s plan type', async () => {
    plans.mockReturnValue({ data: { plans: [] }, isLoading: false, isError: false })
    const user = userEvent.setup()
    renderPage()
    fireEvent.change(screen.getByLabelText('Agreement starts'), { target: { value: '2026-10-01' } })
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Record plan budget' }))

    const opened = screen.getByTestId('editor')
    expect(opened).toHaveAttribute('data-plan', 'new')
    expect(opened).toHaveAttribute('data-previous', 'none')
    expect(opened).toHaveAttribute('data-management', 'PlanManaged')
    // Enter in the editor must never submit the agreement.
    expect(screen.getByRole('form', { name: 'Service agreement' })).not.toContainElement(opened)
    expect(screen.getByLabelText('Agreement starts')).toHaveValue('2026-10-01')
    // The sentence ends in words, then the action after it.
    const line = screen.getByText(/No funding plan is recorded/)
    expect(line.textContent?.replace(/\s/g, ' ')).toBe("No funding plan is recorded for this participant, so the NDIS plan is taken to run for the agreement's dates, and there is no budget to compare the agreement with. Record plan budget")
    expect(within(line).getByRole('button', { name: 'Record plan budget' })).toBeInTheDocument()
  })

  it('opens the editor from the Check step for a new plan after the one that ended', async () => {
    plans.mockReturnValue({ data: { plans: [ended] }, isLoading: false, isError: false })
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    check.mockReturnValue({ data: noBudgetCheck({ noBudgetReason: 'PlanEnded', planEnd: '2026-06-30' }), isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Check'))

    await user.click(screen.getByRole('button', { name: 'Record a new plan' }))

    expect(screen.getByTestId('editor')).toHaveAttribute('data-previous', 'f-0')
    expect(screen.getByTestId('editor')).toHaveAttribute('data-plan', 'new')
    expect(screen.getByRole('heading', { level: 2, name: 'Check' })).toBeInTheDocument()
  })

  // The Record button goes once the check refreshes with the new plan, so focus is not left to fall to the page: it goes to what the save changed.
  it('puts focus on the budget comparison after a save from the Check step', async () => {
    plans.mockReturnValue({ data: { plans: [] }, isLoading: false, isError: false })
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    check.mockReturnValue({ data: noBudgetCheck(), isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Check'))
    await user.click(screen.getByRole('button', { name: 'Record plan budget' }))

    await user.click(screen.getByRole('button', { name: 'Save the plan' }))

    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(document.body)
    expect(screen.getByRole('heading', { name: /Against the participant's budget/ })).toHaveFocus()
  })

  it('puts focus on the plan line after a save from the Agreement step', async () => {
    plans.mockReturnValue({ data: { plans: [] }, isLoading: false, isError: false })
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Record plan budget' }))
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))

    expect(screen.getByText(/No funding plan is recorded for this participant/)).toHaveFocus()
  })

  it('says when the recorded plan ended on the Agreement step, beside Record a new plan', () => {
    plans.mockReturnValue({ data: { plans: [ended] }, isLoading: false, isError: false })
    renderPage()

    const line = screen.getByText(/The recorded NDIS plan ended on/)
    expect(line.textContent?.replace(/\s/g, ' ')).toBe("The recorded NDIS plan ended on 30 Jun 2026. Until a new one is recorded, the NDIS plan is taken to run for the agreement's dates, and there is no budget to compare the agreement with. Record a new plan")
    expect(within(line).getByRole('button', { name: 'Record a new plan' })).toBeInTheDocument()
    expect(screen.queryByText(/No funding plan is recorded/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record a new plan' })).toBeInTheDocument()
  })

  it('offers it on an approved agreement too, which the person may still price', async () => {
    plans.mockReturnValue({ data: { plans: [] }, isLoading: false, isError: false })
    drafts.mockReturnValue({ data: [draft({ approval })], isLoading: false, isError: false, refetch: refetchDrafts })
    check.mockReturnValue({ data: noBudgetCheck(), isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderPage()
    await user.click(stepButton('Check'))

    await user.click(screen.getByRole('button', { name: 'Record plan budget' }))

    expect(screen.getByTestId('editor')).toBeInTheDocument()
  })

  it('offers nothing to record to a person who only reads the agreement', async () => {
    asRole('ReadOnly')
    plans.mockReturnValue({ data: { plans: [] }, isLoading: false, isError: false })
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: refetchDrafts })
    check.mockReturnValue({ data: noBudgetCheck(), isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderPage()
    for (const key of ['Agreement', 'Check']) {
      await user.click(stepButton(key))
      expect(screen.queryByRole('button', { name: /Record (plan budget|a new plan)/ })).not.toBeInTheDocument()
    }
    expect(editor).not.toHaveBeenCalled()
    // What a viewer had before is what they keep: the Agreement step is the read-only facts, with no plan line and so no Record link (AgreementStep returns early when read only).
    await user.click(stepButton('Agreement'))
    expect(screen.getByText('NDIS plan')).toBeInTheDocument()
    expect(screen.queryByText(/No funding plan is recorded/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Record the plan' })).not.toBeInTheDocument()
  })
})

describe('ServiceAgreementDraftPage: renewing an agreement (agreement PR 2)', () => {
  // v2, approved, ends on Sunday 1 November 2026: 20 days after the fixed today, Monday 12 October.
  const ending = draft({ approval, agreementStartDate: '2026-07-01', agreementEndDate: '2026-11-01' })
  const line = {
    serviceType: 'Community access', hours: 120, itemCode: '04_104_0125_6_1', unitPrice: 73.58, catalogueVersion: '2026-27', catalogueEffectiveFrom: '2026-07-01', catalogueEffectiveTo: null,
    blockId: 'b1', band: 'Daytime', unit: 'H', total: 8829.6, occurrences: 30, flags: 'None',
  }
  const renewal = draft({ id: 'd-3', version: 3, agreementStartDate: '2026-11-02', agreementEndDate: '2027-02-28', lines: [line] })
  const showing = (...list: ServiceAgreementDraftDto[]) => drafts.mockReturnValue({ data: list, isLoading: false, isError: false, refetch: refetchDrafts })
  const renewButton = () => screen.getByRole('button', { name: 'Renew agreement' })
  // The provider's count of days, as the server's ending list has it (fix round 1, CR-B S1): the page never counts from the browser's date.
  const endsIn = (daysLeft: number, agreementEndDate = '2026-11-01', draftId = 'd-2') => endingRows.mockReturnValue({
    data: [{ participantId: 'p-1', participantName: 'Marcus Tran', draftId, version: 2, agreementEndDate, daysLeft, renewalVersion: null, status: '' }], isLoading: false, isError: false,
  })
  beforeEach(() => endsIn(20))

  it('counts the days from the provider\u0027s today, not the browser\u0027s', () => {
    endsIn(19)                                                                            // the browser's date would say 20
    showing(ending)
    renderPage()

    expect(screen.getByText('Agreement ends in 19 days.')).toBeInTheDocument()
  })

  it('says when an approved agreement ends, and offers Renew to an approver beside Start a new revision', () => {
    showing(ending)
    renderPage()

    expect(screen.getByText('Agreement ends in 20 days.')).toBeInTheDocument()
    expect(renewButton()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start a new revision' })).toBeInTheDocument()
    // Fix round 1 (deep S3), a known limit said where it bites: once renewed, this term can only be changed by a revision that replaces the renewal.
    expect(screen.getByText('Make any change this agreement needs before you renew it: once it is renewed, a change to it replaces the renewal.')).toBeInTheDocument()
  })

  // Fix round 2 (finish, Tone Rule): one fact, one tone. The callout's container carries the house Callout tone, so the test reads it from there.
  const lockedTone = () => {
    const box = screen.getByText('Approved for rostering').parentElement!.parentElement!.className
    return box.includes('--color-destructive') ? 'error' : box.includes('--color-warning-container') ? 'warning' : 'info'
  }

  it('says when it could not check whether the agreement is ending, and tries again, rather than dropping Renew silently', async () => {
    const refetch = vi.fn()
    endingRows.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    showing(ending)
    renderPage()

    expect(screen.getByText("Couldn't check whether this agreement is ending.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Renew agreement' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  // Follow-ups (N14): the ending list needs an organisation, so for a SuperAdmin with none it answers 400 every time. The page asks for none and says what to do instead of a Try again that never helps.
  it('asks a SuperAdmin with no organisation to choose one, instead of a check that always fails', () => {
    asRole('SuperAdmin')
    endingRows.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() })
    showing(ending)
    renderPage()

    expect(endingRows).toHaveBeenCalledWith(false)
    expect(endingRows).not.toHaveBeenCalledWith(true)
    expect(screen.getByText('Choose an organisation to see whether this agreement is ending.')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't check whether this agreement is ending.")).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('checks as usual for a SuperAdmin viewing an organisation', () => {
    asRole('SuperAdmin')
    localStorage.setItem('odip_viewing_tenant', 't-1')
    showing(ending)
    renderPage()

    expect(endingRows).toHaveBeenCalledWith(true)
    expect(screen.getByText('Agreement ends in 20 days.')).toBeInTheDocument()
    expect(screen.queryByText('Choose an organisation to see whether this agreement is ending.')).not.toBeInTheDocument()
  })

  it('is in the error tone once the agreement has ended, warning while it is ending, and info otherwise', () => {
    endsIn(-1, '2026-10-11')
    showing(draft({ approval, agreementStartDate: '2026-07-01', agreementEndDate: '2026-10-11' }))
    const { unmount } = renderPage()
    expect(lockedTone()).toBe('error')
    unmount()

    endsIn(20)
    showing(ending)
    const second = renderPage()
    expect(lockedTone()).toBe('warning')
    second.unmount()

    endingRows.mockReturnValue({ data: [], isLoading: false, isError: false })
    showing(draft({ approval }))
    renderPage()
    expect(lockedTone()).toBe('info')
  })

  it('says nothing of an end more than 60 days away, and an ended agreement says its shifts stop', () => {
    endingRows.mockReturnValue({ data: [], isLoading: false, isError: false })            // ends 30 June 2027: not on the list
    showing(draft({ approval }))
    const { unmount } = renderPage()
    expect(screen.queryByText(/^Agreement end/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Renew agreement' })).not.toBeInTheDocument()
    unmount()

    endsIn(-1, '2026-10-11')
    showing(draft({ approval, agreementStartDate: '2026-07-01', agreementEndDate: '2026-10-11' }))
    renderPage()
    expect(screen.getByText('Agreement ended Sun 11 Oct 2026: shifts stop after it.')).toBeInTheDocument()
    expect(renewButton()).toBeInTheDocument()
    // Fix round 2: there is nothing left of an ended agreement to change before renewing it.
    expect(screen.queryByText(/^Make any change this agreement needs/)).not.toBeInTheDocument()
  })

  it('tells a coordinator the organisation does not let approve when it ends, without offering Renew', () => {
    asRole('Coordinator')
    pricingSettings.mockReturnValue(makeSettings({ approverRoles: ['Admin'] }))
    showing(ending)
    renderPage()

    expect(screen.getByText('Agreement ends in 20 days.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Renew agreement' })).not.toBeInTheDocument()
  })


  it('renews, then opens the renewal on the Check step beside the agreement it renews', async () => {
    showing(ending)
    oldDraft.mockReturnValue({ data: { ...ending, lines: [{ ...line, unitPrice: 70.23 }] }, isLoading: false, isError: false, refetch: vi.fn() })
    refetchDrafts.mockResolvedValue({ data: [renewal, { ...ending, isSummary: true }], isError: false })
    renewMutate.mockImplementation((_request, options) => { showing(renewal, { ...ending, isSummary: true }); options.onSuccess(renewal) })
    const user = userEvent.setup()
    renderPage()

    await user.click(renewButton())

    expect(renewMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-2' }, expect.anything())
    expect(await screen.findByRole('heading', { level: 2, name: 'Check' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Renewal of v2' })).toBeInTheDocument()
    expect(screen.queryByText('Approved for rostering')).not.toBeInTheDocument()   // the renewal is a draft, open to change
  })

  it('renewing after a pattern change says the revision renewed covers only its last weeks and leaves its totals out', async () => {
    // v2 ran 1 Jul to 1 Nov; a pattern change saved v3 from 1 Oct to the same end; the renewal v4 follows v3.
    const tail = { ...ending, id: 'd-3', version: 3, agreementStartDate: '2026-10-01', isSummary: true }
    showing({ ...renewal, id: 'd-4', version: 4 }, tail, { ...ending, isSummary: true })
    oldDraft.mockReturnValue({ data: { ...tail, lines: [{ ...line, unitPrice: 70.23 }] }, isLoading: false, isError: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderPage()

    await user.click(stepButton('Check'))

    expect(await screen.findByText(/v3 only covers the end of the agreement \(Thu 1 Oct 2026 to Sun 1 Nov 2026; the agreement began on Wed 1 Jul 2026\), so its total is not compared with v4.s\. The unit prices are\./)).toBeInTheDocument()
    expect(screen.queryByText(/came to/)).not.toBeInTheDocument()
  })

  it('with no plan for the first day, says so, opens the editor after the plan that ends, and then leaves Renew to be pressed again', async () => {
    plans.mockReturnValue({ data: { plans: [{ id: 'f-1', participantId: 'p-1', planStart: '2025-11-02', planEnd: '2026-11-01' }] }, isLoading: false, isError: false })
    showing(ending)
    const words = "Record the new plan first: no plan of the participant's covers 2026-11-02, the day the renewal starts."
    renewMutate.mockImplementation((_request, options) => options.onError({ response: { status: 409, data: { success: false, code: 'plan-needed', errors: [words] } } }))
    const user = userEvent.setup()
    renderPage()

    await user.click(renewButton())
    expect(screen.getByText("Record the new plan first: no plan of the participant's covers Mon 2 Nov 2026, the day the renewal starts.")).toBeInTheDocument()
    expect(screen.getByText('Approved for rostering')).toBeInTheDocument()            // nothing else on the page changed
    await user.click(screen.getByRole('button', { name: 'Record a new plan' }))
    expect(screen.getByTestId('editor')).toHaveAttribute('data-previous', 'f-1')
    expect(screen.getByTestId('editor')).toHaveAttribute('data-plan', 'new')
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))

    expect(screen.queryByText(/^Record the new plan first/)).not.toBeInTheDocument()
    expect(screen.getByText('Agreement ends in 20 days.')).toHaveFocus()
    expect(renewButton()).toBeInTheDocument()
  })

  it('names a newer revision that waits, and Load v3 reads it in', async () => {
    showing(ending)
    const waiting = draft({ id: 'd-3', version: 3, agreementStartDate: '2026-10-20', agreementEndDate: '2026-11-01' })
    renewMutate.mockImplementation((_request, options) => options.onError({ response: { status: 409, data: { success: false, code: 'draft-version-conflict', data: { currentVersion: 3 }, errors: ['A newer one.'] } } }))
    refetchDrafts.mockImplementation(async () => { showing(waiting, ending); return { data: [waiting, ending], isError: false } })
    const user = userEvent.setup()
    renderPage()

    await user.click(renewButton())
    expect(screen.getByText('This agreement has a newer revision, v3. Load it first: a renewal would replace it.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load v3' }))

    expect(await screen.findByLabelText('Agreement starts')).toHaveValue('2026-10-20')   // v3 waits for approval, so it is open to change
  })

  it('a refusal says the server\'s words and keeps the page as it was', async () => {
    showing(ending)
    const words = 'Your role cannot renew agreements in your organisation. An Admin can change who may approve in Settings, Plan pricing.'
    renewMutate.mockImplementation((_request, options) => options.onError({ response: { status: 403, data: { success: false, errors: [words] } } }))
    const user = userEvent.setup()
    renderPage()

    await user.click(renewButton())

    expect(screen.getByText('The agreement was not renewed')).toBeInTheDocument()
    expect(screen.getByText(words)).toBeInTheDocument()
    expect(screen.getByText('Approved for rostering')).toBeInTheDocument()
  })
})
