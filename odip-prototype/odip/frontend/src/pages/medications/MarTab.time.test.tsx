import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MarTab from './MarTab'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseMar, mockProviderToday } = vi.hoisted(() => ({ mockUseMar: vi.fn(), mockProviderToday: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useMar: mockUseMar,
  useProviderTodayQuery: () => mockProviderToday(),
  useParticipants: () => ({ data: [] }),
  useRecordPrnOutcome: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canRecordAdministrations: true, canManageMedications: true, canCreateIncidents: true }),
}))
vi.mock('./RecordAdministrationModal', () => ({ RecordAdministrationModal: () => null }))
vi.mock('./MissedMedicationGuidance', () => ({ MissedMedicationGuidance: () => null }))

beforeEach(() => { mockProviderToday.mockReturnValue({ data: undefined }) })
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

// OD-ZONE2 (H110-2). The record opens on the PROVIDER's day, and "Today" returns to it, not the device's. A Sydney device just past midnight
// (2026-10-04) with a Perth provider (still 2026-10-03). Until provider-today answers (or if it never does) the device day stands.
describe('MarTab day against the provider’s calendar', () => {
  const shownDay = () => (screen.getByLabelText('Select date') as HTMLInputElement).value
  const requestedDay = () => mockUseMar.mock.lastCall![0]
  const open = () => {
    if (!setZone('Australia/Sydney')) return false
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T14:30:00Z')) // 04/10 00:30 Sydney, 03/10 22:30 Perth
    mockUseMar.mockReturnValue({ data: { entries: [], prnMedications: [] }, isLoading: false })
    return true
  }
  const ui = () => <MemoryRouter><MarTab /></MemoryRouter> // a new element each call, so rerender really re-renders

  it('opens on the provider day, requests it, and Today returns to it', () => {
    if (!open()) return
    mockProviderToday.mockReturnValue({ data: { date: '2026-10-03' } })
    render(ui())
    expect(shownDay()).toBe('2026-10-03')
    expect(requestedDay()).toBe('2026-10-03')
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    expect(shownDay()).toBe('2026-10-04')
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(shownDay()).toBe('2026-10-03')
  })

  it('stays on the device day while provider-today has not answered, or failed', () => {
    if (!open()) return
    render(ui())
    expect(shownDay()).toBe('2026-10-04')
    expect(requestedDay()).toBe('2026-10-04')
  })

  it('moves to the provider day when it answers late and nothing was picked', () => {
    if (!open()) return
    const { rerender } = render(ui())
    expect(shownDay()).toBe('2026-10-04')
    mockProviderToday.mockReturnValue({ data: { date: '2026-10-03' } })
    rerender(ui())
    expect(shownDay()).toBe('2026-10-03')
  })

  it('keeps a picked day when provider-today answers late', () => {
    if (!open()) return
    const { rerender } = render(ui())
    fireEvent.change(screen.getByLabelText('Select date'), { target: { value: '2026-10-10' } })
    mockProviderToday.mockReturnValue({ data: { date: '2026-10-03' } })
    rerender(ui())
    expect(shownDay()).toBe('2026-10-10')
    expect(requestedDay()).toBe('2026-10-10')
  })
})
