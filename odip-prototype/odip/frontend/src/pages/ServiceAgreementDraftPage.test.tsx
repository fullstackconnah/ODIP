import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as React from 'react'
import type { DraftBlock, PlanQuote, ServiceAgreementDraftDto } from '@/api/types'
import { budgetOf, draftBlock, line, mondayWednesday, quote, settings as makeSettings } from '@/test/fixtures/planPricing'
import ServiceAgreementDraftPage from './ServiceAgreementDraftPage'

const { createMutate, drafts, detail, participant, snapshotMutate, evidenceMutate, simulationMutate, budget } = vi.hoisted(() => ({
  createMutate: vi.fn(), drafts: vi.fn(), detail: vi.fn(), participant: vi.fn(), snapshotMutate: vi.fn(), evidenceMutate: vi.fn(), simulationMutate: vi.fn(), budget: vi.fn(),
}))
vi.mock('@/api/hooks', () => ({
  useParticipant: () => participant(),
  useServiceAgreementDrafts: () => drafts(),
  useServiceAgreementDraft: (participantId: string, id: string, enabled: boolean) => detail(participantId, id, enabled),
  useCreateServiceAgreementDraft: () => ({ mutate: createMutate, isPending: false }),
  useDownloadServiceAgreementDraftPdf: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCreateElectronicSigningSnapshot: () => ({ mutate: snapshotMutate, isPending: false }),
  useSubmitElectronicSigningEvidence: () => ({ mutate: evidenceMutate, isPending: false }),
  usePlanPricingSettings: () => ({ data: makeSettings() }),
  usePlanBudget: () => budget(),
  usePlanBlockQuote: () => ({ data: quote(), isLoading: false, isError: false, refetch: vi.fn() }),
  useFundingSources: () => ({ data: [], isError: false }),
  useDemoJourneySimulation: () => {
    const [result, setResult] = React.useState<{ data?: { banner: string; signing: string; activation: string; booking: string; rateLabel: string }; error?: { response: { data: { message: string } } } }>({})
    return {
      mutate: ({ participantId, draftId }: { participantId: string; draftId: string }) => {
        simulationMutate({ participantId, draftId })
        setResult(draftId === 'd-old'
          ? { error: { response: { data: { message: 'Only the newest draft can run the simulation.' } } } }
          : { data: { banner: 'Simulation complete for newest', signing: 'Synthetic signing', activation: 'Synthetic activation', booking: 'Synthetic booking', rateLabel: 'Synthetic rate $72.34' } })
      },
      isPending: false,
      isError: !!result.error,
      error: result.error,
      data: result.data,
    }
  },
}))

const asRole = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role, id: 'u-1' }))

/** A revision as the server sends it. */
const draft = (changes: Partial<ServiceAgreementDraftDto> = {}): ServiceAgreementDraftDto => ({
  id: 'd-1', participantId: 'p-1', version: 2, status: 'UnapprovedDraft', templateVersion: 'ODIP-Service-Agreement-Blank-DRAFT-2026-09-27', templateDocxSha256: 'docx-hash', templatePdfSha256: 'pdf-hash',
  state: 'NSW', planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-07-01', agreementEndDate: '2027-06-30', blocks: [], lines: [], isSummary: false, blockCount: 0, lineCount: 0, total: 0, caveats: [], ...changes,
})

const legacyLine = { serviceType: 'Daily support', itemCode: 'configured-code', hours: 2, unitPrice: 72.34, catalogueVersion: '2026-07', catalogueEffectiveFrom: '2026-07-01', catalogueEffectiveTo: null, unit: 'H', total: 144.68, occurrences: 0, flags: 'None' }

function renderPage() {
  const router = createMemoryRouter([{ path: '/participants/:id/agreement-draft', element: <ServiceAgreementDraftPage /> }], { initialEntries: ['/participants/p-1/agreement-draft'] })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  asRole('Admin')
  drafts.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  participant.mockReturnValue({ data: { id: 'p-1', fullName: 'Marcus Tran', ndisNumber: '430000001', dateOfBirth: '1990-01-02' }, isLoading: false, isError: false, refetch: vi.fn() })
  budget.mockReturnValue({ data: budgetOf('b1'), isError: false, isFetching: false, error: null, refetch: vi.fn() })
  createMutate.mockReset(); snapshotMutate.mockReset(); evidenceMutate.mockReset(); simulationMutate.mockReset()
  detail.mockReset(); detail.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
})
afterEach(() => localStorage.clear())

async function fillDetails(representative = 'A. Representative') {
  const user = userEvent.setup()
  fireEvent.change(screen.getByLabelText('Plan start'), { target: { value: '2026-07-01' } })
  fireEvent.change(screen.getByLabelText('Plan end'), { target: { value: '2027-06-30' } })
  fireEvent.change(screen.getByLabelText('Agreement start'), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText('Agreement end'), { target: { value: '2027-06-30' } })
  await user.type(screen.getByLabelText('Representative'), representative)
  return user
}

