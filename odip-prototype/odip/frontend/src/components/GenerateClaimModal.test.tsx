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

vi.mock('@/api/hooks', () => ({
  usePreviewClaim: () => ({ mutate: (_: unknown, o: { onSuccess: (d: ClaimPreviewResponseDto) => void }) => o.onSuccess(preview), isPending: false }),
  useGenerateClaim: () => ({ mutate: vi.fn(), isPending: false }),
}))

const trip = { id: 't1', tripName: 'Byron Bay', startDate: '2026-08-14', endDate: '2026-08-17' } as TripDetailDto

afterEach(() => restoreZone())

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
