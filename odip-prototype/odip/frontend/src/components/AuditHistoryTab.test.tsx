import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AuditHistoryTab from './AuditHistoryTab'
import { TONE } from '@/lib/tone'

const { mockUseAuditHistory } = vi.hoisted(() => ({ mockUseAuditHistory: vi.fn() }))
vi.mock('../api/hooks', () => ({ useAuditHistory: mockUseAuditHistory }))

const NOW = new Date('2026-10-28T02:00:00Z')

function entry(id: string, action: string, changedAt: string) {
  return { id, action, changedAt, changedByName: 'Pat Admin', changes: [] }
}

function renderTab(entries: ReturnType<typeof entry>[]) {
  mockUseAuditHistory.mockReturnValue({ data: { entries, total: entries.length, page: 1, pageSize: 20 }, isLoading: false, isError: false })
  return render(<AuditHistoryTab entityType="Trip" entityId="t1" />)
}

afterEach(() => vi.useRealTimers())

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

  it('says the history could not load, in the house voice, and retries', () => {
    const refetch = vi.fn()
    mockUseAuditHistory.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    render(<AuditHistoryTab entityType="Trip" entityId="t1" />)
    expect(screen.getByText(/Couldn't load this history. Check your connection and try again./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })
})
