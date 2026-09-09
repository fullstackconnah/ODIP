import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchPagedList, toTruncatableList } from './pagedList'

const { mockApiGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiGet: mockApiGet }
})

// Pagination rollout wave 1: fetchPagedList is a plain async function (not a hook) that
// composes apiGet + toTruncatableList — the two-line boilerplate every existing use*() hook's
// queryFn currently repeats by hand. It is never called by a component, only by a hook's own
// queryFn, so it intentionally isn't exported from the '@/api/hooks' barrel and doesn't need to
// appear in any vi.mock('@/api/hooks') fixture.
describe('fetchPagedList', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
  })

  it('calls apiGet with the given url and params', async () => {
    mockApiGet.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 0, hasNext: false, hasPrevious: false })

    await fetchPagedList('/incidents', { status: 'Open' })

    expect(mockApiGet).toHaveBeenCalledWith('/incidents', { status: 'Open' })
  })

  it('calls apiGet with undefined params when none are given', async () => {
    mockApiGet.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 0, hasNext: false, hasPrevious: false })

    await fetchPagedList('/incidents')

    expect(mockApiGet).toHaveBeenCalledWith('/incidents', undefined)
  })

  it('flattens the PagedResult to a TruncatableList, matching toTruncatableList directly', async () => {
    const pagedResult = { items: [{ id: 'a' }, { id: 'b' }], totalCount: 2, page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrevious: false }
    mockApiGet.mockResolvedValue(pagedResult)

    const result = await fetchPagedList<{ id: string }>('/incidents')

    expect([...result]).toEqual(toTruncatableList(pagedResult).slice())
    expect(result.totalCount).toBe(2)
    expect(result.isTruncated).toBe(false)
  })

  it('marks the list truncated when the page is smaller than totalCount', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `i${i}` }))
    mockApiGet.mockResolvedValue({ items, totalCount: 120, page: 1, pageSize: 50, totalPages: 3, hasNext: true, hasPrevious: false })

    const result = await fetchPagedList<{ id: string }>('/incidents', { pageSize: '50' })

    expect(result.isTruncated).toBe(true)
    expect(result.totalCount).toBe(120)
    expect(result.length).toBe(50)
  })
})
