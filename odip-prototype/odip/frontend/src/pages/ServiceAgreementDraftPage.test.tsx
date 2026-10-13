import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { AgreementCheck, ServiceAgreementDraftDto } from '@/api/types'
import { budgetOf, draftBlock, mondayWednesday, settings as makeSettings } from '@/test/fixtures/planPricing'
import ServiceAgreementDraftPage from './ServiceAgreementDraftPage'

const { createMutate, downloadMutate, drafts, participant, plans, budget, check, refetchDrafts, previewFor } = vi.hoisted(() => ({
  createMutate: vi.fn(), downloadMutate: vi.fn(), drafts: vi.fn(), participant: vi.fn(), plans: vi.fn(), budget: vi.fn(), check: vi.fn(), refetchDrafts: vi.fn(), previewFor: vi.fn(),
}))
vi.mock('@/api/hooks', () => ({
  useParticipant: () => participant(),
  useServiceAgreementDrafts: () => drafts(),
  useCreateServiceAgreementDraft: () => ({ mutate: createMutate, isPending: false }),
  useDownloadServiceAgreementDraftPdf: () => ({ mutate: downloadMutate, isPending: false, isError: false }),
  useFundingPlans: () => plans(),
  useApprovalPreview: (_participantId: string, draftId: string) => previewFor(draftId) ?? { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() },
  useApproveServiceAgreementDraft: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanPricingSettings: () => ({ data: makeSettings() }),
  usePlanBudget: () => budget(),
  useAgreementCheck: () => check(),
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
  participant.mockReturnValue({ data: { id: 'p-1', fullName: 'Marcus Tran', addressState: 'VIC' }, isLoading: false, isError: false, refetch: vi.fn() })
  plans.mockReturnValue({ data: { plans: [{ id: 'f-1', participantId: 'p-1', planStart: '2026-07-01', planEnd: '2027-06-30' }] }, isLoading: false, isError: false })
  budget.mockReturnValue({ data: budgetOf('b1'), isError: false, isFetching: false, error: null, refetch: vi.fn() })
  check.mockReturnValue({ data: agreementCheck(0), isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn() })
  refetchDrafts.mockResolvedValue({ data: [], isError: false })
  createMutate.mockReset(); downloadMutate.mockReset(); previewFor.mockReset()
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
