import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBoardViewMode } from './useBoardViewMode'

const KEY = 'odip.roster.boardView'

describe('useBoardViewMode', () => {
  beforeEach(() => sessionStorage.clear())

  it('reads activity and staff, and any other stored value as participant', () => {
    sessionStorage.setItem(KEY, 'activity')
    expect(renderHook(() => useBoardViewMode()).result.current[0]).toBe('activity')
    sessionStorage.setItem(KEY, 'staff')
    expect(renderHook(() => useBoardViewMode()).result.current[0]).toBe('staff')
    sessionStorage.setItem(KEY, 'banana')
    expect(renderHook(() => useBoardViewMode()).result.current[0]).toBe('participant')
  })

  it('stores activity', () => {
    const { result } = renderHook(() => useBoardViewMode())
    act(() => result.current[1]('activity'))
    expect(result.current[0]).toBe('activity')
    expect(sessionStorage.getItem(KEY)).toBe('activity')
  })
})
