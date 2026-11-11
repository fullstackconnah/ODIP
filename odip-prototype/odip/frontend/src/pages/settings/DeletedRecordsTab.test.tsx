import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DeletedRecordsTab from './DeletedRecordsTab'
import type { DeletedRecord } from '@/api/hooks'

const { mockUseDeletedRecords } = vi.hoisted(() => ({ mockUseDeletedRecords: vi.fn() }))
vi.mock('@/api/hooks', async importOriginal => ({ ...(await importOriginal<typeof import('@/api/hooks')>()), useDeletedRecords: mockUseDeletedRecords }))

const row = (o: Partial<DeletedRecord> = {}): DeletedRecord => ({
  id: 'd1', entityType: 'Shift', entityId: 'e1', deletedAt: '2026-11-10T03:15:00Z', deletedByName: 'Sam Lee',
  fields: [{ field: 'ServiceDate', old: '2026-11-10', new: null }, { field: 'ParticipantId', old: 'p-1', new: null }], ...o,
})
const result = (items: DeletedRecord[], totalCount = items.length) => ({ data: { items, totalCount, page: 1, pageSize: 25 }, isLoading: false, isError: false, refetch: vi.fn() })
const show = () => render(<MemoryRouter><DeletedRecordsTab /></MemoryRouter>)

vi.mock('@/components/AuditHistoryTab', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/AuditHistoryTab')>()),
  default: ({ entityType, entityId }: { entityType: string; entityId: string }) => <p>History of {entityType} {entityId}</p>,
}))

beforeEach(() => mockUseDeletedRecords.mockReset())

