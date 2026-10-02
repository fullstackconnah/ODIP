import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MAX_NOTICES, useNotices, withNotice, type Notice } from './useNotices'

const notice = (id: number, tone: Notice['tone']): Notice => ({ id, tone, title: `Person ${id}`, message: `Message ${id}` })
const ids = (list: readonly Notice[]) => list.map(n => n.id)

describe('withNotice', () => {
  it('puts the newest first', () => {
    expect(ids(withNotice([notice(1, 'success')], notice(2, 'success')))).toEqual([2, 1])
  })

  it('a success never removes an error: an error, then a success, leaves both', () => {
    const afterError = withNotice([], notice(1, 'danger'))
    const afterSuccess = withNotice(afterError, notice(2, 'success'))

    expect(ids(afterSuccess)).toEqual([2, 1])
    expect(afterSuccess.find(n => n.id === 1)?.tone).toBe('danger')
  })

  it('holds at most three, so the cap is 3', () => {
    expect(MAX_NOTICES).toBe(3)
    let list: Notice[] = []
    for (let id = 1; id <= 6; id++) list = withNotice(list, notice(id, 'success'))

    expect(ids(list)).toEqual([6, 5, 4])
  })

  it('over the cap, the oldest SUCCESS goes first, even when an older error is waiting', () => {
    // newest first: success 4, error 3 (old), success 2... then a new success arrives
    const full = [notice(4, 'success'), notice(3, 'danger'), notice(2, 'success')]

    expect(ids(withNotice(full, notice(5, 'success')))).toEqual([5, 4, 3])
    expect(ids(withNotice(full, notice(5, 'danger')))).toEqual([5, 4, 3])
  })

  it('with only errors held, a new error replaces the oldest, and a new success is not let in to push one out', () => {
    const errors = [notice(3, 'danger'), notice(2, 'danger'), notice(1, 'danger')]

    expect(ids(withNotice(errors, notice(4, 'danger')))).toEqual([4, 3, 2])
    expect(ids(withNotice(errors, notice(4, 'success')))).toEqual([3, 2, 1])
  })

  it('does not change the list it is given', () => {
    const list = [notice(1, 'success')]
    withNotice(list, notice(2, 'success'))
    expect(ids(list)).toEqual([1])
  })
})

describe('useNotices', () => {
  it('starts empty, and notify adds a notice for a person with its message', () => {
    const { result } = renderHook(() => useNotices())
    expect(result.current.notices).toEqual([])

    act(() => result.current.notify('success', 'Ann One', 'We sent ann@example.com a link.'))

    expect(result.current.notices).toEqual([{ id: expect.any(Number), tone: 'success', title: 'Ann One', message: 'We sent ann@example.com a link.' }])
  })

  it('keeps a subject, the stable key of whoever the notice is about, so a screen can find that person\'s control again', () => {
    const { result } = renderHook(() => useNotices())

    act(() => result.current.notify('success', 'Ann One', 'We sent ann@example.com a link.', 'user-1'))
    act(() => result.current.notify('success', 'Bob Two', 'We sent bob@example.com a link.'))

    expect(result.current.notices.map(n => n.subject)).toEqual([undefined, 'user-1'])
  })

  it('keeps an error through a later success, and dismiss removes only the notice it is given', () => {
    const { result } = renderHook(() => useNotices())

    act(() => result.current.notify('danger', 'Ann One', 'No link was sent to ann@example.com.'))
    act(() => result.current.notify('success', 'Bob Two', 'We sent bob@example.com a link.'))

    expect(result.current.notices.map(n => n.title)).toEqual(['Bob Two', 'Ann One'])

    const error = result.current.notices.find(n => n.tone === 'danger')!
    act(() => result.current.dismiss(error.id))

    expect(result.current.notices.map(n => n.title)).toEqual(['Bob Two'])
  })

  it('gives every notice its own id, even when two arrive in one batch', () => {
    const { result } = renderHook(() => useNotices())

    act(() => {
      result.current.notify('success', 'Ann One', 'First.')
      result.current.notify('success', 'Bob Two', 'Second.')
    })

    const [a, b] = result.current.notices
    expect(a.id).not.toBe(b.id)
  })

  it('gives notify and dismiss a stable identity, so passing them down does not re-render the child', () => {
    const { result, rerender } = renderHook(() => useNotices())
    const { notify, dismiss } = result.current

    act(() => notify('success', 'Ann One', 'Sent.'))
    rerender()

    expect(result.current.notify).toBe(notify)
    expect(result.current.dismiss).toBe(dismiss)
  })
})
