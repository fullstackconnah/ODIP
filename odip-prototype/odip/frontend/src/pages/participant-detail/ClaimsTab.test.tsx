import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ClaimsTab from './ClaimsTab'
import type { TripClaimListDto } from '@/api/types/claims'
import { formatDateAu } from '@/lib/utils'

const { mockUseParticipantClaims, mockPreviewMutate, mockGenerateMutate } = vi.hoisted(() => ({
  mockUseParticipantClaims: vi.fn(),
  mockPreviewMutate: vi.fn(),
  mockGenerateMutate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipantClaims: mockUseParticipantClaims,
  usePreviewShiftClaim: () => ({ mutate: mockPreviewMutate, isPending: false }),
  useGenerateShiftClaim: () => ({ mutate: mockGenerateMutate, isPending: false }),
}))

function tripClaim(overrides: Partial<TripClaimListDto> = {}): TripClaimListDto {
  return {
    id: 'claim-trip-1',
    kind: 'Trip',
    tripInstanceId: 't-1',
    tripName: 'Byron Bay Winter Weekender',
    status: 'Draft',
    claimReference: 'CLM-001',
    totalAmount: 480,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function shiftClaim(overrides: Partial<TripClaimListDto> = {}): TripClaimListDto {
  return {
    id: 'claim-shift-1',
    kind: 'Shift',
    tripName: '',
    participantId: 'participant-1',
    periodFrom: '2026-01-01',
    periodTo: '2026-01-14',
    status: 'Draft',
    claimReference: 'CLM-002',
    totalAmount: 240,
    createdAt: '2026-01-15T00:00:00Z',
    ...overrides,
  }
}

function renderTab(canWrite = true) {
  return render(
    <MemoryRouter initialEntries={['/participants/participant-1']}>
      <Routes>
        <Route path="/participants/:id" element={<ClaimsTab participantId="participant-1" canWrite={canWrite} />} />
        <Route path="/claims/:id" element={<div>Claim detail page</div>} />
        <Route path="/trips/:id" element={<div>Trip detail page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseParticipantClaims.mockReturnValue({ data: [], isLoading: false })
})

describe('ClaimsTab — list', () => {
  it('renders both a Trip claim and a Shift claim, with a kind chip and the right trip link / period for each', () => {
    mockUseParticipantClaims.mockReturnValue({ data: [tripClaim(), shiftClaim()], isLoading: false })
    renderTab()

    expect(screen.getByText('Trip')).toBeInTheDocument()
    expect(screen.getByText('Shift')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Byron Bay Winter Weekender' })).toHaveAttribute('href', '/trips/t-1')
    expect(screen.getByText(`${formatDateAu('2026-01-01')} – ${formatDateAu('2026-01-14')}`)).toBeInTheDocument()
  })

  it('colours the kind chips from tokens (trip = secondary container, shift = accessible container), not raw blue and purple', () => {
    mockUseParticipantClaims.mockReturnValue({ data: [tripClaim(), shiftClaim()], isLoading: false })
    renderTab()

    const trip = screen.getByText('Trip')
    const shift = screen.getByText('Shift')
    expect(trip).toHaveClass('bg-[var(--color-secondary-container)]', 'text-[var(--color-info)]')
    expect(shift).toHaveClass('bg-[var(--color-accessible-container)]', 'text-[var(--color-on-accessible-container)]')
    // Still told apart at a glance: two different token pairs.
    expect(trip.className).not.toBe(shift.className)
    for (const chip of [trip, shift]) expect(chip.className).not.toMatch(/(blue|purple)-\d/)
  })

  it('shows an empty state when the participant has no claims', () => {
    renderTab()
    expect(screen.getByText('No claims yet')).toBeInTheDocument()
  })
})

describe('ClaimsTab — permission gate', () => {
  it('shows the "Generate from shifts" button when canWrite is true', () => {
    renderTab(true)
    expect(screen.getByRole('button', { name: 'Generate from shifts' })).toBeInTheDocument()
  })

  it('hides the "Generate from shifts" button when canWrite is false', () => {
    renderTab(false)
    expect(screen.queryByRole('button', { name: 'Generate from shifts' })).not.toBeInTheDocument()
  })
})

describe('ClaimsTab — generate from shifts', () => {
  async function openModal() {
    const user = userEvent.setup()
    renderTab(true)
    await user.click(screen.getByRole('button', { name: 'Generate from shifts' }))
    return user
  }

  it('previews with the full { from, to } request body the backend validates', async () => {
    const user = await openModal()

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-02-14' } })
    await user.click(screen.getByRole('button', { name: /preview/i }))

    expect(mockPreviewMutate).toHaveBeenCalledTimes(1)
    const [call] = mockPreviewMutate.mock.calls[0]
    expect(call).toEqual({ participantId: 'participant-1', data: { from: '2026-02-01', to: '2026-02-14' } })
  })

  it('shows the preview line items and total, then generates and navigates to the new claim', async () => {
    const user = await openModal()

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-02-14' } })

    mockPreviewMutate.mockImplementation((_vars, { onSuccess }) => onSuccess({
      totalAmount: 320,
      lineItems: [
        { shiftId: 'sh-1', serviceDate: '2026-02-03', dayTypeLabel: 'Weekday', dayType: 'Weekday', supportItemCode: '01_002_0117_1_1', hours: 8, unitPrice: 40, totalAmount: 320 },
      ],
    }))
    await user.click(screen.getByRole('button', { name: /preview/i }))

    // Rendered twice — the summary total and the line-item/footer total.
    expect(screen.getAllByText('$320.00').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('01_002_0117_1_1')).toBeInTheDocument()

    mockGenerateMutate.mockImplementation((_vars, { onSuccess }) => onSuccess({ id: 'claim-99', kind: 'Shift' }))
    await user.click(screen.getByRole('button', { name: /confirm & generate/i }))

    expect(mockGenerateMutate).toHaveBeenCalledTimes(1)
    const [call] = mockGenerateMutate.mock.calls[0]
    expect(call).toEqual({ participantId: 'participant-1', data: { from: '2026-02-01', to: '2026-02-14' } })
    expect(await screen.findByText('Claim detail page')).toBeInTheDocument()
  })

  it('shows the server message inline when the preview 400s on an empty range', async () => {
    const user = await openModal()

    mockPreviewMutate.mockImplementation((_vars, { onError }) => onError({
      response: { data: { message: 'No completed, unclaimed shifts found in this date range.' } },
    }))
    await user.click(screen.getByRole('button', { name: /preview/i }))

    expect(screen.getByRole('alert')).toHaveTextContent('No completed, unclaimed shifts found in this date range.')
  })
})

describe('ClaimsTab — shifts a claim leaves out (L3-02)', () => {
  // A sleepover and a 1:3 group shift cannot be priced from shifts yet: the claim leaves them out, says which and why, and they stay completed and unclaimed.
  const sleepover = { shiftId: 'sh-2', serviceDate: '2026-02-04', description: 'Shift 22:00–06:00 · 8 h', reason: 'It is a sleepover, which shift claims do not price yet.' }
  const group = { shiftId: 'sh-3', serviceDate: '2026-02-07', description: 'Shift 09:00–15:00 · 6 h', reason: 'It is a 1:3 group shift, which shift claims do not price yet.' }
  const priced = { shiftId: 'sh-1', serviceDate: '2026-02-03', dayTypeLabel: 'Weekday', dayType: 'Weekday', supportItemCode: '01_002_0117_1_1', hours: 8, unitPrice: 40, totalAmount: 320 }

  async function previewWith(preview: Record<string, unknown>) {
    const user = userEvent.setup()
    renderTab(true)
    await user.click(screen.getByRole('button', { name: 'Generate from shifts' }))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-02-14' } })
    mockPreviewMutate.mockImplementation((_vars, { onSuccess }) => onSuccess({ totalAmount: 320, lineItems: [priced], ...preview }))
    await user.click(screen.getByRole('button', { name: /preview/i }))
    return user
  }

  it('lists every shift the preview leaves out, with its date, what it is and why, and says they stay unclaimed', async () => {
    await previewWith({ leftOut: [sleepover, group] })

    expect(screen.getByText('2 shifts will be left out of this claim')).toBeInTheDocument()
    expect(screen.getByText(/Shift 22:00–06:00 · 8 h/)).toBeInTheDocument()
    expect(screen.getByText(/It is a sleepover, which shift claims do not price yet\./)).toBeInTheDocument()
    expect(screen.getByText(/Shift 09:00–15:00 · 6 h/)).toBeInTheDocument()
    expect(screen.getByText(/It is a 1:3 group shift, which shift claims do not price yet\./)).toBeInTheDocument()
    expect(screen.getByText(/stay completed and unclaimed/)).toBeInTheDocument()
  })

  it('says it in the singular for one shift', async () => {
    await previewWith({ leftOut: [sleepover] })

    expect(screen.getByText('1 shift will be left out of this claim')).toBeInTheDocument()
  })

  it('says nothing about left-out shifts when none were left out', async () => {
    await previewWith({ leftOut: [] })

    expect(screen.queryByText(/left out of this claim/)).not.toBeInTheDocument()
  })

  it('tolerates a preview with no leftOut member at all (the older shape)', async () => {
    await previewWith({})

    expect(screen.queryByText(/left out of this claim/)).not.toBeInTheDocument()
    expect(screen.getByText('01_002_0117_1_1')).toBeInTheDocument()
  })

  it('shows a priced line that was only partly worked out with its note beside it', async () => {
    await previewWith({ lineItems: [{ ...priced, note: 'Evening and night rates are not applied yet.' }] })

    expect(screen.getByText('Evening and night rates are not applied yet.')).toBeInTheDocument()
  })

  it('stays after generating to say which shifts were left out, and goes to the claim from there', async () => {
    const user = await previewWith({ leftOut: [sleepover] })

    mockGenerateMutate.mockImplementation((_vars, { onSuccess }) => onSuccess({ id: 'claim-99', kind: 'Shift', claimReference: 'TC-4301-20260214', totalAmount: 320, leftOut: [sleepover] }))
    await user.click(screen.getByRole('button', { name: /confirm & generate/i }))

    expect(screen.queryByText('Claim detail page')).not.toBeInTheDocument()   // not navigated away: the person is told first
    expect(screen.getByText('Claim TC-4301-20260214 was made for $320.00, from the shifts that could be priced.')).toBeInTheDocument()
    expect(screen.getByText('1 shift was left out of the claim')).toBeInTheDocument()
    expect(screen.getByText(/It is a sleepover, which shift claims do not price yet\./)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'View claim' }))

    expect(await screen.findByText('Claim detail page')).toBeInTheDocument()
  })

  it('goes straight to the claim when nothing was left out, as before', async () => {
    const user = await previewWith({ leftOut: [] })

    mockGenerateMutate.mockImplementation((_vars, { onSuccess }) => onSuccess({ id: 'claim-99', kind: 'Shift', leftOut: [] }))
    await user.click(screen.getByRole('button', { name: /confirm & generate/i }))

    expect(await screen.findByText('Claim detail page')).toBeInTheDocument()
  })

  it('shows the server\'s refusal that says shifts were left out', async () => {
    const user = userEvent.setup()
    renderTab(true)
    await user.click(screen.getByRole('button', { name: 'Generate from shifts' }))
    mockPreviewMutate.mockImplementation((_vars, { onError }) => onError({
      response: { data: { message: 'Nothing in this date range could be claimed: 1 completed, unclaimed shift was left out. It is a sleepover, which shift claims do not price yet.' } },
    }))
    await user.click(screen.getByRole('button', { name: /preview/i }))

    expect(screen.getByRole('alert')).toHaveTextContent('1 completed, unclaimed shift was left out. It is a sleepover')
  })
})

describe('ClaimsTab — shifts priced with a caveat (review F2)', () => {
  // An overnight shift is priced as hours at one day rate: the preview says so on its line, but a claim line has no column to keep that in, so the generate response echoes it and the screen that
  // generated the claim says it once more before leaving, beside the shifts that were left out.
  const flagged = { shiftId: 'sh-4', serviceDate: '2026-02-05', description: 'Shift 18:00–02:00 · 8 h', caveat: 'Evening and night rates are not applied yet.' }
  const sleepover = { shiftId: 'sh-2', serviceDate: '2026-02-04', description: 'Shift 22:00–06:00 · 8 h', reason: 'It is a sleepover, which shift claims do not price yet.' }

  async function generateWith(generated: Record<string, unknown>) {
    const user = userEvent.setup()
    renderTab(true)
    await user.click(screen.getByRole('button', { name: 'Generate from shifts' }))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-02-14' } })
    mockPreviewMutate.mockImplementation((_vars, { onSuccess }) => onSuccess({
      totalAmount: 320,
      lineItems: [{ shiftId: 'sh-1', serviceDate: '2026-02-03', dayTypeLabel: 'Weekday', dayType: 'Weekday', supportItemCode: '01_002_0117_1_1', hours: 8, unitPrice: 40, totalAmount: 320 }],
    }))
    await user.click(screen.getByRole('button', { name: /preview/i }))
    mockGenerateMutate.mockImplementation((_vars, { onSuccess }) => onSuccess({ id: 'claim-99', kind: 'Shift', claimReference: 'TC-4301-20260214', totalAmount: 640, ...generated }))
    await user.click(screen.getByRole('button', { name: /confirm & generate/i }))
    return user
  }

  it('stays after generating to name the shifts that carry a caveat, even when none was left out', async () => {
    const user = await generateWith({ leftOut: [], flagged: [flagged] })

    expect(screen.queryByText('Claim detail page')).not.toBeInTheDocument()
    // Nothing was left out, so the sentence must not say the claim was made "from the shifts that could be priced": every shift in the range is in it.
    expect(screen.getByText('Claim TC-4301-20260214 was made for $640.00.')).toBeInTheDocument()
    expect(screen.queryByText(/from the shifts that could be priced/)).not.toBeInTheDocument()
    expect(screen.getByText('1 shift in this claim has a pricing note')).toBeInTheDocument()
    expect(screen.getByText(/Shift 18:00–02:00 · 8 h/)).toBeInTheDocument()
    expect(screen.getByText(/Evening and night rates are not applied yet\./)).toBeInTheDocument()
    expect(screen.queryByText(/left out of the claim/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'View claim' }))

    expect(await screen.findByText('Claim detail page')).toBeInTheDocument()
  })

  it('shows the shifts left out and the shifts with a caveat together', async () => {
    await generateWith({ leftOut: [sleepover], flagged: [flagged, { ...flagged, shiftId: 'sh-5', serviceDate: '2026-02-06' }] })

    expect(screen.getByText('Claim TC-4301-20260214 was made for $640.00, from the shifts that could be priced.')).toBeInTheDocument()   // here some WERE left out, so the clause is true
    expect(screen.getByText('1 shift was left out of the claim')).toBeInTheDocument()
    expect(screen.getByText('2 shifts in this claim have a pricing note')).toBeInTheDocument()
    expect(screen.getAllByText(/Evening and night rates are not applied yet\./)).toHaveLength(2)
  })

  it('goes straight to the claim when nothing was left out and nothing carries a caveat', async () => {
    await generateWith({ leftOut: [], flagged: [] })

    expect(await screen.findByText('Claim detail page')).toBeInTheDocument()
  })

  it('tolerates a generate response with no flagged member at all (the older shape)', async () => {
    await generateWith({})

    expect(await screen.findByText('Claim detail page')).toBeInTheDocument()
  })
})
