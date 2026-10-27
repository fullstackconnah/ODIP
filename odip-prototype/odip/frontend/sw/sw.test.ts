// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://bunya.test'
const CACHE = 'bunya-shell-v1'
const template = readFileSync(resolve(__dirname, 'sw.js'), 'utf8')
  .replace('__SW_VERSION__', JSON.stringify('v1'))
  .replace('__SW_PRECACHE__', JSON.stringify(['/index.html', '/assets/app.js', '/theme.js']))

const key = (x: string | { url: string }) => new URL(typeof x === 'string' ? x : x.url, ORIGIN).pathname

/** Runs the worker template against a fake self, CacheStorage and fetch; returns handlers to fire. */
function boot(fetchImpl: (r: unknown) => Promise<Response> = async () => new Response('net')) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const store = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map())
    const m = store.get(name)!
    return {
      addAll: async (reqs: { url: string }[]) => { for (const r of reqs) m.set(key(r), new Response('pre')) },
      put: async (r: string | { url: string }, res: Response) => { m.set(key(r), res) },
      match: async (r: string | { url: string }) => m.get(key(r)),
    }
  }
  const caches = {
    open,
    keys: async () => [...store.keys()],
    delete: async (n: string) => store.delete(n),
    match: async (r: string, o?: { cacheName?: string }) => store.get(o?.cacheName ?? '')?.get(key(r)),
  }
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  }
  const fetchSpy = vi.fn(fetchImpl)
  new Function('self', 'caches', 'fetch', 'Request', template)(self, caches, fetchSpy, Request)
  const fire = async (req: { method?: string; url: string; mode?: string }) => {
    let answer: Promise<Response> | undefined
    handlers.fetch({ request: { method: 'GET', mode: 'cors', ...req }, respondWith: (p: Promise<Response>) => { answer = p } })
    return answer
  }
  return { store, open, fire, fetchSpy, handlers, self }
}

describe('service worker template', () => {
  it('never answers the API, /welcome/, another origin or a write', async () => {
    const { fire } = boot()
    expect(await fire({ url: `${ORIGIN}/api/v1/portal/my-shifts` })).toBeUndefined()
    expect(await fire({ url: `${ORIGIN}/welcome/`, mode: 'navigate' })).toBeUndefined()
    expect(await fire({ url: 'https://elsewhere.test/assets/x.js' })).toBeUndefined()
    expect(await fire({ method: 'POST', url: `${ORIGIN}/assets/x.js` })).toBeUndefined()
  })

  it('answers a navigation from the cached /index.html when the network fails', async () => {
    const { fire, open } = boot(async () => { throw new TypeError('offline') })
    await (await open(CACHE)).put('/index.html', new Response('shell'))
    const res = await (await fire({ url: `${ORIGIN}/portal`, mode: 'navigate' }))!
    expect(await res.text()).toBe('shell')
  })

  it('treats a 502 on a navigation as offline, and passes a 404 through', async () => {
    let status = 502
    const { fire, open } = boot(async () => new Response('x', { status }))
    await (await open(CACHE)).put('/index.html', new Response('shell'))
    expect(await (await (await fire({ url: `${ORIGIN}/portal`, mode: 'navigate' }))!).text()).toBe('shell')
    status = 404
    expect((await (await fire({ url: `${ORIGIN}/portal`, mode: 'navigate' }))!).status).toBe(404)
  })

  it('serves a cached /assets/ file without touching the network', async () => {
    const { fire, open, fetchSpy } = boot()
    await (await open(CACHE)).put('/assets/x.js', new Response('js'))
    const res = await (await fire({ url: `${ORIGIN}/assets/x.js` }))!
    expect(await res.text()).toBe('js')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('activate deletes older bunya-shell caches and keeps the current one and unrelated ones', async () => {
    const { handlers, open, store, self } = boot()
    await open('bunya-shell-old'); await open(CACHE); await open('other-app')
    let done: Promise<unknown> | undefined
    handlers.activate({ waitUntil: (p: Promise<unknown>) => { done = p } })
    await done
    expect([...store.keys()].sort()).toEqual(['bunya-shell-v1', 'other-app'])
    expect(self.clients.claim).toHaveBeenCalled()
  })
})