describe('DeletedRecordsTab', () => {
  it('lists each deletion with its label, type, who and when', () => {
    mockUseDeletedRecords.mockReturnValue(result([row(), row({ id: 'd2', entityType: 'ParticipantRiskEntry', deletedByName: null, fields: [{ field: 'Description', old: 'Choking risk', new: null }] })]))
    show()
    expect(screen.getAllByText(/Tue 10 Nov 2026/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Choking risk').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Risk entry').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sam Lee').length).toBeGreaterThan(0)
    expect(screen.getAllByText('System').length).toBeGreaterThan(0) // no actor recorded
    expect(screen.getAllByText(/^10\/11\/2026/).length).toBeGreaterThan(0)
  })

  it('opens one row at a time to what it held, with a way to its participant', async () => {
    mockUseDeletedRecords.mockReturnValue(result([row(), row({ id: 'd2', fields: [{ field: 'ServiceDate', old: '2026-11-11', new: null }] })]))
    show()
    const [open] = screen.getAllByRole('button', { name: /^Show details for Tue 10 Nov 2026/ })
    expect(open).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(open)
    expect(screen.getAllByRole('button', { name: /^Hide details for Tue 10 Nov 2026/ }).length).toBeGreaterThan(0)
    const detail = document.getElementById('deleted-detail-d1')!
    expect(within(detail).getByText('What it held')).toBeInTheDocument()
    expect(within(detail).getByText('Date')).toBeInTheDocument()
    expect(within(detail).getByRole('link', { name: 'Open participant' })).toHaveAttribute('href', '/participants/p-1')

    await userEvent.click(screen.getAllByRole('button', { name: /^Show details for Wed 11 Nov 2026/ })[0])
    expect(document.getElementById('deleted-detail-d1')).toBeNull()
    expect(within(document.getElementById('deleted-detail-d2')!).queryByRole('link')).toBeNull() // no ParticipantId held
  })

  it('shows a change that has no field name instead of failing', async () => {
    mockUseDeletedRecords.mockReturnValue(result([row({ fields: [{ field: null, old: 'Kept note', new: null }] })]))
    show()
    await userEvent.click(screen.getAllByRole('button', { name: /^Show details for/ })[0])
    expect(within(document.getElementById('deleted-detail-d1')!).getByText('Kept note')).toBeInTheDocument()
  })

  it('offers the full history for a shift or pattern only, and shows it on request', async () => {
    mockUseDeletedRecords.mockReturnValue(result([row(), row({ id: 'd2', entityType: 'ShiftPattern', entityId: 'e2' }), row({ id: 'd3', entityType: 'ParticipantRiskEntry', fields: [{ field: 'Description', old: 'Choking risk', new: null }] })]))
    show()
    await userEvent.click(screen.getAllByRole('button', { name: /^Show details for/ })[0])
    expect(screen.queryByText(/^History of/)).toBeNull() // collapsed: nothing is fetched
    await userEvent.click(screen.getByRole('button', { name: 'Show full history' }))
    expect(screen.getByText('History of Shift e1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hide full history' }))
    expect(screen.queryByText(/^History of/)).toBeNull()

    await userEvent.click(screen.getAllByRole('button', { name: /^Show details for Choking risk/ })[0])
    expect(screen.queryByRole('button', { name: /full history/ })).toBeNull()
  })

  it('reads what it held in words and leaves out a bare id, keeping the way to the participant', async () => {
    const guid = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b'
    mockUseDeletedRecords.mockReturnValue(result([row({ fields: [
      { field: 'ServiceDate', old: '2026-11-10', new: null }, { field: 'StartTime', old: '09:00:00', new: null }, { field: 'ParticipantId', old: guid, new: null },
    ] })]))
    show()
    await userEvent.click(screen.getAllByRole('button', { name: /^Show details for Tue 10 Nov 2026/ })[0])
    const detail = document.getElementById('deleted-detail-d1')!
    expect(within(detail).getByText('Date')).toBeInTheDocument()
    expect(within(detail).getByText('Start')).toBeInTheDocument()
    expect(within(detail).queryByText(/ServiceDate|StartTime|ParticipantId/)).toBeNull()
    expect(detail.textContent).not.toContain(guid)
    expect(within(detail).getByRole('link', { name: 'Open participant' })).toHaveAttribute('href', `/participants/${guid}`)
  })

  it('says so when the only values kept were ids', async () => {
    mockUseDeletedRecords.mockReturnValue(result([row({ fields: [{ field: 'StaffId', old: '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b', new: null }] })]))
    show()
    await userEvent.click(screen.getAllByRole('button', { name: /^Show details for Shift/ })[0])
    expect(screen.getByText('No details were kept for this record.')).toBeInTheDocument()
  })

  it('says so when a record kept no values', async () => {
    mockUseDeletedRecords.mockReturnValue(result([row({ fields: [] })]))
    show()
    await userEvent.click(screen.getAllByRole('button', { name: /^Show details for Shift/ })[0])
    expect(screen.getByText('No details were kept for this record.')).toBeInTheDocument()
  })

  it('says nothing has been deleted, and a different line when a type is chosen', async () => {
    mockUseDeletedRecords.mockReturnValue(result([]))
    show()
    expect(screen.getByText('Nothing has been deleted since this list was added.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /types?$|All types/i }))
    await userEvent.click(screen.getByRole('option', { name: 'Routine' }))
    expect(mockUseDeletedRecords).toHaveBeenLastCalledWith('ParticipantRoutine', 1)
    expect(screen.getByText('Nothing of this type has been deleted.')).toBeInTheDocument()
  })

  it('pages the list and goes back to page 1 when the type changes', async () => {
    mockUseDeletedRecords.mockReturnValue(result([row()], 60))
    show()
    expect(screen.getByText(/showing 1-25 of 60/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(mockUseDeletedRecords).toHaveBeenLastCalledWith('', 2)
    await userEvent.click(screen.getByRole('button', { name: /types?$|All types/i }))
    await userEvent.click(screen.getByRole('option', { name: 'Shift pattern' }))
    expect(mockUseDeletedRecords).toHaveBeenLastCalledWith('ShiftPattern', 1)
  })

  it('shows the house loading and error states, with Try again', async () => {
    const refetch = vi.fn()
    mockUseDeletedRecords.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch })
    const { unmount } = show()
    expect(screen.queryByText('Nothing has been deleted since this list was added.')).toBeNull()
    unmount()
    mockUseDeletedRecords.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    show()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })
})
