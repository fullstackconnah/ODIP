import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IncidentReviewCard } from './IncidentReviewCard'
import type { IncidentDetailDto } from '@/api/types/incidents'

const { mockHistory, mockSave, saveState } = vi.hoisted(() => ({
  mockHistory: vi.fn(),
  mockSave: vi.fn(),
  saveState: { isPending: false, isError: false },
}))

vi.mock('@/api/hooks', () => ({
  useIncidentStatusHistory: mockHistory,
  useRecordIncidentReview: () => ({ mutate: mockSave, reset: vi.fn(), ...saveState }),
}))

const incident = (over: Partial<IncidentDetailDto> = {}) => ({
  id: 'inc-1', status: 'UnderReview', timeZoneId: 'Australia/Sydney',
  reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null,
  ...over,
}) as IncidentDetailDto

const reviewed = incident({
  status: 'Closed', reviewedByName: 'Callum Radford', reviewedAt: '2026-07-14T09:00:00Z',
  reviewNotes: 'No further action.', correctiveActions: 'Added a wet-weather route.',
})

beforeEach(() => {
  mockSave.mockReset()
  saveState.isPending = false
  saveState.isError = false
  mockHistory.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
})

describe('IncidentReviewCard', () => {
  it('Admin, not reviewed: empty state and a Record review button', () => {
    render(<IncidentReviewCard incident={incident()} canEdit />)
    expect(screen.getByText('Not reviewed yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record review' })).toBeInTheDocument()
  })

  it('Coordinator, reviewed: shows the review read-only, with no edit button', () => {
    render(<IncidentReviewCard incident={reviewed} canEdit={false} />)
    expect(screen.getByText('Callum Radford')).toBeInTheDocument()
    expect(screen.getByText('No further action.')).toBeInTheDocument()
    expect(screen.getByText('Added a wet-weather route.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull()
  })

  it('Admin save sends trimmed notes and the chosen status, with no reviewer or date', async () => {
    const user = userEvent.setup()
    render(<IncidentReviewCard incident={incident()} canEdit />)
    await user.click(screen.getByRole('button', { name: 'Record review' }))
    await user.type(screen.getByLabelText(/Review notes/), '  Looked into it.  ')
    await user.selectOptions(screen.getByLabelText('Status'), 'Resolved')
    await user.click(screen.getByRole('button', { name: 'Save review' }))
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSave.mock.calls[0][0]).toEqual({
      id: 'inc-1', data: { reviewNotes: 'Looked into it.', correctiveActions: undefined, status: 'Resolved' },
    })
  })

  it('blocks a save with blank notes and says why', async () => {
    const user = userEvent.setup()
    render(<IncidentReviewCard incident={incident()} canEdit />)
    await user.click(screen.getByRole('button', { name: 'Record review' }))
    await user.click(screen.getByRole('button', { name: 'Save review' }))
    expect(mockSave).not.toHaveBeenCalled()
    expect(screen.getByText('Add review notes.')).toBeInTheDocument()
  })

  it('a failed save shows an alert and keeps the typed notes', async () => {
    saveState.isError = true
    const user = userEvent.setup()
    render(<IncidentReviewCard incident={reviewed} canEdit />)
    await user.click(screen.getByRole('button', { name: 'Update review' }))
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save the review. Try again.")
    expect(screen.getByLabelText(/Review notes/)).toHaveValue('No further action.')
  })

  it('shows status changes newest first, with the first row as Reported as', () => {
    mockHistory.mockReturnValue({
      isLoading: false, isError: false, refetch: vi.fn(),
      data: [
        { at: '2026-07-14T09:00:00Z', byName: 'Callum Radford', from: 'UnderReview', to: 'Closed' },
        { at: '2026-07-11T21:05:00Z', byName: 'Mei Zhang', from: null, to: 'Draft' },
      ],
    })
    render(<IncidentReviewCard incident={reviewed} canEdit={false} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Callum Radford')
    expect(rows[1]).toHaveTextContent('Reported as')
  })

  it('history states: loading, empty, error with retry', async () => {
    const refetch = vi.fn()
    mockHistory.mockReturnValue({ isLoading: true, isError: false, refetch })
    const { rerender } = render(<IncidentReviewCard incident={reviewed} canEdit={false} />)
    expect(screen.getByText('Loading status history...')).toBeInTheDocument()
    mockHistory.mockReturnValue({ data: [], isLoading: false, isError: false, refetch })
    rerender(<IncidentReviewCard incident={reviewed} canEdit={false} />)
    expect(screen.getByText('No status changes yet.')).toBeInTheDocument()
    mockHistory.mockReturnValue({ isLoading: false, isError: true, refetch })
    rerender(<IncidentReviewCard incident={reviewed} canEdit={false} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })
})

describe('IncidentReviewCard — the parent controls editing', () => {
  it('opens and closes from the editing prop, asks the parent when Record review is pressed, and reports changes', async () => {
    const user = userEvent.setup()
    const onEditingChange = vi.fn()
    const onDirtyChange = vi.fn()
    const { rerender } = render(<IncidentReviewCard incident={incident()} canEdit editing={false} onEditingChange={onEditingChange} onDirtyChange={onDirtyChange} />)

    // The button asks; it is the parent that opens the form.
    await user.click(screen.getByRole('button', { name: 'Record review' }))
    expect(onEditingChange).toHaveBeenCalledWith(true)
    expect(screen.queryByLabelText(/Review notes/)).not.toBeInTheDocument()

    rerender(<IncidentReviewCard incident={incident()} canEdit editing onEditingChange={onEditingChange} onDirtyChange={onDirtyChange} />)
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    await user.type(screen.getByLabelText(/Review notes/), 'Looked into it.')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    rerender(<IncidentReviewCard incident={incident()} canEdit editing={false} onEditingChange={onEditingChange} onDirtyChange={onDirtyChange} />)
    expect(screen.queryByLabelText(/Review notes/)).not.toBeInTheDocument()
  })
})
