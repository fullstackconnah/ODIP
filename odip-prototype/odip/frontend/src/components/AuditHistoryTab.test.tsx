import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ComponentProps } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import AuditHistoryTab, { FieldDiff } from './AuditHistoryTab'
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

it('names a field from fieldLabels and leaves one it does not list as stored', () => {
  mockUseAuditHistory.mockReturnValue({ data: { entries: [entry('a', 'Updated', '2026-10-28T01:00:00Z', [{ field: 'GSTRegistered', old: 'False', new: 'True' }, { field: 'Other', old: 'x', new: 'y' }])], total: 1, page: 1, pageSize: 50 }, isLoading: false, isError: false })
  render(<AuditHistoryTab entityType="ProviderSettings" entityId="p1" fieldLabels={{ GSTRegistered: 'Registered for GST' }} />)
  expect(screen.getByText('Registered for GST')).toBeInTheDocument()
  expect(screen.queryByText('GSTRegistered')).not.toBeInTheDocument()
  expect(screen.getByText('Other')).toBeInTheDocument()
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

describe('AuditHistoryTab values read as words (PSA-O3)', () => {
  const show = (changes: AuditChange[], props: Partial<ComponentProps<typeof AuditHistoryTab>> = {}) => {
    mockUseAuditHistory.mockReturnValue({ data: { entries: [entry('a', 'Updated', '2026-10-28T01:00:00Z', changes)], total: 1, page: 1, pageSize: 20 }, isLoading: false, isError: false })
    return render(<AuditHistoryTab entityType="ProviderSettings" entityId="p1" {...props} />)
  }

  it('reads a stored True and False as Yes and No, with no labels given', () => {
    show([{ field: 'GSTRegistered', old: 'False', new: 'True' }])
    expect(screen.getByText('No')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.queryByText('True')).not.toBeInTheDocument()
    expect(screen.queryByText('False')).not.toBeInTheDocument()
  })

  it('reads True and False as Yes and No for a deleted record\'s field list, which may hold one value only', () => {
    render(<FieldDiff field="IsActive" old="True" new={null} />)
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('replaces a stored value with the words valueLabels gives it for that field, and shows an unlisted value as stored', () => {
    show([{ field: 'ParticipantReadinessMode', old: 'Warn', new: 'Enforce' }, { field: 'ParticipantReadinessMode', old: 'Other', new: null }, { field: 'State', old: 'VIC', new: 'NSW' }], {
      valueLabels: { ParticipantReadinessMode: { Warn: 'Warn only' } },
    })
    expect(screen.getByText('Warn only')).toBeInTheDocument()
    expect(screen.getByText('Enforce')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
    expect(screen.getByText('VIC')).toBeInTheDocument()
  })

  it('never splits, re-cases or looks up other values: McDonald, a value that is a property name, a lower-case true', () => {
    show([{ field: 'LastName', old: 'McDonald', new: 'constructor' }, { field: 'Note', old: 'true', new: 'TRUE' }], { valueLabels: { LastName: { Warn: 'Warn only' } } })
    for (const text of ['McDonald', 'constructor', 'true', 'TRUE']) expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('shows a field with a valueFormat one item per line in a plain list, for the old and the new value', () => {
    show([{ field: 'Modes', old: 'a=1; b=2', new: 'a=1; b=3;  ; c=4' }, { field: 'Other', old: 'x; y', new: null }], { valueFormat: { Modes: v => v.split(/\s*;\s*/).filter(Boolean) } })
    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(2)
    expect(lists.map(l => within(l).getAllByRole('listitem').map(li => li.textContent))).toEqual([['a=1', 'b=2'], ['a=1', 'b=3', 'c=4']])
    expect(lists[0]).toHaveClass('list-none')
    expect(screen.getByText('x; y')).toBeInTheDocument()
  })
})

it('is a size container: the label stacks over the values under 35rem and takes its 140px column from there up (PSA-F3)', () => {
  renderTab([entry('a', 'Updated', '2026-10-28T01:00:00Z', [{ field: 'Onboarding checklist', old: 'x', new: 'y' }])])
  const label = screen.getByText('Onboarding checklist')
  const row = label.parentElement as HTMLElement
  expect(row.parentElement).toHaveClass('@container')
  expect(row).toHaveClass('flex-col', '@[35rem]:flex-row')
  expect(label).toHaveClass('@[35rem]:w-[140px]', '@[35rem]:shrink-0')
  expect(label.nextElementSibling).toHaveClass('flex-wrap', '@[35rem]:flex-nowrap')
})
