import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as React from 'react'
import type { DraftBlock, PlanQuote, ServiceAgreementDraftDto } from '@/api/types'
import { budgetOf, draftBlock, line, mondayWednesday, quote, settings as makeSettings } from '@/test/fixtures/planPricing'
import ServiceAgreementDraftPage from './ServiceAgreementDraftPage'

const { createMutate, drafts, participant, snapshotMutate, evidenceMutate, simulationMutate, budget } = vi.hoisted(() => ({
  createMutate: vi.fn(), drafts: vi.fn(), participant: vi.fn(), snapshotMutate: vi.fn(), evidenceMutate: vi.fn(), simulationMutate: vi.fn(), budget: vi.fn(),
}))
vi.mock('@/api/hooks', () => ({
  useParticipant: () => participant(),
  useServiceAgreementDrafts: () => drafts(),
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
  state: 'NSW', planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-07-01', agreementEndDate: '2027-06-30', blocks: [], lines: [], ...changes,
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
  const planWith = (issue: object) => {
    drafts.mockReturnValue({ data: [draft({ version: 4, blocks: [draftBlock(mondayWednesday('b1'))], pricing: quote() })], isLoading: false, isError: false, refetch: vi.fn() })
    budget.mockReturnValue({ data: { ...budgetOf('b1'), period: quote({ ...budgetOf('b1').period, issues: [issue as never] }) }, isError: false, isFetching: false, error: null, refetch: vi.fn() })
  }

  it('says which blocks cannot be priced and holds Save back, instead of sending a plan the server will refuse', async () => {
    planWith({ blockId: 'b1', reason: 'RegistrationGroupNotHeld', message: "Block 'b1': needs registration group 0125, which the provider does not hold.", count: 1 })
    renderPage()
    const user = userEvent.setup()

    expect(screen.getByText('1 block cannot be priced')).toBeInTheDocument()
    expect(screen.getByText(/so this plan cannot be saved until it is fixed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(createMutate).not.toHaveBeenCalled()
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
    expect(data).toMatchObject({ state: 'QLD', planStartDate: '2026-07-01', agreementEndDate: '2027-03-31', representative: 'R. Tran', serviceTypes: ['Community access'] })
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
    expect(within(card).getByText(/2 lines to review, 5 provisional/)).toBeInTheDocument()
    expect(within(card).getByText(/Part of this block has no price item: Block 1: no item for Weekday Night\. \(3 shifts, from Tue 13 Oct 2026\)/)).toBeInTheDocument()
    expect(within(card).getByText(/over the agreement, including 1 public holiday shift/)).toBeInTheDocument()
    expect(within(card).queryByText('Typed by hand')).not.toBeInTheDocument()
  })

  it('reads a saved catalogue gap as one line with the shifts it touched, not a line for every date', () => {
    const gap = (date: string) => ({ blockId: 'b1', reason: 'CatalogueNotFound' as const, message: `No catalogue row for Community access is valid on ${date}.`, count: 1, firstDate: date })
    const gapped = draft({ ...priced, version: 5, pricing: quote({ ...pricing, issues: ['2027-07-03', '2027-07-01', '2027-07-02'].map(gap) }) })
    drafts.mockReturnValue({ data: [gapped], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    const card = screen.getByText('Version 5').closest('article') as HTMLElement
    expect(within(card).getAllByText(/No catalogue prices for part of the agreement:/)).toHaveLength(1)
    expect(within(card).getByText(/No catalogue prices for part of the agreement: No catalogue row for Community access is valid on 2027-07-01\. \(3 shifts, from Thu 1 Jul 2027\)/)).toBeInTheDocument()
  })

  it('is not dirty until the plan changes, and says so once it has', async () => {
    drafts.mockReturnValue({ data: [priced], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const user = userEvent.setup()
    expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove block 1' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove block' }))

    expect(screen.getByRole('heading', { name: 'Start the week from a template' })).toBeInTheDocument()
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