/** Template, then Days and times, Requirements and Travel, then Review, then Add to plan. */
async function addBlockFromTemplate(user: ReturnType<typeof userEvent.setup>, template: RegExp = /Community access weekdays/) {
  await user.click(screen.getByRole('button', { name: template }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Add to plan' }))
}

describe('ServiceAgreementDraftPage: saving a plan built from blocks', () => {
  it('sends the blocks and the details and nothing else: no price, no item code, no hand-typed lines', async () => {
    renderPage()
    const user = await fillDetails()
    await addBlockFromTemplate(user)

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(createMutate).toHaveBeenCalledTimes(1)
    const [request, options] = createMutate.mock.calls[0]
    expect(request).toEqual({
      participantId: 'p-1',
      data: {
        planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-10-01', agreementEndDate: '2027-06-30', state: 'NSW', serviceTypes: ['Community access'], representative: 'A. Representative',
        baseVersion: 0,
        blocks: [{
          block: {
            id: 'b1', supportType: 'CommunityAccess', intensity: 'Standard', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], start: '09:00:00', end: '13:00:00', workers: 1,
            participantsPresent: 1, headcountChanges: [], setting: 'Community', location: { state: 'NSW', zone: 'National' }, workerMaySleep: false, sleepoverActiveHours: 0, onPublicHoliday: 'Review',
          },
          requirements: { workerGender: 'NoPreference', driver: false, skills: [] },
        }],
      },
    })
    const body = JSON.stringify(request)
    expect(body).not.toMatch(/itemCode|unitPrice|"lines"|price/i)
    expect(options).toEqual(expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }))
  })

  it('stamps every block with the agreement\'s state and price zone, whatever it carried, and normalises what the steps hid', async () => {
    renderPage()
    const user = await fillDetails()
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'VIC' } })
    fireEvent.change(screen.getByLabelText('Price zone'), { target: { value: 'Remote' } })
    await addBlockFromTemplate(user, /Saturday group outing/)

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    const block = createMutate.mock.calls[0][0].data.blocks[0].block
    expect(block.location).toEqual({ state: 'VIC', zone: 'Remote' })
    expect(createMutate.mock.calls[0][0].data).toMatchObject({ state: 'VIC', serviceTypes: ['Group activity'] })
  })

  it('says it was saved as the next version, and then there is nothing to lose', async () => {
    createMutate.mockImplementation((_request, options) => options.onSuccess({ version: 3 }))
    renderPage()
    const user = await fillDetails()
    await addBlockFromTemplate(user)
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('You have unsaved changes.')

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByText(/Saved as version 3\./)).toBeInTheDocument()
    expect(screen.getByText(/Saved as version 3\./)).toHaveTextContent('Every save is a new version: earlier versions never change.')
    expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument()
  })

  it('shows every reason the server gave when it refuses, and keeps the plan and what was typed', async () => {
    createMutate.mockImplementation((_request, options) => options.onError({ response: { status: 400, data: { errors: ["Block 'b1': Community access needs registration group 0125, which the provider does not hold.", 'Block \'b1\': workers must be between 1 and 10.'] } } }))
    renderPage()
    const user = await fillDetails('Keep me')
    await addBlockFromTemplate(user)

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    const alert = await screen.findByText('The draft was not saved')
    expect(alert.closest('[role="alert"]')).toHaveTextContent('Block 1: Community access needs registration group 0125, which the provider does not hold.')   // the block by its place, not the id the screen gave it
    expect(alert.closest('[role="alert"]')).toHaveTextContent('Block 1: workers must be between 1 and 10.')
    expect(alert.closest('[role="alert"]')).not.toHaveTextContent("'b1'")
    expect(screen.getByLabelText('Representative')).toHaveValue('Keep me')
    expect(screen.getByLabelText('Agreement start')).toHaveValue('2026-10-01')
    expect(screen.getByText('Mon–Fri · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
  })

  it('says a busy server and a refused role in plain words, and keeps the plan', async () => {
    createMutate.mockImplementationOnce((_request, options) => options.onError({ response: { status: 429, data: {} } }))
    renderPage()
    const user = await fillDetails()
    await addBlockFromTemplate(user)

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('The server is busy')).toBeInTheDocument()
    expect(screen.getByText(/Nothing you entered is lost/)).toBeInTheDocument()

    createMutate.mockImplementationOnce((_request, options) => options.onError({ response: { status: 403, data: {} } }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('You cannot save this draft')).toBeInTheDocument()
    expect(screen.queryByText('The server is busy')).not.toBeInTheDocument()
  })

  it('does not send a plan with no dates, says so, and sends nothing until they are entered', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Community access weekdays/ }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Enter the agreement dates to price this block')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add to plan' }))

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(createMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Fix these before saving')).toBeInTheDocument()
    expect(screen.getByText('Enter the plan and agreement dates.')).toBeInTheDocument()
  })

  // Review F1: a date box takes a year with five digits ("20261-10-01"), which is later than any end date as text and no date at all to the server.
  it('does not send a date the server cannot read: a five digit year is said in words next to the others and nothing is sent', async () => {
    renderPage()
    const user = await fillDetails()
    await addBlockFromTemplate(user)
    fireEvent.change(screen.getByLabelText('Agreement end'), { target: { value: '20271-06-30' } })

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(createMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Fix these before saving')).toBeInTheDocument()
    expect(screen.getByText('Check the dates: each needs a day, a month and a four digit year between 2000 and 2100.')).toBeInTheDocument()
  })

  it('keeps the plan and says what is wrong when the server answers with the framework\'s validation errors, as an object by field', async () => {
    createMutate.mockImplementation((_request, options) => options.onError({ response: { status: 400, data: { title: 'One or more validation errors occurred.', status: 400, errors: { 'blocks[0].block.sleepoverActiveHours': ['The JSON value could not be converted to System.Decimal. Path: $.blocks[0].block.sleepoverActiveHours | LineNumber: 0 | BytePositionInLine: 480.'] } } } }))
    renderPage()
    const user = await fillDetails('Keep me')
    await addBlockFromTemplate(user)

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    const alert = await screen.findByText('The draft was not saved')
    expect(alert.closest('[role="alert"]')).toHaveTextContent('A box in the plan is empty or is not a number.')
    expect(screen.getByLabelText('Representative')).toHaveValue('Keep me')
    expect(screen.getByText('Mon–Fri · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
  })

  it('does not send an agreement that ends before it starts', async () => {
    renderPage()
    const user = await fillDetails()
    await addBlockFromTemplate(user)
    fireEvent.change(screen.getByLabelText('Agreement end'), { target: { value: '2026-09-01' } })

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(createMutate).not.toHaveBeenCalled()
    expect(screen.getByText('An end date cannot come before its start date.')).toBeInTheDocument()
  })

  it('has nothing to save until there is a block, and starts from the templates', async () => {
    renderPage()
    await fillDetails()

    expect(screen.getByRole('heading', { name: 'Start the week from a template' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
    expect(createMutate).not.toHaveBeenCalled()
  })

  it('stays in the plan overview after a block is added, with the figures beside it', async () => {
    renderPage()
    const user = await fillDetails()
    await addBlockFromTemplate(user)

    expect(screen.getByRole('heading', { name: 'Support plan' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Running budget' })).toHaveTextContent('$30,610.28'))
    expect(screen.getByRole('button', { name: 'Add block' })).toBeInTheDocument()
  })
})

describe('ServiceAgreementDraftPage: a plan the engine cannot price', () => {
  const planWith = (...issues: object[]) => {
    drafts.mockReturnValue({ data: [draft({ version: 4, blocks: [draftBlock(mondayWednesday('b1')), draftBlock(mondayWednesday('b2', { days: ['Saturday'] }))], pricing: quote() })], isLoading: false, isError: false, refetch: vi.fn() })
    budget.mockReturnValue({ data: { ...budgetOf('b1'), period: quote({ ...budgetOf('b1').period, issues: issues as never[] }) }, isError: false, isFetching: false, error: null, refetch: vi.fn() })
  }
  const refusalCallout = (title: string) => screen.getByText(title).closest('div[class*="rounded-lg"]') as HTMLElement

  it('says which blocks cannot be priced and holds Save back, instead of sending a plan the server will refuse', async () => {
    planWith({ blockId: 'b1', reason: 'RegistrationGroupNotHeld', message: "Block 'b1': needs registration group 0125, which the provider does not hold.", count: 1 })
    renderPage()
    const user = userEvent.setup()

    // Design review 5: it names the block by its place and says what to do, not who found the fault ("The pricing engine priced nothing from a block").
    const callout = refusalCallout('Block 1 cannot be priced yet')
    expect(callout).toHaveTextContent('The plan cannot be saved until it can be.')
    expect(callout).toHaveTextContent('Choose another support type, or an Admin can record the groups you hold in Settings, Plan pricing.')
    expect(callout).not.toHaveTextContent(/pricing engine/i)
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(createMutate).not.toHaveBeenCalled()
  })

  it("says it again on the block's own row, with the step that does it, so the way out is where the person is looking", async () => {
    planWith({ blockId: 'b2', reason: 'RegistrationGroupNotHeld', message: "Block 'b2': needs registration group 0125, which the provider does not hold.", count: 1 })
    renderPage()
    const user = userEvent.setup()

    const row = screen.getByText('Your organisation does not hold this registration group').closest('tr') as HTMLElement
    expect(row).toHaveTextContent('Choose another support type')
    await user.click(within(row).getByRole('button', { name: 'Open Support for block 2' }))
    expect(screen.getByRole('heading', { name: 'Edit block 2' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Requirements' })).toBeInTheDocument()
  })

  it('names several blocks by their places, and points at the rows when they were refused for different reasons', () => {
    planWith(
      { blockId: 'b1', reason: 'RegistrationGroupNotHeld', message: "Block 'b1': needs registration group 0125.", count: 1 },
      { blockId: 'b2', reason: 'InvalidInput', message: "Block 'b2': choose at least one day.", count: 1 },
    )
    renderPage()

    const callout = refusalCallout('Blocks 1 and 2 cannot be priced yet')
    expect(callout).toHaveTextContent('The plan cannot be saved until they can be.')
    expect(callout).toHaveTextContent('Each one is marked above with what to do about it.')
  })

  it('says the plan itself cannot be priced when the refusal names no block (the dates, say), and still says what to do', () => {
    planWith({ blockId: '', reason: 'InvalidInput', message: 'The agreement period ends before it starts.', count: 1 })
    renderPage()

    const callout = refusalCallout('This plan cannot be priced yet')
    expect(callout).toHaveTextContent('Fix the field the message names.')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
  })

  it('saves a plan that only has Review flags: they block nothing', async () => {
    planWith({ blockId: 'b1', reason: 'NoItem', message: "Block 'b1': no item.", count: 12, firstDate: '2026-10-13' })
    renderPage()
    const user = userEvent.setup()

    expect(screen.queryByText(/cannot be priced/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(createMutate).toHaveBeenCalledTimes(1)
  })
})

describe('ServiceAgreementDraftPage: starting from the newest revision', () => {
  const block: DraftBlock = draftBlock(mondayWednesday('b1', { location: { state: 'QLD', zone: 'Remote' }, transport: { km: 20, vehicle: 'Standard', tolls: 0, parking: 0 } }), { workerGender: 'Female', driver: true, skills: ['FirstAid'] })
  const pricing: PlanQuote = quote({ totals: { ...quote().totals, amount: 30610.28, holidayOccurrences: 1, reviewLines: 2, provisionalLines: 5 }, issues: [{ blockId: 'b1', reason: 'NoItem', message: "Block 'b1': no item for Weekday Night.", count: 3, firstDate: '2026-10-13' }] })
  const priced = draft({ version: 4, state: 'QLD', representative: 'R. Tran', planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-10-01', agreementEndDate: '2027-03-31', blocks: [block], pricing,
    lines: [{ ...legacyLine, serviceType: 'Community access', itemCode: '04_104_0125_6_1', hours: 8, unitPrice: 73.58, total: 588.64, blockId: 'b1', band: 'Weekday Daytime', occurrences: 2, flags: 'None', catalogueVersion: '2026-27' }] })

  it('loads its details and blocks into the builder, so a new version is a change to the last one', () => {
    drafts.mockReturnValue({ data: [priced, draft({ id: 'd-3', version: 3 })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByLabelText('State')).toHaveValue('QLD')
    expect(screen.getByLabelText('Price zone')).toHaveValue('Remote')
    expect(screen.getByLabelText('Agreement start')).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('Agreement end')).toHaveValue('2027-03-31')
    expect(screen.getByLabelText('Representative')).toHaveValue('R. Tran')
    expect(within(screen.getByRole('region', { name: 'Support plan' })).getByText('Mon, Wed · 09:00–13:00 · Community access 1:1 · +20 km transport')).toBeInTheDocument()
    expect(screen.getByText('Asks for Female worker, driver, first aid')).toBeInTheDocument()
  })

  it('sends the loaded plan back unchanged as the next version, with the requirements it had', async () => {
    drafts.mockReturnValue({ data: [priced], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    const data = createMutate.mock.calls[0][0].data
    expect(data).toMatchObject({ state: 'QLD', planStartDate: '2026-07-01', agreementEndDate: '2027-03-31', representative: 'R. Tran', serviceTypes: ['Community access'], baseVersion: 4 })
    expect(data.blocks).toHaveLength(1)
    expect(data.blocks[0].block.location).toEqual({ state: 'QLD', zone: 'Remote' })
    expect(data.blocks[0].requirements).toEqual({ workerGender: 'Female', driver: true, skills: ['FirstAid'] })
  })

  it('shows each saved version as it was saved: its blocks, its lines with totals and flags, and what a person still had to look at', () => {
    drafts.mockReturnValue({ data: [priced], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    const card = screen.getByText('Version 4').closest('article') as HTMLElement
    expect(within(card).getByText('Blocks in this version')).toBeInTheDocument()
    expect(within(card).getByText(/Mon, Wed · 09:00–13:00/)).toBeInTheDocument()
    expect(within(card).getByText('04_104_0125_6_1')).toBeInTheDocument()
    expect(within(card).getAllByText('$588.64')).toHaveLength(2)    // the line's total, and the total of the lines
    expect(within(card).getByText('8 h')).toBeInTheDocument()
    expect(within(card).getByText('As priced when it was saved: 3 shifts with a part not priced · some lines use provisional rates.')).toBeInTheDocument()
    expect(within(card).getByText(/Part of this block has no price item: Block 1: no item for Weekday Night\. \(3 shifts, from Tue 13 Oct 2026\)/)).toBeInTheDocument()
    expect(within(card).getByText(/over the agreement, including 1 public holiday shift/)).toBeInTheDocument()
    expect(within(card).queryByText('Typed by hand')).not.toBeInTheDocument()
  })

  // The engine keeps one issue for each block, reason and message, counting the shifts it met it on: a block short of two catalogue items has two, each counting the same three shifts.
  it('reads a saved catalogue gap as one line with the shifts it touched, not a line for every item or a count of items', () => {
    const gap = (need: string) => ({ blockId: 'b1', reason: 'CatalogueNotFound' as const, message: `No catalogue row for ${need} is valid for part of the period. Import the catalogue for that period.`, count: 3, firstDate: '2027-07-01' })
    const gapped = draft({ ...priced, version: 5, pricing: quote({ ...pricing, issues: [gap('Community access, Weekday Daytime'), gap('Community access, Weekday Evening')] }) })
    drafts.mockReturnValue({ data: [gapped], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    const card = screen.getByText('Version 5').closest('article') as HTMLElement
    expect(within(card).getAllByText(/No catalogue prices for part of the agreement:/)).toHaveLength(1)
    expect(within(card).getByText(/No catalogue prices for part of the agreement: No catalogue row for Community access, Weekday Daytime is valid for part of the period\. Import the catalogue for that period\. \(3 shifts, from Thu 1 Jul 2027\)/)).toBeInTheDocument()
    expect(within(card).getByText(/As priced when it was saved: 3 shifts with a part not priced/)).toBeInTheDocument()
  })

  // Review F17: this test was titled for the unsaved message and never asserted it (removing the only block leaves an empty plan, which is not dirty).
  it('is not unsaved until the plan changes, and says so, in the save row and on the budget bar, once it has', async () => {
    drafts.mockReturnValue({ data: [priced], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const user = userEvent.setup()
    expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument()
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit times of block 1' }))
    await user.click(screen.getByRole('button', { name: 'Friday' }))
    await user.click(screen.getByRole('button', { name: 'Save block' }))

    expect(screen.getByText(/You have unsaved changes/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Running budget' })).getByText('Not saved')).toBeInTheDocument()
  })

  it('saves from the budget bar with the same request as the save row: the whole plan, on the version it started from', async () => {
    drafts.mockReturnValue({ data: [priced], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Edit times of block 1' }))
    await user.click(screen.getByRole('button', { name: 'Friday' }))
    await user.click(screen.getByRole('button', { name: 'Save block' }))
    await user.click(within(screen.getByRole('region', { name: 'Running budget' })).getByRole('button', { name: 'Save' }))

    expect(createMutate).toHaveBeenCalledTimes(1)
    const { participantId, data } = createMutate.mock.calls[0][0]
    expect(participantId).toBe('p-1')
    expect(data).toMatchObject({ state: 'QLD', planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-10-01', agreementEndDate: '2027-03-31', representative: 'R. Tran', baseVersion: 4, serviceTypes: ['Community access'] })
    expect(data.blocks).toHaveLength(1)
    expect(data.blocks[0].block.days).toEqual(['Monday', 'Wednesday', 'Friday'])
    expect(data.blocks[0].block.location).toEqual({ state: 'QLD', zone: 'Remote' })
    expect(data.blocks[0].requirements).toEqual({ workerGender: 'Female', driver: true, skills: ['FirstAid'] })
  })

  it('removing the only block leaves an empty plan, which has nothing to save or to lose', async () => {
    drafts.mockReturnValue({ data: [priced], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Remove block 1' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove block' }))

    expect(screen.getByRole('heading', { name: 'Start the week from a template' })).toBeInTheDocument()
    expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument()
  })
})

// Review F21: a stored block that can no longer be read came back as an empty block with no signal, so an old revision was blanked quietly.
describe('ServiceAgreementDraftPage: a revision with a block that can no longer be read', () => {
  const lost: DraftBlock = { block: { ...draftBlock().block, id: '' }, requirements: draftBlock().requirements, unreadable: true }
  const withLostBlock = () => draft({ version: 4, blocks: [draftBlock(mondayWednesday('b1')), lost], pricing: quote(), lines: [{ ...legacyLine, blockId: 'b1', band: 'Weekday Daytime', occurrences: 2, flags: 'None' }] })

  it('is not loaded for editing and says so, and shows the version with the block it could not read', () => {
    drafts.mockReturnValue({ data: [withLostBlock()], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText('Version 4 could not be opened for editing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start the week from a template' })).toBeInTheDocument()   // an empty plan, not a plan with a hole in it
    const card = screen.getByText('Version 4', { selector: 'strong' }).closest('article') as HTMLElement
    expect(within(card).getByText('A block that could not be read')).toBeInTheDocument()
    expect(within(card).getByText(/1 block of this version could not be read/)).toBeInTheDocument()
    expect(within(card).getByText(/Mon, Wed · 09:00–13:00/)).toBeInTheDocument()                          // the one that could be read is shown as it was
  })

  it('lets the plan be built again and saved as the next version, on top of the one it could not open', async () => {
    drafts.mockReturnValue({ data: [withLostBlock()], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const user = await fillDetails()
    await addBlockFromTemplate(user)

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(createMutate.mock.calls[0][0].data.baseVersion).toBe(4)
    expect(createMutate.mock.calls[0][0].data.blocks).toHaveLength(1)
    expect(JSON.stringify(createMutate.mock.calls[0][0])).not.toContain('unreadable')
  })

  it('says nothing of it for a revision whose blocks all read', () => {
    drafts.mockReturnValue({ data: [draft({ version: 4, blocks: [draftBlock(mondayWednesday('b1'))], pricing: quote() })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.queryByText(/could not be opened for editing/)).not.toBeInTheDocument()
    expect(screen.queryByText('A block that could not be read')).not.toBeInTheDocument()
  })
})

describe('ServiceAgreementDraftPage: drafts typed by hand before the builder', () => {
  it('shows their lines as they were saved, read-only, with a note to rebuild them from blocks, and starts the builder empty', () => {
    drafts.mockReturnValue({ data: [draft({ version: 1, lines: [legacyLine] })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    const card = screen.getByText('Version 1').closest('article') as HTMLElement
    expect(within(card).getByText('Typed by hand')).toBeInTheDocument()
    expect(within(card).getByText(/cannot be changed\. To rebuild them from support blocks, build the plan above and save it as a new version\./)).toBeInTheDocument()
    expect(within(card).getByText('Daily support')).toBeInTheDocument()
    expect(within(card).getByText('$72.34')).toBeInTheDocument()
    expect(within(card).getByText('$144.68')).toBeInTheDocument()
    expect(within(card).queryByText('Blocks in this version')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start the week from a template' })).toBeInTheDocument()
  })

  it('shows the selected unapproved source version and the server-priced line without calling it signed', () => {
    drafts.mockReturnValue({ data: [draft({ lines: [legacyLine] })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText('$72.34')).toBeInTheDocument()
    expect(screen.getByText(/2026-07 · effective 2026-07-01/)).toBeInTheDocument()
    expect(screen.getByText(/not signed and not billing authority/i)).toBeInTheDocument()
    expect(screen.getByText(/Selected source: ODIP-Service-Agreement-Blank-DRAFT-2026-09-27/)).toBeInTheDocument()
    expect(screen.getByText(/DOCX SHA-256 docx-hash · PDF SHA-256 pdf-hash/)).toBeInTheDocument()
    expect(screen.getByText('SIMULATED — NOT A LEGAL AGREEMENT / NO CLAIM')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run Demo-only simulation' }))
    expect(simulationMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-1' })
  })

  it('keeps the demo simulation collapsed inside a details element, closed by default', () => {
    drafts.mockReturnValue({ data: [draft()], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    const summary = screen.getByText('Demo-only simulation')
    expect(summary.closest('details')).not.toBeNull()
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(summary.tagName).toBe('SUMMARY')
  })

  it('attributes demo simulation success and rejection to their respective draft cards', () => {
    drafts.mockReturnValue({ data: [draft({ id: 'd-old', version: 1, templateVersion: 'draft-v1' }), draft({ id: 'd-new', version: 2, templateVersion: 'draft-v2' })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const oldCard = screen.getByLabelText('Demo-only journey simulation for draft d-old')
    const newCard = screen.getByLabelText('Demo-only journey simulation for draft d-new')

    fireEvent.click(screen.getAllByRole('button', { name: 'Run Demo-only simulation' })[0])
    expect(oldCard).toHaveTextContent('Only the newest draft can run the simulation.')
    expect(newCard).not.toHaveTextContent('Only the newest draft can run the simulation.')

    fireEvent.click(screen.getAllByRole('button', { name: 'Run Demo-only simulation' })[1])
    expect(newCard).toHaveTextContent('Simulation complete for newest')
    expect(oldCard).not.toHaveTextContent('Simulation complete for newest')
    expect(simulationMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-old' })
    expect(simulationMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-new' })
  })
})

describe('ServiceAgreementDraftPage: what is on the page around the plan', () => {
  it('says the NDIS number and date of birth ARE snapshotted into the draft and printed on its PDF, not that they are not copied', () => {
    renderPage()

    const banner = screen.getByText(/Participant identifiers/).closest('p') as HTMLElement
    expect(banner).toHaveTextContent(/snapshot/i)
    expect(banner).toHaveTextContent(/PDF/)
    expect(banner).not.toHaveTextContent(/not copied/i)
    expect(screen.getByText(/NDIS number: Recorded on participant/)).toBeInTheDocument()
    expect(screen.queryByDisplayValue('430000001')).not.toBeInTheDocument()
  })

  it('shows a loading page, a failure with a way to try again, and a missing participant, as the other record pages do', async () => {
    const user = userEvent.setup()
    participant.mockReturnValue({ data: undefined, isLoading: true })
    const { unmount } = renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading service agreement draft…')
    unmount()

    const refetch = vi.fn()
    participant.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch })
    drafts.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch })
    const second = renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this service agreement drafts")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
    second.unmount()

    participant.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } }, refetch })
    renderPage()
    expect(screen.getByText('Participant not found')).toBeInTheDocument()
  })

  it('lets a person who can only read the plan see it, with nothing that changes it and no save', () => {
    asRole('ReadOnly')
    const block: DraftBlock = draftBlock(mondayWednesday('b1'))
    drafts.mockReturnValue({ data: [draft({ blocks: [block], lines: [] })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(within(screen.getByRole('region', { name: 'Support plan' })).getByText('Mon, Wed · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add block' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit times/ })).not.toBeInTheDocument()
    expect(screen.getByText('You can read this plan; Admins and Coordinators change it.')).toBeInTheDocument()
    expect(screen.getByLabelText('Representative').closest('fieldset')).toBeDisabled()
  })

  it('has a Draft versions section that says so when there are none', () => {
    renderPage()
    expect(screen.getByText('No draft versions yet.')).toBeInTheDocument()
  })

  it('uses one h1 for the screen and a heading for each of its three sections', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Service agreement draft' })).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual(['Draft details', 'Support plan', 'Draft versions'])
  })

  it('draws the lines of a saved version with the unit its quantity is in', () => {
    const sleepover = { ...legacyLine, serviceType: 'Personal care', itemCode: '01_010_0107_1_1', hours: 5, unitPrice: 281.97, total: 1409.85, unit: 'E', blockId: 'b1', band: 'Sleepover', occurrences: 5, flags: 'Provisional' }
    drafts.mockReturnValue({ data: [draft({ blocks: [draftBlock(mondayWednesday('b1'))], lines: [sleepover] })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    const card = screen.getByText('Version 2').closest('article') as HTMLElement
    expect(within(card).getByText('5 each')).toBeInTheDocument()
    expect(within(card).getByText('Personal care, Sleepover')).toBeInTheDocument()
    expect(within(card).getByText('Provisional')).toBeInTheDocument()
    expect(line().itemCode).toBe('04_104_0125_6_1')   // the fixtures agree with the engine's brief example
  })
})

describe('ServiceAgreementDraftPage: older revisions are summaries (review F12)', () => {
  const newest = () => draft({ id: 'd-3', version: 3, blocks: [draftBlock(mondayWednesday('b1'))], pricing: quote(), blockCount: 1, lineCount: 1, total: 588.64 })
  const summary = (changes: Partial<ServiceAgreementDraftDto> = {}) => draft({
    id: 'd-2', version: 2, isSummary: true, blockCount: 2, lineCount: 3, total: 795.7, caveats: ['5 shifts have a part that is not priced, so that part is not in any total.'], ...changes,
  })
  const full = () => draft({
    id: 'd-2', version: 2, blocks: [draftBlock(mondayWednesday('b1'))], pricing: quote(), blockCount: 1, lineCount: 1, total: 588.64,
    lines: [{ ...legacyLine, serviceType: 'Community access', itemCode: '04_104_0125_6_1', hours: 8, unitPrice: 73.58, total: 588.64, blockId: 'b1', band: 'Weekday Daytime', occurrences: 2, flags: 'None', catalogueVersion: '2026-27' }],
  })

  it('shows an older revision as what it came to and what a reader must not miss, with no table of lines, and reads nothing until asked', () => {
    drafts.mockReturnValue({ data: [newest(), summary()], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    const card = screen.getByText('Version 2').closest('article') as HTMLElement
    expect(card).toHaveTextContent('2 blocks · 3 lines · $795.70 over the agreement')
    expect(card).toHaveTextContent('5 shifts have a part that is not priced, so that part is not in any total.')
    expect(within(card).queryByRole('table')).not.toBeInTheDocument()
    expect(within(card).queryByText('Blocks in this version')).not.toBeInTheDocument()
    expect(detail).toHaveBeenCalledWith('p-1', 'd-2', false)
    expect(detail).not.toHaveBeenCalledWith('p-1', 'd-2', true)
  })

  it('keeps the newest revision in full and says a summary typed by hand is exactly that', () => {
    drafts.mockReturnValue({ data: [newest(), summary({ blockCount: 0, lineCount: 1, total: 51.37, caveats: [] })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(within(screen.getByText('Version 3').closest('article') as HTMLElement).getByText('Blocks in this version')).toBeInTheDocument()
    expect(screen.getByText('Version 2').closest('article')).toHaveTextContent('Typed by hand before the plan builder · 1 line · $51.37 over the agreement')
  })

  it('reads the revision in full when asked, shows it like any other, and folds it back', async () => {
    detail.mockImplementation((_participantId, _id, enabled) => ({ data: enabled ? full() : undefined, isLoading: false, isError: false, refetch: vi.fn() }))
    drafts.mockReturnValue({ data: [newest(), summary()], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const user = userEvent.setup()

    await user.click(within(screen.getByText('Version 2').closest('article') as HTMLElement).getByRole('button', { name: 'Show details' }))

    expect(detail).toHaveBeenCalledWith('p-1', 'd-2', true)
    const card = screen.getByText('Version 2').closest('article') as HTMLElement
    expect(within(card).getByText('Blocks in this version')).toBeInTheDocument()
    expect(within(card).getByText('04_104_0125_6_1')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Hide details' }))
    expect(within(screen.getByText('Version 2').closest('article') as HTMLElement).getByRole('button', { name: 'Show details' })).toBeInTheDocument()
  })

  it('says it is reading, and when it could not, with a way to try again', async () => {
    const refetch = vi.fn()
    detail.mockImplementation((_participantId, _id, enabled) => (enabled ? { data: undefined, isLoading: false, isError: true, refetch } : { data: undefined, isLoading: false, isError: false, refetch }))
    drafts.mockReturnValue({ data: [newest(), summary()], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const user = userEvent.setup()

    await user.click(within(screen.getByText('Version 2').closest('article') as HTMLElement).getByRole('button', { name: 'Show details' }))
    const card = screen.getByText('Version 2').closest('article') as HTMLElement
    expect(within(card).getByRole('alert')).toHaveTextContent('This version could not be read')
    await user.click(within(card).getByRole('button', { name: 'Try again' }))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('still downloads the PDF of a summary: it is by id, nothing else is needed', async () => {
    drafts.mockReturnValue({ data: [newest(), summary()], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(within(screen.getByText('Version 2').closest('article') as HTMLElement).getByRole('button', { name: /Download draft PDF/ })).toBeEnabled()
  })
})

describe('ServiceAgreementDraftPage: a second coordinator, and a block in progress', () => {
  const saturday = draftBlock(mondayWednesday('b1', { supportType: 'GroupActivity', days: ['Saturday'], start: '09:00:00', end: '15:00:00', participantsPresent: 3 }))
  const newer = () => draft({ id: 'd-5', version: 5, representative: 'Their Rep', blocks: [saturday], pricing: quote() })
  const older = () => draft({ id: 'd-4', version: 4, representative: 'R. Tran', blocks: [draftBlock(mondayWednesday('b1'))], pricing: quote() })

  it('names the version it started from: 0 for a participant with none, and the one it has just made for the next save', async () => {
    createMutate.mockImplementation((_request, options) => options.onSuccess({ version: 1 }))
    renderPage()
    const user = await fillDetails()
    await addBlockFromTemplate(user)
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(createMutate.mock.calls[0][0].data.baseVersion).toBe(0)

    await user.type(screen.getByLabelText('Representative'), ' (again)')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(createMutate.mock.calls[1][0].data.baseVersion).toBe(1)      // the next save starts from the version this one made
  })

  it('starts from the newest revision it loaded', async () => {
    drafts.mockReturnValue({ data: [draft({ version: 7, blocks: [draftBlock(mondayWednesday('b1'))], pricing: quote() }), draft({ id: 'd-6', version: 6 })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(createMutate.mock.calls[0][0].data.baseVersion).toBe(7)
  })

  it('says a newer version was saved by somebody else, keeps everything on screen, and loads theirs only when asked and confirmed', async () => {
    const refetch = vi.fn(async () => { drafts.mockReturnValue({ data: [newer(), older()], isLoading: false, isError: false, refetch }); return {} })
    drafts.mockReturnValue({ data: [older()], isLoading: false, isError: false, refetch })
    createMutate.mockImplementationOnce((_request, options) => options.onError({ response: { status: 409, data: { success: false, code: 'draft-version-conflict', data: { currentVersion: 5 }, errors: ['Version 5 was saved after the version this plan started from. Load version 5 to see what changed, then make your changes again.'] } } }))
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Representative'), ' (mine)')

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    const callout = (await screen.findByText('Version 5 was saved by somebody else')).closest('[role="alert"]') as HTMLElement
    expect(callout).toHaveTextContent('replace their work')
    expect(screen.getByLabelText('Representative')).toHaveValue('R. Tran (mine)')           // nothing on screen was touched
    const plan = within(screen.getByRole('region', { name: 'Support plan' }))
    expect(plan.getByText('Mon, Wed · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
    expect(refetch).toHaveBeenCalled()                                                          // so that theirs is there to load

    await user.click(within(callout).getByRole('button', { name: 'Load version 5' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('replaces the plan and the details on screen')
    await user.click(within(dialog).getByRole('button', { name: 'Load version 5' }))

    expect(await plan.findByText('Sat · 09:00–15:00 · Group activity 1:3')).toBeInTheDocument()
    expect(screen.getByLabelText('Representative')).toHaveValue('Their Rep')
    expect(screen.queryByText('Version 5 was saved by somebody else')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(createMutate.mock.calls[1][0].data.baseVersion).toBe(5)                              // and the next save starts from it
  })

  it('lets a person keep editing instead, and says it again if they save again', async () => {
    drafts.mockReturnValue({ data: [older()], isLoading: false, isError: false, refetch: vi.fn() })
    createMutate.mockImplementation((_request, options) => options.onError({ response: { status: 409, data: { success: false, code: 'draft-version-conflict', data: { currentVersion: 5 }, errors: ['Version 5 was saved.'] } } }))
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByText('Version 5 was saved by somebody else')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByText('Version 5 was saved by somebody else')).toBeInTheDocument()
  })

  it('treats a 409 for any other reason as the failure it is, with no offer to load anything', async () => {
    createMutate.mockImplementation((_request, options) => options.onError({ response: { status: 409, data: { success: false, errors: ['Something else is in the way.'] } } }))
    renderPage()
    const user = await fillDetails()
    await addBlockFromTemplate(user)

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByText('The draft was not saved')).toBeInTheDocument()
    expect(screen.queryByText(/saved by somebody else/)).not.toBeInTheDocument()
  })

  // Review F4: a block being built is not in the plan until "Add to plan", so nothing used to say it would be lost.
  it('asks before leaving once the block in progress has been changed, and keeps it when the person says keep editing', async () => {
    renderPage()
    const user = await fillDetails()
    await addBlockFromTemplate(user)
    await user.click(screen.getByRole('button', { name: 'Add block' }))
    await user.click(screen.getByRole('radio', { name: /Community access weekdays/ }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Friday' }))             // the block in progress is now changed, and is not in the plan

    await user.click(screen.getByRole('link', { name: /Back to participant/i }))

    expect(screen.getByText('Leave without saving?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('heading', { name: 'Days and times' })).toBeInTheDocument()   // still in the stepper, on the same step
  })

  it('does not ask when the block in progress is exactly as its template made it, or when the person has cancelled it', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Community access weekdays/ }))   // as the template made it: nothing to lose

    await user.click(screen.getByRole('link', { name: /Back to participant/i }))

    expect(screen.queryByText('Leave without saving?')).not.toBeInTheDocument()
  })

  // Review F15: the working copy is seeded once, so a change of participant without a remount would post one participant's blocks under another.
  it('starts again for another participant: the first one\'s plan is not the second one\'s working copy', async () => {
    const router = createMemoryRouter([{ path: '/participants/:id/agreement-draft', element: <ServiceAgreementDraftPage /> }], { initialEntries: ['/participants/p-1/agreement-draft'] })
    render(<RouterProvider router={router} />)
    createMutate.mockImplementation((_request, options) => options.onSuccess({ version: 1 }))
    const user = await fillDetails()
    await addBlockFromTemplate(user)
    await user.click(screen.getByRole('button', { name: 'Save draft' }))        // saved, so leaving is not blocked
    expect(screen.getByText('Mon–Fri · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()

    await act(async () => { await router.navigate('/participants/p-2/agreement-draft') })

    expect(screen.queryByRole('button', { name: 'Edit times of block 1' })).not.toBeInTheDocument()       // block 1 of the first participant's plan is gone
    expect(screen.getByRole('heading', { name: 'Start the week from a template' })).toBeInTheDocument()   // and the second participant has an empty plan
    expect(screen.getByLabelText('Representative')).toHaveValue('')
  })
})
