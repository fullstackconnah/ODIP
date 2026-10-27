import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SyncRow } from './SyncRow'
import { SyncBar } from './SyncBar'
import { offlineQueue } from '@/lib/offline/queue'

// The sync row's four states (SHAPE 4b) and the Not sent list's Discard confirm (SHAPE 4c).

const record = (id: string, status: 'waiting' | 'notSent' = 'waiting', over: Record<string, unknown> = {}) => ({
  id, userId: 'u1', viewAsTenant: null, viewAsUser: null, shiftId: 's1', kind: 'note', path: '/portal/shifts/s1/notes', method: 'POST',
  body: { id, createdAt: '2026-10-28T02:00:00Z', body: `note ${id}` }, clientTime: '2026-10-28T02:00:00Z', createdAt: '2026-10-28T02:00:00Z', status,
  ...(status === 'notSent' ? { httpStatus: 422, code: 'SHIFT_CLIENT_TIME_TOO_OLD' } : {}),
  label: { participant: 'Jordan Smith', serviceDate: '2026-10-28', rostered: '9:00 am – 1:00 pm' },
  ...over,
})

const seed = (...records: unknown[]) => localStorage.setItem('odip_offline:u1:queue', JSON.stringify(records))
const view = (ui = <SyncRow />) => render(<MemoryRouter>{ui}</MemoryRouter>)

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
})
afterEach(() => { offlineQueue.wipeAll(); vi.restoreAllMocks() })

describe('SyncRow', () => {
  it('renders nothing when nothing is unsent', () => {
    const { container } = view()
    expect(container).toBeEmptyDOMElement()
  })

  it('waiting: counts the changes and Send now replays the queue', () => {
    seed(record('r1'), record('r2'), record('r3'))
    const replay = vi.spyOn(offlineQueue, 'replay').mockResolvedValue(undefined as never)
    view()
    expect(screen.getByRole('status')).toHaveTextContent('3 changes waiting to send')
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    expect(replay).toHaveBeenCalledTimes(1)
  })

  it('one waiting change is singular', () => {
    seed(record('r1'))
    view()
    expect(screen.getByRole('status')).toHaveTextContent('1 change waiting to send')
  })

  it('not sent: says how many, with the waiting count, and Review opens the list', () => {
    seed(record('r1', 'notSent'), record('r2'))
    view()
    expect(screen.getByRole('status')).toHaveTextContent('1 not sent · 1 waiting')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    const dialog = screen.getByRole('dialog', { name: 'Not sent' })
    expect(within(dialog).getByText('note r1')).toBeTruthy()
    expect(within(dialog).queryByText('note r2')).toBeNull()
  })

  it('Discard asks first (Keep it has focus) and only Discard removes the record', () => {
    seed(record('r1', 'notSent'))
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Discard this note?' })
    expect(within(confirm).getByRole('button', { name: 'Keep it' })).toHaveFocus()

    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep it' }))
    expect(offlineQueue.getSnapshot()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Discard this note?' })).getByRole('button', { name: 'Discard' }))
    expect(offlineQueue.getSnapshot()).toHaveLength(0)
  })

  it('a SyncBar is a labelled region only while there is something to say', () => {
    const { container, unmount } = view(<SyncBar />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    seed(record('r1'))
    view(<SyncBar />)
    expect(within(screen.getByRole('region', { name: 'Sending' })).getByRole('status')).toHaveTextContent('1 change waiting to send')
  })
})
