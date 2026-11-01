import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'

// A session that began with "Sign in with Microsoft" has no Firebase user, so an expired token is renewed at POST /auth/microsoft/refresh (which checks the
// Microsoft session is still good), never at /auth/exchange. A refused refresh ends the session and tells the login page why.

const { getIdToken, signOut, firebaseAuth } = vi.hoisted(() => {
  const getIdToken = vi.fn()
  return { getIdToken, signOut: vi.fn(), firebaseAuth: { currentUser: { getIdToken } } }
})
vi.mock('@/lib/firebase', () => ({ auth: firebaseAuth, devAuthEnabled: false }))
vi.mock('firebase/auth', () => ({ signOut }))

type Client = typeof import('./client')
type Answer = { status: number; data: unknown }

function script(client: Client, answer: (url: string, nth: number) => Answer) {
  const requests: Array<{ url: string; authorization?: string }> = []
  client.apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    const a = answer(String(config.url), requests.filter(r => r.url === config.url).length)
    requests.push({ url: String(config.url), authorization: config.headers?.Authorization as string | undefined })
    const response = { data: a.data, status: a.status, statusText: String(a.status), headers: {}, config }
    return a.status < 400
      ? Promise.resolve(response)
      : Promise.reject(new AxiosError(`Request failed with status code ${a.status}`, 'ERR_BAD_REQUEST', config, null, response))
  }
  return requests
}

const outcome = (promise: Promise<unknown>, ms = 1000) =>
  Promise.race([
    promise.then(
      () => 'RESOLVED',
      (err: { response?: { status?: number } }) => `REJECTED ${err.response?.status}`,
    ),
    new Promise<string>(resolve => setTimeout(() => resolve('HUNG'), ms)),
  ])

async function freshClient(): Promise<Client> {
  vi.resetModules()
  return import('./client')
}

let hrefs: string[]
beforeEach(() => {
  getIdToken.mockReset().mockResolvedValue('fresh-id-token')
  signOut.mockReset().mockResolvedValue(undefined)
  localStorage.clear()
  hrefs = []
  const stub = { origin: 'http://localhost', set href(v: string) { hrefs.push(v) }, get href() { return 'http://localhost/' } }
  Object.defineProperty(window, 'location', { configurable: true, value: stub })
})
afterEach(() => localStorage.clear())

const signInAsMicrosoft = () => {
  localStorage.setItem('odip_token', 'the-old-token')
  localStorage.setItem('odip_user', '{}')
  localStorage.setItem('odip_sign_in_method', 'microsoft')
}

describe('a Microsoft session', () => {
  it('refreshes through /auth/microsoft/refresh, once for two concurrent 401s, never /auth/exchange, and retries both', async () => {
    const client = await freshClient()
    signInAsMicrosoft()
    const requests = script(client, (url, nth) => {
      if (url === '/auth/microsoft/refresh') return { status: 200, data: { success: true, data: { token: 'the-new-token' } } }
      return nth < 1 ? { status: 401, data: {} } : { status: 200, data: { success: true, data: [url] } }
    })

    const [a, b] = await Promise.all([client.apiGet('/a'), client.apiGet('/b')])

    expect([a, b]).toEqual([['/a'], ['/b']])
    const urls = requests.map(r => r.url)
    expect(urls.filter(u => u === '/auth/microsoft/refresh')).toHaveLength(1)
    expect(urls).not.toContain('/auth/exchange')
    expect(getIdToken).not.toHaveBeenCalled()
    expect(requests.filter(r => r.authorization === 'Bearer the-new-token').map(r => r.url).sort()).toEqual(['/a', '/b'])
    expect(localStorage.getItem('odip_token')).toBe('the-new-token')
  })

  it('a refused Microsoft refresh ends the session at /login?microsoft=MicrosoftSessionEnded and removes odip_sign_in_method', async () => {
    const client = await freshClient()
    signInAsMicrosoft()
    script(client, () => ({ status: 401, data: { success: false, code: 'MicrosoftSessionEnded' } }))

    const result = await outcome(client.apiGet('/participants'))

    expect(result).toBe('REJECTED 401')
    await vi.waitFor(() => expect(hrefs).toEqual(['/login?microsoft=MicrosoftSessionEnded']))
    expect(localStorage.getItem('odip_sign_in_method')).toBeNull()
    expect(localStorage.getItem('odip_token')).toBeNull()
  })

  it('a Microsoft refresh refused with SessionLengthReached ends the session at /login?microsoft=SessionLengthReached, keeping the queue', async () => {
    const client = await freshClient()
    signInAsMicrosoft()
    script(client, () => ({ status: 401, data: { success: false, code: 'SessionLengthReached' } }))

    expect(await outcome(client.apiGet('/participants'))).toBe('REJECTED 401')

    await vi.waitFor(() => expect(hrefs).toEqual(['/login?microsoft=SessionLengthReached']))
    expect(localStorage.getItem('odip_token')).toBeNull()
  })

  it('a refresh that failed for any reason but a 401 ends the session without the 12-hour words', async () => {
    const client = await freshClient()
    signInAsMicrosoft()
    script(client, url => (url === '/auth/microsoft/refresh' ? { status: 503, data: {} } : { status: 401, data: {} }))

    await outcome(client.apiGet('/participants'))

    await vi.waitFor(() => expect(hrefs).toEqual(['/login']))
    expect(localStorage.getItem('odip_token')).toBeNull()
  })

  it('a 401 from /auth/microsoft/refresh itself is passed through, not retried', async () => {
    const client = await freshClient()
    localStorage.setItem('odip_token', 'a-landing-session')
    const requests = script(client, () => ({ status: 401, data: { success: false, code: 'MicrosoftSessionEnded' } }))

    const result = await outcome(client.apiPostRaw('/auth/microsoft/refresh'))

    expect(result).toBe('REJECTED 401')
    expect(requests.map(r => r.url)).toEqual(['/auth/microsoft/refresh'])
  })
})

describe('a password session', () => {
  it('an exchange refused with SessionLengthReached on the refresh ends the session at /login?microsoft=SessionLengthReached', async () => {
    const client = await freshClient()
    localStorage.setItem('odip_token', 'the-old-token')
    script(client, (url, nth) => {
      if (url === '/auth/exchange') return { status: 401, data: { success: false, code: 'SessionLengthReached' } }
      return nth === 0 ? { status: 401, data: {} } : { status: 200, data: {} }
    })

    expect(await outcome(client.apiGet('/participants'))).toBe('REJECTED 401')

    await vi.waitFor(() => expect(hrefs).toEqual(['/login?microsoft=SessionLengthReached']))
  })

  it('still uses /auth/exchange and goes to /login', async () => {
    const client = await freshClient()
    localStorage.setItem('odip_token', 'the-old-token')
    const requests = script(client, (url, nth) => {
      if (url === '/auth/exchange') return { status: 401, data: { code: 'TenantInactive' } }
      return nth === 0 ? { status: 401, data: {} } : { status: 200, data: {} }
    })

    const result = await outcome(client.apiGet('/participants'))

    expect(result).toBe('REJECTED 401')
    expect(requests.map(r => r.url)).toContain('/auth/exchange')
    expect(requests.map(r => r.url)).not.toContain('/auth/microsoft/refresh')
    await vi.waitFor(() => expect(hrefs).toEqual(['/login']))
  })
})
