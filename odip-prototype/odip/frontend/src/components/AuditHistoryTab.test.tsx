import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AuditHistoryTab from './AuditHistoryTab'
import { TONE } from '@/lib/tone'
import type { AuditChange } from '../api/hooks'

const { mockUseAuditHistory } = vi.hoisted(() => ({ mockUseAuditHistory: vi.fn() }))
vi.mock('../api/hooks', () => ({ useAuditHistory: mockUseAuditHistory }))

const NOW = new Date('2026-10-28T02:00:00Z')

function entry(id: string, action: string, changedAt: string, changes: AuditChange[] = []) {
  return { id, action, changedAt, changedByName: 'Pat Admin', changes }
}

function renderTab(entries: ReturnType<typeof entry>[]) {
  mockUseAuditHistory.mockReturnValue({ data: { entries, total: entries.length, page: 1, pageSize: 20 }, isLoading: false, isError: false })
  return render(<AuditHistoryTab entityType="Trip" entityId="t1" />)
}

afterEach(() => vi.useRealTimers())

it("renders each change as field, old and new", () => {
  renderTab([entry("a", "Updated", "2026-10-28T01:00:00Z", [{ field: "LastName", old: "A", new: "B" }])])
  expect(screen.getByText("LastName")).toBeInTheDocument()
  expect(screen.getByText("A")).toBeInTheDocument()
  expect(screen.getByText("B")).toBeInTheDocument()
})

describe('AuditHistoryTab', () => {
  it('colours the action pill by the house tones: Created success, Updated info, Deleted danger', () => {
    renderTab([entry('a', 'Created', '2026-10-28T01:00:00Z'), entry('b', 'Updated', '2026-10-28T01:00:00Z'), entry('c', 'Deleted', '2026-10-28T01:00:00Z')])
    expect(screen.getByText('Created')).toHaveClass(...TONE.success.solid.split(' '))
    expect(screen.getByText('Updated')).toHaveClass(...TONE.info.solid.split(' '))
    expect(screen.getByText('Deleted')).toHaveClass(...TONE.danger.solid.split(' '))
  })

  it('reads a day-old entry as "1d ago" with the absolute day and time as the tooltip', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    renderTab([entry('a', 'Updated', '2026-10-27T01:00:00Z')])
    const when = screen.getByText('1d ago')
    expect(when).toHaveAttribute('title', expect.stringMatching(/^\d{2}\/\d{2}\/2026, \d{2}:\d{2}/))
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument()
  })

  it('says it shows only the latest events when there are more than it lists, and keeps the plain count otherwise', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => entry(`e${i}`, 'Updated', '2026-10-28T01:00:00Z'))
    mockUseAuditHistory.mockReturnValue({ data: { entries: fifty, total: 120, page: 1, pageSize: 50 }, isLoading: false, isError: false })
    const { unmount } = render(<AuditHistoryTab entityType="Trip" entityId="t1" />)
    expect(screen.getByText('Showing the latest 50 of 120 events')).toBeInTheDocument()
    unmount()
    renderTab([entry('a', 'Updated', '2026-10-28T01:00:00Z')])
    expect(screen.getByText('1 event recorded')).toBeInTheDocument()
  })

  it('shows the empty state, not a crash, when the response has no entries list (PT-3)', () => {
    mockUseAuditHistory.mockReturnValue({ data: {}, isLoading: false, isError: false })
    render(<AuditHistoryTab entityType="Trip" entityId="t1" />)
    expect(screen.getByText('No history recorded yet.')).toBeInTheDocument()
  })

  it('says the history could not load, in the house voice, and retries', () => {
    const refetch = vi.fn()
    mockUseAuditHistory.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    render(<AuditHistoryTab entityType="Trip" entityId="t1" />)
    expect(screen.getByText(/Couldn't load this history. Check your connection and try again./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })
})
