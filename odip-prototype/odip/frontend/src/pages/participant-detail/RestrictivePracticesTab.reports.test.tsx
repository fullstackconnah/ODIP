import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RestrictivePracticesTab from './RestrictivePracticesTab'
import type { RestrictivePracticeDto } from '@/api/types/restrictive-practices'

const { mockUseRestrictivePractices, mockUseRpLines, mockUpdate } = vi.hoisted(() => ({
  mockUseRestrictivePractices: vi.fn(),
  mockUseRpLines: vi.fn(),
  mockUpdate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useProviderSettings: () => ({ data: undefined }),
  useRestrictivePractices: mockUseRestrictivePractices,
  useParticipantMedications: () => ({ data: [], isLoading: false }),
  useRpMonthlyReportLines: mockUseRpLines,
  useLodgeRpReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUndoRpReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRestrictivePractice: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeleteRestrictivePractice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBulkCreateRestrictivePractices: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useProviderToday', () => ({ useProviderToday: () => '2026-11-04' }))

function practice(): RestrictivePracticeDto {
  return {
    id: 'rp-1', participantId: 'participant-1', type: 'PhysicalRestraint', description: 'Hands-on guiding', authorisedBy: 'Dr Lee', authorisationDate: '2026-03-01',
    reviewDate: null, relatedMedicationId: null, relatedMedicationName: null, isActive: true, isAuthorised: true, useKind: 'Routine', authorisationEndDate: null,
    firstUsedOn: null, interimBspDate: null, comprehensiveBspDate: null, earliestRecordedUseDate: null, interimBspDueOn: null, comprehensiveBspDueOn: null,
    interimBspState: 'NotStarted', comprehensiveBspState: 'NotStarted', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  } as RestrictivePracticeDto
}

const line = (o: Record<string, unknown> = {}) => ({
  restrictivePracticeId: 'rp-1', participantId: 'participant-1', participantName: 'Alex Demo', practiceType: 'PhysicalRestraint', practiceDescription: 'x', useKind: 'Routine',
  month: '2026-10-01', dueOn: '2026-11-06', dueCountedWithoutHolidays: false, state: 'Due', suggestedType: null, uses: [], report: null, ...o,
})
const withLines = (lines: unknown[]) => mockUseRpLines.mockReturnValue({ data: lines, isLoading: false, refetch: vi.fn() })

beforeEach(() => {
  mockUpdate.mockReset()
  mockUseRestrictivePractices.mockReturnValue({ data: [practice()], isLoading: false })
  withLines([])
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
})
afterEach(() => localStorage.clear())

describe('RestrictivePracticesTab: monthly report chips', () => {
  it('asks for the participant\'s lines once, only for a role that can lodge them', () => {
    render(<RestrictivePracticesTab participantId="participant-1" />)
    expect(mockUseRpLines).toHaveBeenCalledWith('participant-1', { enabled: true })
  })

  it('does not enable the request for a read-only role, and shows no chip', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    withLines([line()])
    render(<RestrictivePracticesTab participantId="participant-1" />)
    expect(mockUseRpLines).toHaveBeenCalledWith('participant-1', { enabled: false })
  })

  it('shows a Due chip with the due date, and opens the lodge dialog on it', async () => {
    const user = userEvent.setup()
    withLines([line()])
    render(<RestrictivePracticesTab participantId="participant-1" />)
    expect(screen.getByText('Monthly report due 06/11/2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lodge the October 2026 monthly report' }))
    expect(screen.getByText('Lodge monthly report')).toBeInTheDocument()
  })

  it('counts overdue months in the chip and opens on the oldest', async () => {
    const user = userEvent.setup()
    withLines([line({ month: '2026-09-01', dueOn: '2026-10-06', state: 'Overdue' }), line({ month: '2026-08-01', dueOn: '2026-09-04', state: 'Overdue' }), line()])
    render(<RestrictivePracticesTab participantId="participant-1" />)
    expect(screen.getByText('2 monthly reports overdue')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lodge the August 2026 monthly report' }))
    expect(screen.getByText(/Alex Demo · Physical restraint · August 2026/)).toBeInTheDocument()
  })

  it('shows no chip once every month is lodged', () => {
    withLines([line({ state: 'Lodged', report: { id: 'r' } })])
    render(<RestrictivePracticesTab participantId="participant-1" />)
    expect(screen.queryByText(/Monthly report/)).not.toBeInTheDocument()
  })
})

describe('RestrictivePracticesTab: the deactivate prompt', () => {
  async function deactivate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByLabelText('Active'))
    await user.click(screen.getByRole('button', { name: /save entry/i }))
  }

  it('asks whether it was eliminated before saving a deactivation that leaves months owed', async () => {
    const user = userEvent.setup()
    withLines([line({ month: '2026-09-01', state: 'Overdue' }), line()])
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await deactivate(user)
    expect(screen.getByText('Was this practice eliminated?')).toBeInTheDocument()
    expect(screen.getByText(/Eliminated report for October 2026.* 2 months are still to lodge for this entry\./)).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('Deactivate only goes on with the save', async () => {
    const user = userEvent.setup()
    withLines([line()])
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await deactivate(user)
    await user.click(screen.getByRole('button', { name: 'Deactivate only' }))
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls[0][0].data.isActive).toBe(false)
  })

  it('Back keeps the edit open without saving', async () => {
    const user = userEvent.setup()
    withLines([line()])
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await deactivate(user)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByText('Was this practice eliminated?')).not.toBeInTheDocument()
    expect(screen.getByText('Edit restrictive practice entry')).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('Lodge a report closes the edit without saving and opens the lodge dialog on the newest month as Eliminated', async () => {
    const user = userEvent.setup()
    withLines([line({ month: '2026-09-01', state: 'Overdue' }), line()])
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await deactivate(user)
    await user.click(screen.getByRole('button', { name: 'Lodge a report' }))
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(screen.queryByText('Edit restrictive practice entry')).not.toBeInTheDocument()
    expect(screen.getByText(/Alex Demo · Physical restraint · October 2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Report type/ })).toHaveTextContent('Eliminated')
  })

  it('saves a deactivation straight away when no month is owed', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await deactivate(user)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })
})
