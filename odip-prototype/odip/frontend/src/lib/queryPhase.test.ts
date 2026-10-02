import { afterEach, describe, expect, it } from 'vitest'
import { onlineManager, QueryClient, QueryObserver } from '@tanstack/react-query'
import { awaitsData } from './queryPhase'

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('awaitsData: a query that has not answered yet and was actually asked', () => {
  it.each([
    ['in flight', { isPending: true, fetchStatus: 'fetching' }, true],
    ['paused while the browser is offline (isLoading is false here)', { isPending: true, fetchStatus: 'paused' }, true],
    ['disabled: nobody asked it', { isPending: true, fetchStatus: 'idle' }, false],
    ['answered', { isPending: false, fetchStatus: 'idle' }, false],
    ['refetching behind the data it already has', { isPending: false, fetchStatus: 'fetching' }, false],
    ['a result with no fetchStatus (a test double that only says it is pending)', { isPending: true }, true],
    ['an empty result', {}, false],
  ] as const)('%s', (_label, query, expected) => {
    expect(awaitsData(query)).toBe(expected)
  })
})

// The library facts the helper rests on, pinned against the installed TanStack Query: a request that has to wait for the network is "pending" with a
// fetchStatus of "paused", and `isLoading` (isFetching && isPending) is FALSE for it, which is how a screen testing only `isLoading` read it as an answer.
describe('awaitsData against a real query', () => {
  const observe = (options: { enabled?: boolean }) => {
    const observer = new QueryObserver(new QueryClient(), { queryKey: ['awaits-data'], queryFn: async () => 1, ...options })
    const unsubscribe = observer.subscribe(() => {})
    return { result: observer.getCurrentResult(), unsubscribe }
  }

  it('is true for a request paused offline, though isLoading says it is not loading', () => {
    onlineManager.setOnline(false)
    const { result, unsubscribe } = observe({})
    unsubscribe()

    expect(result).toMatchObject({ status: 'pending', fetchStatus: 'paused', isLoading: false, isError: false, data: undefined })
    expect(awaitsData(result)).toBe(true)
  })

  it('is true for a request in flight', () => {
    const { result, unsubscribe } = observe({})
    unsubscribe()

    expect(result).toMatchObject({ status: 'pending', fetchStatus: 'fetching', isLoading: true })
    expect(awaitsData(result)).toBe(true)
  })

  it('is false for a disabled query, offline or not: it is pending forever and was never asked', () => {
    for (const online of [true, false]) {
      onlineManager.setOnline(online)
      const { result, unsubscribe } = observe({ enabled: false })
      unsubscribe()

      expect(result).toMatchObject({ status: 'pending', fetchStatus: 'idle' })
      expect(awaitsData(result)).toBe(false)
    }
  })
})
