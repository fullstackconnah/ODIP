import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MAX_SUCCESSES, useNotices, withNotice, type Notice } from './useNotices'

const notice = (id: number, tone: Notice['tone'], subject?: string): Notice => ({ id, tone, title: `Person ${id}`, message: `Message ${id}`, subject })
const ids = (list: readonly Notice[]) => list.map(n => n.id)

describe('withNotice', () => {
  it('puts the newest first', () => {
    expect(ids(withNotice([notice(1, 'success')], notice(2, 'success')))).toEqual([2, 1])
  })

  it("a success about someone else never removes an error: an error, then another person's success, leaves both", () => {
    const afterError = withNotice([], notice(1, 'danger', 'u1'))
    const afterSuccess = withNotice(afterError, notice(2, 'success', 'u2'))

    expect(ids(afterSuccess)).toEqual([2, 1])
    expect(afterSuccess.find(n => n.id === 1)?.tone).toBe('danger')
  })

  it('holds at most three SUCCESSES, newest first, so the cap is 3', () => {
    expect(MAX_SUCCESSES).toBe(3)
    let list: Notice[] = []
    for (let id = 1; id <= 6; id++) list = withNotice(list, notice(id, 'success'))

    expect(ids(list)).toEqual([6, 5, 4])
  })

  it('never evicts an error, however many there are: each stays until someone deals with it', () => {
    let list: Notice[] = []
    for (let id = 1; id <= 5; id++) list = withNotice(list, notice(id, 'danger', `u${id}`))

    expect(ids(list)).toEqual([5, 4, 3, 2, 1])
  })

  it('over the cap, the oldest SUCCESS goes and every error stays, wherever the errors sit in the list', () => {
    // newest first: success 5, error 4, success 3, error 2, success 1; then a new success arrives (over the cap of three successes)
    const full = [notice(5, 'success', 'u5'), notice(4, 'danger', 'u4'), notice(3, 'success', 'u3'), notice(2, 'danger', 'u2'), notice(1, 'success', 'u1')]

    expect(ids(withNotice(full, notice(6, 'success', 'u6')))).toEqual([6, 5, 4, 3, 2])
  })

  it('a new success is always let in, because the cap only ever removes older successes', () => {
    const errors = [notice(3, 'danger', 'u3'), notice(2, 'danger', 'u2'), notice(1, 'danger', 'u1')]

    expect(ids(withNotice(errors, notice(4, 'success', 'u4')))).toEqual([4, 3, 2, 1])
  })

  it("a success about someone REPLACES that person's earlier error: the problem it reported is over", () => {
    const list = [notice(2, 'danger', 'u2'), notice(1, 'danger', 'u1')]

    const after = withNotice(list, notice(3, 'success', 'u1'))

    expect(ids(after)).toEqual([3, 2])
  })

  it('a newer error about the same person replaces their earlier one, so retries do not pile up identical failures', () => {
    const list = [notice(2, 'danger', 'u2'), notice(1, 'danger', 'u1')]

    const after = withNotice(list, notice(3, 'danger', 'u1'))

    expect(ids(after)).toEqual([3, 2])
  })

  it("does not touch that person's earlier SUCCESS: the first link did go, even if a later send failed", () => {
    const list = [notice(1, 'success', 'u1')]

    expect(ids(withNotice(list, notice(2, 'danger', 'u1')))).toEqual([2, 1])
  })

  it('a notice with no subject never replaces anything, and is never replaced', () => {
    const list = [notice(2, 'danger'), notice(1, 'danger')]

    expect(ids(withNotice(list, notice(3, 'success')))).toEqual([3, 2, 1])
    expect(ids(withNotice(list, notice(3, 'danger')))).toEqual([3, 2, 1])
  })

  it('does not change the list it is given', () => {
    const list = [notice(1, 'danger', 'u1')]
    withNotice(list, notice(2, 'success', 'u1'))
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
