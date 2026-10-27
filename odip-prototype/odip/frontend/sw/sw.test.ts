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
  const added: { url: string; init?: { cache?: string } }[] = []
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map())
    const m = store.get(name)!
    return {
      addAll: async (reqs: { url: string; init?: { cache?: string } }[]) => { for (const r of reqs) { added.push(r); m.set(key(r), new Response('pre')) } },
      put: async (r: string | { url: string }, res: Response) => { m.set(key(r), res) },
      match: async (r: string | { url: string }) => m.get(key(r))?.clone(),
    }
  }
  const caches = {
    open,
    keys: async () => [...store.keys()],
    delete: async (n: string) => store.delete(n),
    match: async (r: string, o?: { cacheName?: string }) => store.get(o?.cacheName ?? '')?.get(key(r))?.clone(),
  }
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  }
  const fetchSpy = vi.fn(fetchImpl)
  class FakeRequest { constructor(public url: string, public init?: { cache?: string }) {} }
  new Function('self', 'caches', 'fetch', 'Request', template)(self, caches, fetchSpy, FakeRequest)
  const fire = async (req: { method?: string; url: string; mode?: string }) => {
    let answer: Promise<Response> | undefined
    handlers.fetch({ request: { method: 'GET', mode: 'cors', ...req }, respondWith: (p: Promise<Response>) => { answer = p } })
    return answer
  }
  return { store, open, fire, fetchSpy, handlers, self, added }
}

describe('service worker template', () => {
  it('never answers the API, /welcome/, another origin or a write', async () => {
    const { fire } = boot()
    expect(await fire({ url: `${ORIGIN}/api/v1/portal/my-shifts` })).toBeUndefined()
    expect(await fire({ url: `${ORIGIN}/welcome/`, mode: 'navigate' })).toBeUndefined()
    expect(await fire({ url: 'https://elsewhere.test/assets/x.js' })).toBeUndefined()
    expect(await fire({ method: 'POST', url: `${ORIGIN}/assets/x.js` })).toBeUndefined()
  })

  it('never answers a navigation to the API or to another origin', async () => {
    const { fire } = boot()
    expect(await fire({ url: `${ORIGIN}/api/v1/export`, mode: 'navigate' })).toBeUndefined()
    expect(await fire({ url: 'https://elsewhere.test/portal', mode: 'navigate' })).toBeUndefined()
  })

  it('a successful navigation is network-first and never stored in Cache Storage', async () => {
    const { fire, open, store } = boot(async () => new Response('page'))
    await (await open(CACHE)).put('/index.html', new Response('shell'))
    const before = [...store.get(CACHE)!.keys()]
    const res = await (await fire({ url: `${ORIGIN}/portal`, mode: 'navigate' }))!
    expect(await res.text()).toBe('page')
    expect([...store.get(CACHE)!.keys()]).toEqual(before)
  })

  it('precache bypasses the HTTP cache only for unhashed files', async () => {
    const { handlers, added } = boot()
    let done: Promise<unknown> | undefined
    handlers.install({ waitUntil: (p: Promise<unknown>) => { done = p } })
    await done
    const cacheOf = (u: string) => added.find((r) => r.url === u)?.init?.cache
    expect(cacheOf('/assets/app.js')).toBe('default')
    expect(cacheOf('/index.html')).toBe('reload')
    expect(cacheOf('/theme.js')).toBe('reload')
  })

  it('answers a navigation from the cached /index.html when the network fails', async () => {
    const { fire, open } = boot(async () => { throw new TypeError('offline') })
    await (await open(CACHE)).put('/index.html', new Response('shell'))
    const res = await (await fire({ url: `${ORIGIN}/portal`, mode: 'navigate' }))!
    expect(await res.text()).toBe('shell')
  })

  it('treats a 5xx from 502 up (incl. Cloudflare 530) on a navigation as offline, and passes 404 and 500 through', async () => {
    let status = 502
    const { fire, open } = boot(async () => new Response('x', { status }))
    await (await open(CACHE)).put('/index.html', new Response('shell'))
    const nav = async () => (await fire({ url: `${ORIGIN}/portal`, mode: 'navigate' }))!
    for (status of [502, 530]) expect(await (await nav()).text()).toBe('shell')
    for (status of [404, 500]) expect((await nav()).status).toBe(status)
  })

  it('a 502 with no cached shell returns the 502 response itself, not a network error', async () => {
    const { fire } = boot(async () => new Response('bad gateway', { status: 502 }))
    const res = await (await fire({ url: `${ORIGIN}/portal`, mode: 'navigate' }))!
    expect(res.status).toBe(502)
    expect(await res.text()).toBe('bad gateway')
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
