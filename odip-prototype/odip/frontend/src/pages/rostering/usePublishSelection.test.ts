import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { RosterBoardDto, RosterFindingDto, ShiftDto } from '@/api/types'
import { usePublishSelection } from './usePublishSelection'
import { makeShift, makeUnfilledShift } from './test-fixtures'

const draft = (id: string, o: Partial<ShiftDto> = {}) => makeShift({ id, status: 'Draft', ...o })
const blockedDraft = (id: string) => draft(id, { findings: [{ severity: 'Blocking' } as RosterFindingDto] })

const base = {
  board: undefined as RosterBoardDto | undefined,
  boardShifts: [draft('a'), draft('b')],
  weekStart: '2026-08-17',
  groupBy: 'participant' as const,
  participantFilter: '',
  regionFilter: '',
  unfilledOnly: false,
  canWrite: true,
}
type Props = Omit<typeof base, 'groupBy'> & { groupBy: 'participant' | 'staff' | 'activity' }

function open(props: Partial<Props> = {}, ids = ['a']) {
  const hook = renderHook((p: Props) => usePublishSelection(p), { initialProps: { ...base, ...props } as Props })
  act(() => hook.result.current.setSelection({ key: hook.result.current.toolbarKey, ids: new Set(ids) }))
  return hook
}

describe('usePublishSelection', () => {
  it('keeps a selection across a re-render with the same props', () => {
    const { result, rerender } = open()
    rerender({ ...base })
    expect(result.current.selecting).toBe(true)
    expect(result.current.chosen.map(s => s.id)).toEqual(['a'])
  })

  it.each<[string, Partial<Props>]>([
    ['weekStart', { weekStart: '2026-08-24' }],
    ['groupBy', { groupBy: 'staff' }],
    ['participantFilter', { participantFilter: 'p-1' }],
    ['regionFilter', { regionFilter: 'r-1' }],
    ['unfilledOnly', { unfilledOnly: true }],
    ['canWrite', { canWrite: false }],
    ['the last publishable draft going away', { boardShifts: [] }],
    ['every draft becoming blocked', { boardShifts: [blockedDraft('a'), blockedDraft('b')] }],
  ])('clears the selection when %s changes', (_name, change) => {
    const { result, rerender } = open()
    rerender({ ...base, ...change })
    expect(result.current.selecting).toBe(false)
    expect(result.current.chosen).toEqual([])
  })

  it('drops a picked draft that is no longer publishable and stays open', () => {
    const { result, rerender } = open({}, ['a', 'b'])
    rerender({ ...base, boardShifts: [blockedDraft('a'), draft('b')] })
    expect(result.current.selecting).toBe(true)
    expect(result.current.chosen.map(s => s.id)).toEqual(['b'])
    expect([...result.current.chosenIds]).toEqual(['b'])
  })

  it('toggleChosen adds an unpicked draft and removes a picked one', () => {
    const { result } = open()
    act(() => result.current.toggleChosen(base.boardShifts[1]))
    expect(result.current.chosen.map(s => s.id)).toEqual(['a', 'b'])
    act(() => result.current.toggleChosen(base.boardShifts[0]))
    expect(result.current.chosen.map(s => s.id)).toEqual(['b'])
  })

  it('toggleChosen does nothing when no selection is open', () => {
    const { result } = renderHook(() => usePublishSelection(base))
    act(() => result.current.toggleChosen(base.boardShifts[0]))
    expect(result.current.selecting).toBe(false)
    expect(result.current.chosen).toEqual([])
  })

  it('closes on Escape, but not while a dialog is open', () => {
    const { result } = open()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(result.current.selecting).toBe(true)
    dialog.remove()
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(result.current.selecting).toBe(false)
  })

  it('sorts shifts into drafts, held drafts and blocked', () => {
    const shifts = [draft('ok'), draft('grp', { groupActivityId: 'g1' }), makeUnfilledShift({ id: 'open', status: 'Draft' }), blockedDraft('bad')]
    const { result } = renderHook(() => usePublishSelection({ ...base, boardShifts: shifts }))
    expect(result.current.drafts.map(s => s.id)).toEqual(['ok', 'bad'])
    expect(result.current.heldDrafts).toBe(1)
    expect(result.current.blocked.map(s => s.id)).toEqual(['bad'])
    expect(result.current.publishable.map(s => s.id)).toEqual(['ok'])
  })

  it('reads unstarted only from an explicit weekStarted false', () => {
    const unstarted = (board?: Partial<RosterBoardDto>) =>
      renderHook(() => usePublishSelection({ ...base, board: board as RosterBoardDto | undefined })).result.current.unstarted
    expect(unstarted({ weekStarted: false })).toBe(true)
    expect(unstarted({ weekStarted: true })).toBe(false)
    expect(unstarted({})).toBe(false)
  })
})
