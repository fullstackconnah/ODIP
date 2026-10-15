import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PortalShiftsPage from './PortalShiftsPage'

const mocks = vi.hoisted(() => ({ shifts: vi.fn(), visits: vi.fn(), convert: vi.fn(), refetchVisits: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useMyShifts: mocks.shifts,
  usePendingWitnessRequests: () => ({ data: [] }),
  useIntakeVisits: mocks.visits,
  useConvertParticipantInquiry: () => ({ mutate: mocks.convert, isPending: false }),
}))

const shift = (id: string, startTime: string) => ({
  id, participantId: 'p1', participantName: `Shift ${id}`, serviceDate: '2026-10-16', startTime, endTime: '15:00:00', endsNextDay: false,
  durationHours: 3, ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null,
})
// Fri 16 Oct 2026, 10:00 am in Sydney.
const visit = {
  inquiryId: 'inq-1', firstName: 'Noah', lastName: 'Fitzgerald', participantId: null, participantIsDraft: null, participantIntakeCompletedAt: null,
  startsAt: '2026-10-15T23:00:00Z', durationMinutes: 90, location: '12 Smith St, Parramatta', staffUserId: 'dana', staffName: 'Dana Smith',
  confirmedAt: null, timeZoneId: 'Australia/Sydney',
}

function page() {
  render(
    <MemoryRouter initialEntries={['/portal']}>
      <Routes>
        <Route path="/portal" element={<PortalShiftsPage />} />
        <Route path="/participants/:id/intake" element={<p>Intake wizard</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T01:00:00Z')) // Wed 14 Oct: the week is Mon 12 to Sun 18 Oct
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator', id: 'dana' }))
  mocks.shifts.mockReturnValue({ data: { shifts: [shift('a', '09:00:00'), shift('b', '13:00:00')], tripAssignments: [] }, isLoading: false, isError: false, refetch: vi.fn() })
  mocks.visits.mockReturnValue({ data: [visit], isLoading: false, isError: false, refetch: mocks.refetchVisits })
  mocks.convert.mockReset()
  mocks.refetchVisits.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('My shifts: intake visits', () => {
  it('asks for your own visits in the browsed week', () => {
    page()
    expect(mocks.visits).toHaveBeenCalledWith({ from: '2026-10-12', to: '2026-10-18', staffUserId: 'dana' }, true)
  })

  it('puts the visit among that day\'s shifts by start time, as a card that is not a link', () => {
    page()

    expect(screen.getAllByText(/^(Shift a|Noah Fitzgerald|Shift b)$/).map(n => n.textContent)).toEqual(['Shift a', 'Noah Fitzgerald', 'Shift b'])
    expect(screen.getByText('Intake visit')).toBeInTheDocument()
    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
    expect(screen.getByText('10:00 am – 11:30 am · 12 Smith St, Parramatta')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Noah Fitzgerald/ })).not.toBeInTheDocument()
  })

  it('starts the intake from the card: converts the enquiry and opens the intake form', async () => {
    const user = userEvent.setup()
    mocks.convert.mockImplementation((_data: unknown, options: { onSuccess: (value: unknown) => void }) => options.onSuccess({ participantId: 'p-new' }))
    page()

    await user.click(screen.getByRole('button', { name: 'Start intake for Noah Fitzgerald' }))

    expect(mocks.convert).toHaveBeenCalledWith({ id: 'inq-1' }, expect.any(Object))
    expect(screen.getByText('Intake wizard')).toBeInTheDocument()
  })

  it('still shows the shifts when the visits cannot load, with a way to try again', async () => {
    const user = userEvent.setup()
    mocks.visits.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mocks.refetchVisits })
    page()

    expect(screen.getByText('Shift a')).toBeInTheDocument()
    expect(screen.getByText("Couldn't load your intake visits.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.refetchVisits).toHaveBeenCalled()
  })

  it('says nothing is rostered only when shifts, trips and visits are all empty', () => {
    mocks.shifts.mockReturnValue({ data: { shifts: [], tripAssignments: [] }, isLoading: false, isError: false, refetch: vi.fn() })
    page()
    expect(screen.queryByText('Nothing rostered this week')).not.toBeInTheDocument()
  })

  // Moved to support worker after the booking: the visit stays on their list, but converting and the intake form are not theirs to open.
  it('shows a support worker their visit without Start intake', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker', id: 'dana' }))
    page()

    expect(screen.getByText('Noah Fitzgerald')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /intake for Noah Fitzgerald/ })).not.toBeInTheDocument()
  })
})
