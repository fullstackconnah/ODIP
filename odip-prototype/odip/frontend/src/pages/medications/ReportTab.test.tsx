import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReportTab from './ReportTab'

const { mockUseAdministrationsReport, mockUseParticipants } = vi.hoisted(() => ({
  mockUseAdministrationsReport: vi.fn(),
  mockUseParticipants: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAdministrationsReport: mockUseAdministrationsReport,
  useParticipants: mockUseParticipants,
}))

function administration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    participantMedicationId: 'm1',
    participantId: 'p1',
    participantName: 'Jamie Smith',
    medicationName: 'Paracetamol',
    doseDescription: '2 tablets',
    tripInstanceId: null,
    scheduledAt: null,
    administeredAt: '2026-08-20T08:00:00Z',
    administeredAtTimeZone: null,
    status: 'Administered',
    doseGiven: '2 tablets',
    recordedByName: 'Alex Rivera',
    recordedByUserId: null,
    witnessName: null,
    witnessStaffId: null,
    witnessStatus: 'NotRequired',
    witnessRequestedAt: null,
    witnessRespondedAt: null,
    reason: null,
    prnReason: 'Headache',
    prnOutcome: null,
    prnOutcomeAt: null,
    limitBreachAcknowledged: false,
    notes: null,
    createdAt: '2026-08-20T08:00:00Z',
    incidentId: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockUseParticipants.mockReturnValue({
    data: [
      { id: 'p1', fullName: 'Jamie Smith' },
      { id: 'p2', fullName: 'Harrison Lee' },
    ],
  })
})

describe('ReportTab', () => {
  it('renders administrations in the order returned by the API (most recent first)', () => {
    mockUseAdministrationsReport.mockReturnValue({
      data: {
        items: [
          administration({ id: 'a1', medicationName: 'Paracetamol', administeredAt: '2026-08-20T08:00:00Z' }),
          administration({ id: 'a2', medicationName: 'Ibuprofen', administeredAt: '2026-08-19T08:00:00Z' }),
        ],
        totalCount: 2, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false,
      },
      isLoading: false,
    })
    render(<ReportTab />)

    const rows = screen.getAllByRole('row').slice(1) // skip header row
    expect(within(rows[0]).getByText('Paracetamol')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Ibuprofen')).toBeInTheDocument()
  })

  it('shows an empty state when there are no administrations', () => {
    mockUseAdministrationsReport.mockReturnValue({
      data: { items: [], totalCount: 0, page: 1, pageSize: 200, totalPages: 0, hasNext: false, hasPrevious: false },
      isLoading: false,
    })
    render(<ReportTab />)

    expect(screen.getByText(/no administrations found/i)).toBeInTheDocument()
  })

  it('re-queries scoped to the selected participant when the filter changes', async () => {
    const user = userEvent.setup()
    mockUseAdministrationsReport.mockReturnValue({
      data: { items: [administration()], totalCount: 1, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false },
      isLoading: false,
    })
    render(<ReportTab />)

    // Scoped by label association — the table's own "Participant" column header button
    // otherwise collides with the filter trigger's <label for>-derived accessible name.
    await user.click(screen.getByLabelText('Participant'))
    await user.click(screen.getByRole('option', { name: 'Harrison Lee' }))

    const lastCallArgs = mockUseAdministrationsReport.mock.calls.at(-1)![0]
    expect(lastCallArgs.participantId).toBe('p2')
  })

  it('applies a from-date filter to the report query', async () => {
    const user = userEvent.setup()
    mockUseAdministrationsReport.mockReturnValue({
      data: { items: [administration()], totalCount: 1, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false },
      isLoading: false,
    })
    render(<ReportTab />)

    await user.type(screen.getByLabelText('From'), '2026-08-01')

    const lastCallArgs = mockUseAdministrationsReport.mock.calls.at(-1)![0]
    expect(lastCallArgs.from).toBe('2026-08-01')
  })
})
