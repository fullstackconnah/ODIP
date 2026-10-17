import { describe, expect, it, vi } from 'vitest'
import { PAGE_SIZE, groupPhase, isPresent, pageCount, pageRows, rowKey, shownCount, visibleRows, type GroupModel, type QuickRow } from './quickGroupModel'

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
    const gone = new Map([[rowKey('leave', 'b'), 0]])
    expect(visibleRows(model(), gone).map((r) => r.id)).toEqual(['a', 'c'])
    expect(shownCount(model(), gone)).toBe(2)
  })

  it('stop counting twice once the refetch has dropped them', () => {
    const gone = new Map([[rowKey('leave', 'b'), 0]])
    expect(shownCount(model({ count: 2, rows: [row('a'), row('c')] }), gone)).toBe(2)
  })

  it('are keyed by group, so the same id in another group is untouched', () => {
    expect(visibleRows(model(), new Map([[rowKey('tasks', 'a'), 0]]))).toHaveLength(3)
  })
})

describe('isPresent', () => {
  it('keeps a waiting or failed group on the page, never absent and never clear', () => {
    expect(isPresent(model({ phase: 'loading', rows: [], count: 0 }), new Map(), 0)).toBe(true)
    expect(isPresent(model({ phase: 'error', rows: [], count: 0 }), new Map(), 0)).toBe(true)
  })

  it('drops a ready group with no rows left, unless it still holds a notice', () => {
    const gone = new Map(['a', 'b', 'c'].map((id): [string, number] => [rowKey('leave', id), 0]))
    expect(isPresent(model(), gone, 0)).toBe(false)
    expect(isPresent(model(), gone, 1)).toBe(true)
  })

  it('stays while a bulk run is in flight, though the refetch has already emptied it (SHAPE §6)', () => {
    const gone = new Map(['a', 'b', 'c'].map((id): [string, number] => [rowKey('leave', id), 0]))
    expect(isPresent(model({ rows: [], count: 0 }), new Map(), 0, true)).toBe(true)
    expect(isPresent(model(), gone, 0, true)).toBe(true)
  })

  it('stays while the server still counts rows beyond the ones decided here: never named clear with work left', () => {
    // 8 waiting, 5 fetched, all 5 decided before the refetch lands (or it is paused offline): 3 still wait.
    const fetched = ['a', 'b', 'c', 'd', 'e']
    const gone = new Map(fetched.map((id): [string, number] => [rowKey('leave', id), 0]))
    const eight = model({ count: 8, rows: fetched.map((id) => row(id)) })

    expect(shownCount(eight, gone)).toBe(3)
    expect(isPresent(eight, gone, 0)).toBe(true)
  })
})

describe('pageRows and pageCount (10 a page)', () => {
  const r = Array.from({ length: 23 }, (_, i) => i)

  it('pages ten at a time, and counts at least one page', () => {
    expect(PAGE_SIZE).toBe(10)
    expect(pageCount(r)).toBe(3)
    expect(pageCount([])).toBe(1)
    expect(pageCount(r.slice(0, 10))).toBe(1)
    expect(pageRows(r, 1)).toEqual(r.slice(0, 10))
    expect(pageRows(r, 3)).toEqual([20, 21, 22])
  })

  it('clamps a page past either end to the nearest page', () => {
    expect(pageRows(r, 9)).toEqual([20, 21, 22])
    expect(pageRows(r, 0)).toEqual(r.slice(0, 10))
  })
})
