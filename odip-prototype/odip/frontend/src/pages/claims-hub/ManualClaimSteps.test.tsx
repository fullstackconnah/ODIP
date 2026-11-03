import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ManualClaimPreviewDto, SupportActivityGroupDto, SupportCatalogueItemDto } from '@/api/types'
import { ManualClaimSteps } from './ManualClaimSteps'

// The two steps of "A one-off claim": fill in the claim, then check it and make it. The chooser row that opens them is in NewClaimModal.test.tsx.

const m = vi.hoisted(() => ({ participants: vi.fn(), participant: vi.fn(), provider: vi.fn(), catalogue: vi.fn(), preview: vi.fn(), make: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useParticipants: m.participants, useParticipant: m.participant, useProviderSettings: m.provider, useSupportCatalogue: m.catalogue }))
vi.mock('@/api/hooks/claimHub', () => ({ usePreviewManualClaim: m.preview, useMakeManualClaim: m.make }))

const item = (over: Partial<SupportCatalogueItemDto> = {}): SupportCatalogueItemDto => ({
  id: 'i-1', itemNumber: '01_011_0107_1_1', description: 'Assistance with self-care', unit: 'H', dayType: 'Weekday', isIntensive: false,
  priceLimit_ACT: 70, priceLimit_NSW: 72, priceLimit_NT: 70, priceLimit_QLD: 70, priceLimit_SA: 70, priceLimit_TAS: 70, priceLimit_VIC: 68, priceLimit_WA: 70, priceLimit_Remote: 80, priceLimit_VeryRemote: 90,
  catalogueVersion: '2026-27', effectiveFrom: '2026-07-01', isActive: true, isLegacy: false, priceNational: 68, ...over,
} as SupportCatalogueItemDto)
const quoteItem = item({ id: 'i-2', itemNumber: 'QUOTE_1', description: 'Home modification', unit: 'EA', priceNational: undefined, priceLimit_NSW: 0, priceLimit_VIC: 0 })
const groups = [{ id: 'g-1', groupCode: 'G', displayName: 'Group', supportCategory: 1, isActive: true, items: [item(), quoteItem] }] as SupportActivityGroupDto[]
const previewOf = (over: Partial<ManualClaimPreviewDto> = {}): ManualClaimPreviewDto => ({
  participantName: 'Sam Lee', total: 144,
  lines: [{ code: '01_011_0107_1_1', name: 'Assistance with self-care', unit: 'H', date: '2026-10-20', dayType: 'Weekday', quantity: 2, unitPrice: 72, total: 144, limit: 72, state: 'NSW' }],
  plan: { start: '2026-07-01', end: '2027-06-30' }, warnings: [], ...over,
})
const refused = (message: string) => ({ response: { data: { errors: [message] } } })
const mutation = (over: object = {}) => ({ mutate: vi.fn(), reset: vi.fn(), data: undefined, error: null, isPending: false, isError: false, ...over })

function setup() {
  const props = { onBack: vi.fn(), onClose: vi.fn(), onMade: vi.fn() }
  render(<ManualClaimSteps {...props} />)
  return props
}

async function fill({ price, qty = '2', date = '2026-10-20', code = /01_011_0107_1_1/ }: { price?: string; qty?: string; date?: string; code?: RegExp } = {}) {
  await userEvent.click(screen.getByLabelText('Participant'))
  await userEvent.click(await screen.findByRole('option', { name: /Sam Lee/ }))
  await userEvent.type(screen.getByLabelText('Service date'), date)
  await userEvent.click(screen.getByLabelText('Support item'))
  await userEvent.click(await screen.findByRole('option', { name: code }))
  await userEvent.type(screen.getByLabelText(/^(Hours|Quantity)/), qty)
  if (price !== undefined) {
    await userEvent.clear(screen.getByLabelText('Unit price'))
    await userEvent.type(screen.getByLabelText('Unit price'), price)
  }
}

