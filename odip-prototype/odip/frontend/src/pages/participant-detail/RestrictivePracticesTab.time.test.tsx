import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RestrictivePracticesTab from './RestrictivePracticesTab'
import type { RestrictivePracticeDto } from '@/api/types/restrictive-practices'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseRestrictivePractices } = vi.hoisted(() => ({ mockUseRestrictivePractices: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useRestrictivePractices: mockUseRestrictivePractices,
  useParticipantMedications: () => ({ data: [], isLoading: false }),
  useUpdateRestrictivePractice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRestrictivePractice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBulkCreateRestrictivePractices: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

afterEach(() => {
  vi.useRealTimers()
  restoreZone()
  vi.clearAllMocks()
})

function practice(reviewDate: string): RestrictivePracticeDto {
  return {
    id: 'rp-1', participantId: 'participant-1', type: 'Unclassified', description: 'Locked doors overnight for safety.',
    authorisedBy: null, authorisationDate: null, reviewDate, relatedMedicationId: null, relatedMedicationName: null,
    isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  } as RestrictivePracticeDto
}

// L4-04. ReviewDate is a DateOnly. A review due today is "Review due", never "Review overdue" until the day after (the server's own rule,
// ParticipantAlertsService, is the same: ReviewDate < today).
describe('RestrictivePracticesTab review badge on the due day (Sydney)', () => {
  it.each([
    ['Sat 3 Oct 10:30, when the old check flipped', '2026-10-03T00:30:00Z', 'Review due 03/10/2026'],
    ['Sat 3 Oct 23:30, the end of the due day', '2026-10-03T13:30:00Z', 'Review due 03/10/2026'],
    ['Sun 4 Oct 00:30, the day after', '2026-10-03T14:30:00Z', 'Review overdue 03/10/2026'],
  ])('%s reads %s', (_label, now, expected) => {
    if (!setZone('Australia/Sydney')) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    mockUseRestrictivePractices.mockReturnValue({ data: [practice('2026-10-03')], isLoading: false })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})
