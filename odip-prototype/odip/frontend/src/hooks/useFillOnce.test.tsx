import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFillOnce } from './useFillOnce'

// An edit form fills itself from the record a query loads. The query hands over a NEW object on every refetch (window refocus, the 30 s stale time), and a
// fill that ran on each of them wrote the server's values over whatever the person had typed meanwhile.

type Rec = { id: string; name: string }

describe('useFillOnce', () => {
  it('fills when the record arrives, not before', () => {
    const fill = vi.fn()
    const { rerender } = renderHook(({ record }: { record?: Rec }) => useFillOnce(record, fill), { initialProps: { record: undefined } as { record?: Rec } })
    expect(fill).not.toHaveBeenCalled()

    rerender({ record: { id: 'a', name: 'First' } })

    expect(fill).toHaveBeenCalledTimes(1)
    expect(fill).toHaveBeenCalledWith({ id: 'a', name: 'First' })
  })

  it('does not fill again when the same record is fetched again with new values', () => {
    const fill = vi.fn()
    const { rerender } = renderHook(({ record }: { record?: Rec }) => useFillOnce(record, fill), { initialProps: { record: { id: 'a', name: 'First' } } as { record?: Rec } })

    rerender({ record: { id: 'a', name: 'Changed on the server' } })

    expect(fill).toHaveBeenCalledTimes(1)
  })

  it('fills again for a different record', () => {
    const fill = vi.fn()
    const { rerender } = renderHook(({ record }: { record?: Rec }) => useFillOnce(record, fill), { initialProps: { record: { id: 'a', name: 'First' } } as { record?: Rec } })

    rerender({ record: { id: 'b', name: 'Second' } })

    expect(fill).toHaveBeenCalledTimes(2)
    expect(fill).toHaveBeenLastCalledWith({ id: 'b', name: 'Second' })
  })
})