beforeEach(() => {
  m.participants.mockReturnValue({ data: [{ id: 'p-1', fullName: 'Sam Lee', firstName: 'Sam', lastName: 'Lee', maskedNdisNumber: '430***789' }, { id: 'p-2', fullName: 'No Number', firstName: 'No', lastName: 'Number', maskedNdisNumber: null }], isLoading: false, isError: false, refetch: vi.fn() })
  m.participant.mockReturnValue({ data: { id: 'p-1', addressState: 'NSW' } })
  m.provider.mockReturnValue({ data: { state: 'VIC' } })
  m.catalogue.mockReturnValue({ data: groups, isLoading: false, isError: false, refetch: vi.fn() })
  m.preview.mockReturnValue(mutation())
  m.make.mockReturnValue(mutation())
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ManualClaimSteps: fill in the claim', () => {
  it('lists the fields in order: participant, support item, service date, hours or quantity, unit price, note', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'A one-off claim' })).toBeInTheDocument()
    const labels = [...screen.getByRole('dialog').querySelectorAll('label')].map(l => l.textContent ?? '')
    const order = ['Participant', 'Support item', 'Service date', 'Quantity', 'Unit price', 'Note']
    expect(order.map(o => labels.findIndex(l => l.startsWith(o)))).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('opens on the participant field', () => {
    setup()
    expect(screen.getByLabelText('Participant')).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it("shows each participant's NDIS number under the name, and none when there is no number", async () => {
    setup()
    await userEvent.click(screen.getByLabelText('Participant'))
    expect(within(await screen.findByRole('option', { name: /Sam Lee/ })).getByText('430***789')).toBeInTheDocument()
    expect(within(screen.getByRole('option', { name: /No Number/ })).queryByText(/\d/)).toBeNull()
  })

  it('puts the price guide limit under Unit price, not under Support item', async () => {
    setup()
    await fill()
    const hint = screen.getByText('Price guide limit $72.00 in NSW')
    expect(screen.getByLabelText('Unit price').closest('div')).toContainElement(hint)
    expect(screen.getByLabelText('Support item').closest('div')).not.toContainElement(hint)
  })

  it('waits for the date field to be left before it says the day is in the future', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Service date'), '2999-01-01')
    expect(screen.queryByText("You can't claim for a day that hasn't happened yet.")).not.toBeInTheDocument()
    await userEvent.tab()
    expect(screen.getByText("You can't claim for a day that hasn't happened yet.")).toBeInTheDocument()
  })

  it("prefills the item's limit in the participant's state and says so; the label follows the unit", async () => {
    setup()
    await fill()
    expect(screen.getByLabelText('Hours')).toBeInTheDocument()
    expect(screen.getByLabelText('Unit price')).toHaveValue('72')
    expect(screen.getByText('Price guide limit $72.00 in NSW')).toBeInTheDocument()
  })

  it('says a quote item has no limit and leaves the price empty', async () => {
    setup()
    await fill({ code: /QUOTE_1/ })
    expect(screen.getByText('No price guide limit for this item')).toBeInTheDocument()
    expect(screen.getByLabelText('Unit price')).toHaveValue('')
  })

  it('shows the over-limit hint on blur and holds Preview off', async () => {
    setup()
    await fill({ price: '80' })
    await userEvent.tab()
    expect(screen.getByText('Over the NSW limit of $72.00.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
  })

  it('shows the future-date hint and a zero quantity hint', async () => {
    setup()
    await fill({ date: '2999-01-01', qty: '0' })
    await userEvent.tab()
    expect(screen.getByText("You can't claim for a day that hasn't happened yet.")).toBeInTheDocument()
    expect(screen.getByText('Enter more than 0.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
  })

  it('enables Preview again once a future date is corrected', async () => {
    setup()
    await fill({ date: '2999-01-01' })
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Service date'))
    await userEvent.type(screen.getByLabelText('Service date'), '2026-10-20')
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
  })

  it('keeps Preview disabled until the fields are valid, then previews what was entered', async () => {
    const preview = mutation()
    m.preview.mockReturnValue(preview)
    setup()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
    await fill()
    await userEvent.type(screen.getByLabelText(/^Note/), ' on a Sunday ')
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(preview.mutate).toHaveBeenCalledWith({
      participantId: 'p-1', lines: [{ supportItemCode: '01_011_0107_1_1', serviceDate: '2026-10-20', quantity: 2, unitPrice: 72 }], notes: 'on a Sunday',
    })
  })

  it('shows the price-guide error in place of the field and retries', async () => {
    const refetch = vi.fn()
    m.catalogue.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    setup()
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('Back leaves to the chooser', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(props.onBack).toHaveBeenCalled()
  })
})

describe('ManualClaimSteps: check the claim', () => {
  async function toCheck(previewed: object = { data: previewOf() }) {
    m.preview.mockReturnValue(mutation({ ...previewed }))
    const props = setup()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    return props
  }

  it('shows the summary, the columns Item, Date, Quantity, Rate, Total, the total and the plan line', async () => {
    await toCheck()
    expect(screen.getByRole('dialog', { name: 'Check the claim' })).toBeInTheDocument()
    expect(screen.getByText('Sam Lee · Tue 20 Oct 2026')).toBeInTheDocument()
    expect([...screen.getAllByRole('columnheader')].map(h => h.textContent)).toEqual(['Item', 'Date', 'Quantity', 'Rate', 'Total'])
    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByText('01_011_0107_1_1')).toBeInTheDocument()
    expect(within(row).getByText('Assistance with self-care')).toBeInTheDocument()
    expect(within(row).getByText('$72.00')).toBeInTheDocument()
    expect(within(row).getAllByText('$144.00').length).toBeGreaterThan(0)
    expect(screen.getByText(/Bills against the plan 1 Jul 2026 – 30 Jun 2027/)).toBeInTheDocument()
  })

  it('says so when there is no plan on file', async () => {
    await toCheck({ data: previewOf({ plan: undefined }) })
    expect(screen.getByText('No plan on file, so the budget is not checked.')).toBeInTheDocument()
    expect(screen.queryByText(/Bills against the plan/)).not.toBeInTheDocument()
  })

  it('opens on Make claim, and Back returns to Preview', async () => {
    await toCheck()
    expect(screen.getByRole('button', { name: 'Make claim' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveFocus()
    expect(screen.getByLabelText('Unit price')).toHaveValue('72')
  })

  it('lists the warnings in one warning callout', async () => {
    await toCheck({ data: previewOf({ warnings: ['CLM-1 already claims 01_011_0107_1_1 for Sam Lee on 20 Oct 2026.', 'Over 90 days since the service.'] }) })
    expect(screen.getByText(/CLM-1 already claims/)).toBeInTheDocument()
    expect(screen.getByText(/Over 90 days since the service/)).toBeInTheDocument()
  })

  it('says a refusal in a danger callout and disables Make claim', async () => {
    await toCheck({ data: undefined, isError: true, error: refused('1 Jan 2026 is outside the plan dates.') })
    expect(screen.getByText(/is outside the plan dates/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make claim' })).toBeDisabled()
  })

  it('makes the claim and hands its id on', async () => {
    const make = mutation()
    make.mutate.mockImplementation((_req: unknown, o: { onSuccess: (c: { id: string }) => void }) => o.onSuccess({ id: 'c-9' }))
    m.make.mockReturnValue(make)
    const props = await toCheck()
    await userEvent.click(screen.getByRole('button', { name: 'Make claim' }))
    expect(make.mutate).toHaveBeenCalledWith(expect.objectContaining({ participantId: 'p-1' }), expect.anything())
    expect(props.onMade).toHaveBeenCalledWith('c-9')
  })

  it('holds the button while making', async () => {
    m.make.mockReturnValue(mutation({ isPending: true }))
    await toCheck()
    const button = screen.getByRole('button', { name: 'Making claim…' })
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('shows a make error and leaves the button live', async () => {
    m.make.mockReturnValue(mutation({ isError: true, error: refused('Participant not found.') }))
    await toCheck()
    expect(screen.getByText('Participant not found.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make claim' })).toBeEnabled()
  })
})
