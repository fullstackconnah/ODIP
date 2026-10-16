import { describe, expect, it, vi } from 'vitest'
import { groupPhase, isPresent, rowKey, shownCount, trackMinimums, visibleRows, type GroupModel, type QuickRow } from './quickGroupModel'

const row = (id: string): QuickRow => ({ id, subject: `Person ${id}`, facts: [], flags: [], actions: [] })
const model = (o: Partial<GroupModel> = {}): GroupModel => ({
  key: 'leave', title: 'Leave', noun: 'leave requests', subjectHeader: 'Staff', columns: [], phase: 'ready', refetch: vi.fn(), count: 3,
  rows: [row('a'), row('b'), row('c')], link: { to: '/rostering/leave', openLabel: 'Open Leave' }, ...o,
})

describe('groupPhase', () => {
  it('waits while any request has no answer yet, a paused one included', () => {
    expect(groupPhase({ data: [] }, { data: undefined, isPending: true, fetchStatus: 'fetching' })).toBe('loading')
    expect(groupPhase({ data: undefined, isPending: true, fetchStatus: 'paused' })).toBe('loading')
  })

  it('fails when a request failed with nothing held, and keeps the rows it holds when a background refetch fails', () => {
    expect(groupPhase({ data: [] }, { data: undefined, isError: true, isPending: false, fetchStatus: 'idle' })).toBe('error')
    expect(groupPhase({ data: [], isError: true })).toBe('ready')
  })

  it('is ready with every answer in, and a disabled request is not waiting', () => {
    expect(groupPhase({ data: [] }, { data: { items: [] } })).toBe('ready')
    expect(groupPhase({ data: undefined, isPending: true, fetchStatus: 'idle' })).toBe('ready')
  })
})

describe('rows decided here', () => {
  it('leave the list at once, and the pill drops by each one the server still lists', () => {
    const gone = new Set([rowKey('leave', 'b')])
    expect(visibleRows(model(), gone).map((r) => r.id)).toEqual(['a', 'c'])
    expect(shownCount(model(), gone)).toBe(2)
  })

  it('stop counting twice once the refetch has dropped them', () => {
    const gone = new Set([rowKey('leave', 'b')])
    expect(shownCount(model({ count: 2, rows: [row('a'), row('c')] }), gone)).toBe(2)
  })

  it('are keyed by group, so the same id in another group is untouched', () => {
    expect(visibleRows(model(), new Set([rowKey('tasks', 'a')]))).toHaveLength(3)
  })
})

describe('isPresent', () => {
  it('keeps a waiting or failed group on the page, never absent and never clear', () => {
    expect(isPresent(model({ phase: 'loading', rows: [], count: 0 }), new Set(), 0)).toBe(true)
    expect(isPresent(model({ phase: 'error', rows: [], count: 0 }), new Set(), 0)).toBe(true)
  })

  it('drops a ready group with no rows left, unless it still holds a notice', () => {
    const gone = new Set(['a', 'b', 'c'].map((id) => rowKey('leave', id)))
    expect(isPresent(model(), gone, 0)).toBe(false)
    expect(isPresent(model(), gone, 1)).toBe(true)
  })

  it('stays while a bulk run is in flight, though the refetch has already emptied it (SHAPE §6)', () => {
    const gone = new Set(['a', 'b', 'c'].map((id) => rowKey('leave', id)))
    expect(isPresent(model({ rows: [], count: 0 }), new Set(), 0, true)).toBe(true)
    expect(isPresent(model(), gone, 0, true)).toBe(true)
  })

  it('stays while the server still counts rows beyond the ones decided here: never named clear with work left', () => {
    // 8 waiting, 5 fetched, all 5 decided before the refetch lands (or it is paused offline): 3 still wait.
    const fetched = ['a', 'b', 'c', 'd', 'e']
    const gone = new Set(fetched.map((id) => rowKey('leave', id)))
    const eight = model({ count: 8, rows: fetched.map((id) => row(id)) })

    expect(shownCount(eight, gone)).toBe(3)
    expect(isPresent(eight, gone, 0)).toBe(true)
  })
})

describe('trackMinimums (the xl table: a title wins over free-text facts)', () => {
  // A 1006px table; 493px of buttons, dates and short facts; free-text facts at a 96px floor.
  const base = { table: 1006, fixed: 493, floor: 96 }

  it('keeps a title whole when it fits with the facts at their floor', () => {
    expect(trackMinimums({ ...base, subject: 400, facts: [185] })).toEqual({ subject: 400, facts: [96] })
  })

  it('cuts a title only to what is left once every free-text fact is at its floor', () => {
    expect(trackMinimums({ ...base, subject: 574, facts: [185] })).toEqual({ subject: 417, facts: [96] })
  })

  it('holds a fact shorter than its floor at its own width, and gives the difference to the title', () => {
    expect(trackMinimums({ ...base, subject: 574, facts: [40] })).toEqual({ subject: 473, facts: [40] })
  })

  it('asks nothing of an empty table, and never a negative width', () => {
    expect(trackMinimums({ ...base, subject: 0, facts: [] })).toEqual({ subject: 0, facts: [] })
    expect(trackMinimums({ table: 300, fixed: 493, floor: 96, subject: 574, facts: [185] })).toEqual({ subject: 0, facts: [96] })
  })
})
