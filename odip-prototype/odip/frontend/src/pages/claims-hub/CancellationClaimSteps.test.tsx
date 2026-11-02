import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CancellationCandidateDto, CancellationCandidatesDto, ShiftClaimPreviewResponseDto } from '@/api/types'
import { CancellationClaimSteps } from './CancellationClaimSteps'

// The two steps of "A cancellation": choose the shift and the reason, then check the claim and make it. The chooser row that opens them is in NewClaimModal.test.tsx.

const m = vi.hoisted(() => ({ preview: vi.fn(), make: vi.fn() }))
vi.mock('@/api/hooks/claimHub', () => ({ usePreviewCancellationClaim: m.preview, useMakeCancellationClaim: m.make }))

const shift = (over: Partial<CancellationCandidateDto> = {}): CancellationCandidateDto => ({
  shiftId: 'sh-1', participantId: 'p-1', participantName: 'Sam Lee', serviceDate: '2026-10-20', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
  cancelledAt: '2026-10-17T01:30:00Z', totalAmount: 480, ...over,
})
const data = (over: Partial<CancellationCandidatesDto> = {}): CancellationCandidatesDto => ({ shifts: [shift(), shift({ shiftId: 'sh-2', participantName: 'Jo Park', serviceDate: '2026-10-21' })], leftOut: [], ...over })
const query = (d: CancellationCandidatesDto | undefined, over: object = {}) => ({ data: d, isLoading: false, isError: false, refetch: vi.fn(), ...over })
const previewOf = (over: Partial<ShiftClaimPreviewResponseDto> = {}): ShiftClaimPreviewResponseDto => ({
  totalAmount: 480,
  lineItems: [{ shiftId: 'sh-1', serviceDate: '2026-10-20', dayTypeLabel: 'Weekday', dayType: 'Weekday', supportItemCode: '04_104_0125_6_1', claimType: 'Cancellation', unit: 'H', hours: 8, unitPrice: 60, totalAmount: 480 }],
  leftOut: [], ...over,
})
const budgetOf = () => ({ participants: [{ participantId: 'p-1', participantName: 'Sam Lee', rows: [{ placement: 'Pool' as const, poolName: 'Core (flexible)', periodStart: '2026-07-01', periodEnd: '2026-12-31', thisClaim: 480, leftAfter: 13320 }] }] })
const refused = (message: string) => ({ response: { data: { errors: [message] } } })
const mutation = (over: object = {}) => ({ mutate: vi.fn(), reset: vi.fn(), data: undefined, error: null, isPending: false, isError: false, ...over })

function setup(candidates = query(data())) {
  const props = { onBack: vi.fn(), onClose: vi.fn(), onMade: vi.fn() }
  render(<CancellationClaimSteps candidates={candidates} {...props} />)
  return props
}

async function pick(reason = 'No show – family issues') {
  await userEvent.click(screen.getByLabelText('Cancelled shift'))
  await userEvent.click(await screen.findByRole('option', { name: /Sam Lee/ }))
  await userEvent.click(screen.getByLabelText('Why did the participant cancel?'))
  await userEvent.click(await screen.findByRole('option', { name: reason }))
}

