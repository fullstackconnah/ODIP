import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { IntakeVisitsSection } from './IntakeVisitsSection'

const mocks = vi.hoisted(() => ({ visits: vi.fn(), refetch: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useIntakeVisits: mocks.visits,
  useConvertParticipantInquiry: () => ({ mutate: vi.fn(), isPending: false }),
}))

const visit = (inquiryId: string, startsAt: string, overrides = {}) => ({
  inquiryId, firstName: 'Noah', lastName: inquiryId, participantId: null, participantIsDraft: null, participantIntakeCompletedAt: null,
  startsAt, durationMinutes: 90, location: '12 Smith St, Parramatta', staffUserId: 'sam', staffName: 'Sam Lee', confirmedAt: null,
  timeZoneId: 'Australia/Sydney', ...overrides,
})
const section = () => render(<MemoryRouter><IntakeVisitsSection /></MemoryRouter>)

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator', id: 'dana' })) // Start intake shows only to the lifecycle roles
  mocks.refetch.mockReset()
})

describe('IntakeVisitsSection', () => {
  it('lists every upcoming visit, dated, for all staff, with the reply and Start intake', () => {
    mocks.visits.mockReturnValue({ data: [visit('Future', '2030-10-15T23:00:00Z', { confirmedAt: '2030-10-01T00:00:00Z' }), visit('Gone', '2026-01-05T23:00:00Z')], isLoading: false, isError: false, refetch: mocks.refetch })
    section()

    expect(mocks.visits).toHaveBeenCalledWith({})
    expect(screen.getByRole('heading', { level: 2, name: 'Intake visits' })).toBeInTheDocument()
    expect(screen.getByText('Noah Future')).toBeInTheDocument()
    expect(screen.queryByText('Noah Gone')).not.toBeInTheDocument() // ended: not upcoming
    expect(screen.getByText(/^Wed 16 Oct, 10:00 – 11:30 am$/)).toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start intake for Noah Future' })).toBeInTheDocument()
  })

  it('draws nothing while loading or when nothing is upcoming', () => {
    mocks.visits.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: mocks.refetch })
    const { container, rerender } = section()
    expect(container).toBeEmptyDOMElement()

    mocks.visits.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mocks.refetch })
    rerender(<MemoryRouter><IntakeVisitsSection /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })

  it('says the visits could not load, with Try again', async () => {
    const user = userEvent.setup()
    mocks.visits.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mocks.refetch })
    section()

    expect(screen.getByText("Couldn't load intake visits.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.refetch).toHaveBeenCalled()
  })
})
