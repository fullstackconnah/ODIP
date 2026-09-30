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
