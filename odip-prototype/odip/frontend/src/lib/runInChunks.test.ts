import { describe, expect, it, vi } from 'vitest'
import { CHUNK, runInChunks } from './runInChunks'

describe('runInChunks', () => {
  it('sends in order, one chunk after another, and reports progress', async () => {
    const calls: number[][] = []
    const progress: number[] = []
    const out = await runInChunks([1, 2, 3, 4, 5], 2, async c => { calls.push(c); return c.map(x => x * 10) }, d => progress.push(d))
    expect(calls).toEqual([[1, 2], [3, 4], [5]])
    expect(out).toEqual({ results: [10, 20, 30, 40, 50] })
    expect(progress).toEqual([2, 4, 5])
  })

  it('stops at the first failed request and keeps the earlier answers', async () => {
    const boom = new Error('429')
    const send = vi.fn().mockResolvedValueOnce(['a', 'b']).mockRejectedValueOnce(boom)
    const out = await runInChunks([1, 2, 3, 4, 5, 6], 2, send)
    expect(send).toHaveBeenCalledTimes(2)
    expect(out.results).toEqual(['a', 'b'])
    expect(out.stopped).toEqual({ error: boom, notSent: 4 })
  })

  it('pins the chunk size to the server cap', () => expect(CHUNK).toBe(25)) // MaxItems in ServiceAgreementsController
})
