import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MarTab from './MarTab'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseMar } = vi.hoisted(() => ({ mockUseMar: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useMar: mockUseMar,
  useParticipants: () => ({ data: [] }),
  useRecordPrnOutcome: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canRecordAdministrations: true, canManageMedications: true, canCreateIncidents: true }),
}))
vi.mock('./RecordAdministrationModal', () => ({ RecordAdministrationModal: () => null }))
vi.mock('./MissedMedicationGuidance', () => ({ MissedMedicationGuidance: () => null }))

afterEach(() => {
  vi.useRealTimers()
  restoreZone()
  vi.clearAllMocks()
})

function prn(lastDoseAt: string | null) {
  return {
    medicationId: 'med-2', participantId: 'participant-2', participantName: 'Noah Blake', name: 'Ibuprofen', strength: '200mg',
    doseDescription: '1 tablet', prnIndication: 'Pain', prnMaxDosesPer24h: 4, prnMinIntervalMinutes: 240, packaging: 'OriginalPackaging',
    pharmacyName: null, pharmacyPhone: null, dosesInLast24h: 1, lastDoseAt, outcomePendingAdministrationId: null,
  }
}

// L4-01. A support worker gives a PRN dose at 15:10 Sydney; at 15:30 the card must say "20 min ago", not "10 hrs ago". The API sent the
// instant zone-less ("...T05:10:00.1234567"), which a Sydney browser read as 05:10 local. It now sends the Z; the card must be right
// for both, and in every zone.
describe.each(['Australia/Sydney', 'UTC'])('MarTab PRN "Last dose" in %s', zone => {
  it.each([
    ['the instant with Z (what the API sends now)', '2026-10-03T05:10:00.1234567Z'],
    ['the instant zone-less (the old wire shape)', '2026-10-03T05:10:00.1234567'],
  ])('reads %s as 20 minutes ago', (_label, lastDoseAt) => {
    if (!setZone(zone)) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T05:30:30Z'))
    mockUseMar.mockReturnValue({ data: { entries: [], prnMedications: [prn(lastDoseAt)] }, isLoading: false })

    render(<MemoryRouter><MarTab /></MemoryRouter>)

    expect(screen.getByText('Last dose 20 min ago')).toBeInTheDocument()
  })
})
