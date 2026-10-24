import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GenerateClaimModal from './GenerateClaimModal'
import type { ClaimPreviewResponseDto, TripDetailDto } from '@/api/types'
import { restoreZone, setZone } from '@/test/timeZone'

const preview: ClaimPreviewResponseDto = {
  departureTime: '08:00', returnTime: '18:00', activeHoursPerDay: 8, staffCount: 2, state: 'NSW', confirmedParticipantCount: 1, totalAmount: 1234.5,
  lineItems: [{ participantName: 'Priya Nair', dayType: 'Weekday', supportsDeliveredFrom: '2026-08-14', supportsDeliveredTo: '2026-08-15', hours: 8, unitPrice: 60, totalAmount: 480 }],
} as unknown as ClaimPreviewResponseDto

// The participants the preview leaves out; a test sets it before it opens the preview.
const shown = vi.hoisted(() => ({ leftOut: [] as unknown[] }))

vi.mock('@/api/hooks', () => ({
  usePreviewClaim: () => ({ mutate: (_: unknown, o: { onSuccess: (d: ClaimPreviewResponseDto) => void }) => o.onSuccess({ ...preview, leftOut: shown.leftOut } as ClaimPreviewResponseDto), isPending: false }),
  useGenerateClaim: () => ({ mutate: vi.fn(), isPending: false }),
}))

const trip = { id: 't1', tripName: 'Byron Bay', startDate: '2026-08-14', endDate: '2026-08-17' } as TripDetailDto

afterEach(() => { restoreZone(); shown.leftOut = [] })

// Standard 8. The trip and line-item dates are DateOnly; `new Date("2026-08-14")` is UTC midnight, the evening before west of UTC.
describe('GenerateClaimModal — dates and money', () => {
  it.each(['America/Los_Angeles', 'Australia/Sydney'])('prints the calendar days and an AUD total in %s', async zone => {
    if (!setZone(zone)) return
    const user = userEvent.setup()
    render(<GenerateClaimModal tripId="t1" trip={trip} onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByText(/14\/08\/2026 – 17\/08\/2026/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Preview Claim/ }))
    expect(screen.getByText('$1,234.50')).toBeInTheDocument()
    expect(screen.getByText('14/08/2026 – 15/08/2026')).toBeInTheDocument()
  })
})

// A trip claim skips a booking whose participant has no NDIS number. It says who, and why, as a shift claim does.
describe('GenerateClaimModal — who the claim leaves out', () => {
  const noNumber = { participantId: 'p-2', description: 'Lee Left', reason: 'NDIS number missing. Add it to their profile, then preview the claim again to include them.' }
  const selfFunded = { participantId: 'p-3', description: 'Sam Self', reason: 'Funded another way, so not claimed to the NDIS. Invoice them directly.' }

  async function openPreview() {
    const user = userEvent.setup()
    render(<GenerateClaimModal tripId="t1" trip={trip} onClose={() => {}} onSuccess={() => {}} />)
    await user.click(screen.getByRole('button', { name: /Preview Claim/ }))
  }

  it('lists each participant left out with the reason, one reason each', async () => {
    shown.leftOut = [noNumber, selfFunded]
    await openPreview()

    expect(screen.getByText('2 participants will be left out of this claim')).toBeInTheDocument()
    expect(screen.getByText(/Lee Left/)).toBeInTheDocument()
    expect(screen.getByText(/Add it to their profile, then preview the claim again to include them\./)).toBeInTheDocument()
    expect(screen.getByText(/Sam Self/)).toBeInTheDocument()
    expect(screen.getByText(/Invoice them directly./)).toBeInTheDocument()
    expect(screen.getByText("Their bookings stay confirmed. Nothing here is billed for them.")).toBeInTheDocument()
  })

  it('says it in the singular for one participant', async () => {
    shown.leftOut = [noNumber]
    await openPreview()

    expect(screen.getByText('1 participant will be left out of this claim')).toBeInTheDocument()
  })

  it('says nothing when nobody is left out', async () => {
    await openPreview()
    expect(screen.queryByText(/left out of this claim/)).not.toBeInTheDocument()
  })

  it('says nothing when the server sends no leftOut at all', async () => {
    shown.leftOut = undefined as never
    await openPreview()

    expect(screen.queryByText(/left out of this claim/)).not.toBeInTheDocument()
  })
})