beforeEach(() => {
  m.preview.mockReturnValue(mutation())
  m.make.mockReturnValue(mutation())
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CancellationClaimSteps: choose the shift', () => {
  it('lists each cancelled shift with its day, times and when it was cancelled, and says to claim only when the participant cancelled', async () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Choose a cancelled shift' })).toBeInTheDocument()
    expect(screen.getByText('Only claim when the participant cancelled.')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Cancelled shift'))
    const option = await screen.findByRole('option', { name: /Sam Lee/ })
    expect(option).toHaveTextContent('Sam Lee · Tue 20 Oct 2026')
    expect(option).toHaveTextContent('9am–⁠5pm · cancelled')
  })

  it('offers the four reasons the no-show claim offers', async () => {
    setup()
    await userEvent.click(screen.getByLabelText('Why did the participant cancel?'))
    expect((await screen.findAllByRole('option')).map(o => o.textContent)).toEqual([
      'No show – health reason', 'No show – family issues', 'No show – transport unavailable', 'Other',
    ])
  })

  it('holds Preview until both a shift and a reason are chosen', async () => {
    setup()
    const previewButton = screen.getByRole('button', { name: 'Preview' })
    expect(previewButton).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Cancelled shift'))
    await userEvent.click(await screen.findByRole('option', { name: /Sam Lee/ }))
    expect(previewButton).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Why did the participant cancel?'))
    await userEvent.click(await screen.findByRole('option', { name: 'Other' }))
    expect(previewButton).toBeEnabled()
  })

  it('previews the chosen shift, and Back from the first step goes to the chooser', async () => {
    const preview = mutation()
    m.preview.mockReturnValue(preview)
    const { onBack } = setup()
    await pick()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(preview.mutate).toHaveBeenCalledWith('sh-1')
    expect(screen.getByRole('dialog', { name: 'Check the claim' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('lists the cancelled shifts it does not offer, with why, and does not say the participant twice', () => {
    setup(query(data({
      leftOut: [
        { shiftId: 'x-1', serviceDate: '2026-10-19', participantName: 'Sophie Brown', description: 'Shift 09:00–17:00 · 8 h', reason: 'Cancelled 12 days ahead. Only a cancellation less than 7 days before the shift can be claimed.' },
        { shiftId: 'x-2', serviceDate: '2026-10-18', participantName: 'Jo Park', description: 'Shift 13:00–16:00 · 3 h', reason: 'Jo Park: NDIS number missing.' },
      ],
    })))
    expect(screen.getByText('2 cancelled shifts not offered')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem').map(li => li.textContent)
    expect(rows[0]).toBe('Mon 19 Oct 2026 · Sophie Brown · Shift 09:00–⁠17:00 · 8 h · Cancelled 12 days ahead. Only a cancellation less than 7 days before the shift can be claimed.')
    expect(rows[1]).toBe('Sun 18 Oct 2026 · Jo Park · Shift 13:00–⁠16:00 · 3 h · NDIS number missing.')   // U+2060 after the dash: the range never breaks there
  })

  it('says nothing is waiting when no shift can be claimed, and still lists why', () => {
    setup(query(data({ shifts: [], leftOut: [{ shiftId: 'x-1', serviceDate: '2026-10-19', participantName: 'Sophie Brown', description: 'Shift 09:00–17:00 · 8 h', reason: 'Cancelled 12 days ahead.' }] })))
    expect(screen.getByText('No short-notice cancellations to claim')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument()
    expect(screen.getByText('1 cancelled shift not offered')).toBeInTheDocument()
  })

  it('shows an error with retry in place of the fields when the list cannot load', async () => {
    const candidates = query(undefined, { isError: true })
    setup(candidates)
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(candidates.refetch).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Couldn't load this list of cancelled shifts./)).toBeInTheDocument()
    expect(screen.queryByLabelText('Cancelled shift')).not.toBeInTheDocument()
  })
})

describe('CancellationClaimSteps: check the claim', () => {
  async function toCheck(previewState: object, makeState: object = {}) {
    const preview = mutation(previewState)
    const make = mutation(makeState)
    m.preview.mockReturnValue(preview)
    m.make.mockReturnValue(make)
    const props = setup()
    await pick()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    return { ...props, preview, make }
  }

  it('shows the loading state while the preview is worked out, and holds Make claim', async () => {
    await toCheck({ isPending: true })
    expect(screen.getByRole('status')).toHaveTextContent('Loading claim preview')
    expect(screen.getByRole('button', { name: 'Make claim' })).toBeDisabled()
  })

  it('shows the shift, the reason, the total after the lines, and the budget effect', async () => {
    await toCheck({ data: previewOf({ budget: budgetOf() }) })
    expect(screen.getByText(/Sam Lee · Tue 20 Oct 2026 · 9am–⁠5pm · No show – family issues/)).toBeInTheDocument()
    expect(screen.getAllByText('$480.00').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Item', 'Hours', 'Rate', 'Total'])
    expect(screen.getByRole('cell', { name: /04_104_0125_6_1/ })).toHaveTextContent('04_104_0125_6_1Weekday')   // the day type is the second line of the item cell
    const total = screen.getByText('Total', { selector: 'span' })
    expect(screen.getByRole('table').compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Budget' })).toHaveTextContent('Uses $480 of Core (flexible)')
  })

  it('makes the claim with the shift and the reason code, then hands the new claim to the page', async () => {
    const make = mutation({ data: undefined })
    make.mutate.mockImplementation((_vars: unknown, options?: { onSuccess?: (created: { id: string }) => void }) => options?.onSuccess?.({ id: 'claim-9' }))
    m.make.mockReturnValue(make)
    m.preview.mockReturnValue(mutation({ data: previewOf() }))
    const { onMade } = setup()
    await pick()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Make claim' }))
    expect(make.mutate).toHaveBeenCalledWith({ shiftId: 'sh-1', cancellationReason: 'NSDF' }, expect.anything())
    expect(onMade).toHaveBeenCalledWith('claim-9')
  })

  it('says Making claim… and cannot be closed or backed out of while the claim is saved', async () => {
    await toCheck({ data: previewOf() }, { isPending: true })
    const button = screen.getByRole('button', { name: 'Making claim…' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
  })

  it('names why the claim was refused and leaves Make claim live to try again', async () => {
    await toCheck({ data: previewOf() }, { isError: true, error: refused('This shift is already on claim TC-1.') })
    expect(screen.getByRole('alert')).toHaveTextContent('This shift is already on claim TC-1.')
    expect(screen.getByRole('button', { name: 'Make claim' })).toBeEnabled()
  })

  it('names the rule that refused the preview and offers only Back, since asking again cannot pass', async () => {
    await toCheck({ isError: true, error: refused('Cancelled 8 days ahead.') })
    expect(screen.getByRole('alert')).toHaveTextContent('Cancelled 8 days ahead.')
    expect(screen.queryByRole('button', { name: 'Make claim' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
  })

  it('offers Try again when the preview failed to load at all, which asks again', async () => {
    const { preview } = await toCheck({ isError: true, error: new Error('Network Error') })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the preview.")
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(preview.mutate).toHaveBeenLastCalledWith('sh-1')
  })

  it('Back returns to the first step with the shift and the reason still chosen', async () => {
    await toCheck({ data: previewOf() })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'Choose a cancelled shift' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
  })
})
