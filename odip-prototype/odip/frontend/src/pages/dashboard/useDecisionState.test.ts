import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDecisionState } from './useDecisionState'

describe('useDecisionState', () => {
  it('keeps every consequence notice until it is dismissed: none is evicted to make room', () => {
    const { result } = renderHook(() => useDecisionState())
    const link = { label: 'Open roster', to: '/rostering' }

    act(() => {
      for (const name of ['Ana', 'Ben', 'Cy', 'Dee', 'Eve']) result.current.notify('success', name, 'Leave approved. It overlaps 1 shift, and it has a cover task.', 'leave', link)
    })

    expect(result.current.notices.map((n) => n.title)).toEqual(['Eve', 'Dee', 'Cy', 'Ben', 'Ana'])
  })

  it('remembers the rows decided here, by group and id', () => {
    const { result } = renderHook(() => useDecisionState())

    act(() => result.current.markGone('leave:leave:l1'))

    expect(result.current.gone.has('leave:leave:l1')).toBe(true)
  })

  it('knows which groups have a bulk run in flight', () => {
    const { result } = renderHook(() => useDecisionState())

    act(() => result.current.setRunning('leave', true))
    expect(result.current.running.has('leave')).toBe(true)
    act(() => result.current.setRunning('leave', false))
    expect(result.current.running.has('leave')).toBe(false)
  })
})
