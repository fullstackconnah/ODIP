/** Items sent per request. Keep equal to MaxItems in ServiceAgreementsController: the server answers 400 above it. */
export const CHUNK = 25

export interface ChunkRun<R> {
  results: R[]
  /** Set when a request failed: its error, and the items that were not sent (the failed chunk included). */
  stopped?: { error: unknown; notSent: number }
}

/** Sends `items` in order, `size` at a time, one request after another; stops at the first failed request and keeps what the earlier ones answered. */
export async function runInChunks<T, R>(items: readonly T[], size: number, send: (chunk: T[]) => Promise<R[]>, onProgress?: (done: number) => void): Promise<ChunkRun<R>> {
  const results: R[] = []
  for (let at = 0; at < items.length; at += size) {
    try {
      results.push(...await send(items.slice(at, at + size)))
    } catch (error) {
      return { results, stopped: { error, notSent: items.length - at } }
    }
    onProgress?.(results.length)
  }
  return { results }
}
