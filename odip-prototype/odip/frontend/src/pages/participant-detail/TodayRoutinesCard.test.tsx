import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TodayRoutinesCard } from './TodayRoutinesCard'
import type { ParticipantRoutineDto } from '@/api/types/routines'

// Overview's "Today's routines": the active routines that run on today's weekday, critical first, then by time. It reuses the tab-count query,
// so it asks the server for nothing new.

const { useParticipantRoutines } = vi.hoisted(() => ({ useParticipantRoutines: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useParticipantRoutines }))

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function routine(overrides: Partial<ParticipantRoutineDto> = {}): ParticipantRoutineDto {
  return {
    id: 'r', participantId: 'p1', title: 'Morning routine', description: '', category: 'PersonalCare', days: ALL_DAYS,
    startTime: null, endTime: null, isCritical: false, isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}
const reply = (data: ParticipantRoutineDto[]) => ({ data, isLoading: false, isError: false, refetch: vi.fn() })
const renderCard = () => render(<MemoryRouter><TodayRoutinesCard participantId="p1" /></MemoryRouter>)
const asRole = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role }))

beforeEach(() => {
  vi.clearAllMocks()
  asRole('Coordinator')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0)) // a Wednesday
  useParticipantRoutines.mockReturnValue(reply([]))
})
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

describe('Today’s routines card', () => {
  it('lists only the active routines that run today: critical first, then by time, untimed last', () => {
    useParticipantRoutines.mockReturnValue(reply([
      routine({ id: 'a', title: 'Untimed task' }),
      routine({ id: 'b', title: 'Late task', startTime: '17:00:00', endTime: '18:00:00' }),
      routine({ id: 'c', title: 'Medication check', isCritical: true, startTime: '12:00:00' }),
      routine({ id: 'd', title: 'Early task', startTime: '07:00:00', endTime: '08:30:00' }),
      routine({ id: 'e', title: 'Monday only', days: ['Monday'] }),
      routine({ id: 'f', title: 'Stopped', isActive: false }),
    ]))
    renderCard()

    const rows = within(screen.getByRole('region', { name: 'Today’s routines' })).getAllByRole('listitem')
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringContaining('Medication check'),
      expect.stringContaining('Early task'),
      expect.stringContaining('Late task'),
      expect.stringContaining('Untimed task'),
    ])
    expect(rows[0]).toHaveTextContent('Critical')
    expect(rows[1]).toHaveTextContent(/7am.8:30am/)
  })

  it('shows 5 rows and says how many more there are', () => {
    useParticipantRoutines.mockReturnValue(reply(Array.from({ length: 7 }, (_, i) => routine({ id: `r${i}`, title: `Task ${i}`, startTime: `0${i + 1}:00:00` }))))
    renderCard()

    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('and 2 more today')).toBeInTheDocument()
  })

  it('says none today and counts the routines on other days', () => {
    useParticipantRoutines.mockReturnValue(reply([routine({ days: ['Monday'] })]))
    renderCard()

    expect(screen.getByText('None today. 1 routine on other days.')).toBeInTheDocument()
  })

  it('says no routines are recorded when there are none', () => {
    renderCard()

    expect(screen.getByText('No routines recorded yet.')).toBeInTheDocument()
  })

  it('offers Try again on an error, and asks again', async () => {
    const refetch = vi.fn()
    useParticipantRoutines.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    renderCard()

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('links to the Routines card: "Edit in" for a writer, "See" for a reader', () => {
    const { unmount } = renderCard()
    expect(screen.getByRole('link', { name: 'Edit in Routines' })).toHaveAttribute('href', '/?tab=daily#routines')
    unmount()

    asRole('ReadOnly')
    renderCard()
    expect(screen.getByRole('link', { name: 'See Routines' })).toHaveAttribute('href', '/?tab=daily#routines')
  })
})
