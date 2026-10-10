import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'

// The shared client turns a 401 into "the session expired": it asks Firebase for a fresh ID token, exchanges it at /auth/exchange and retries the request once,
// and when that fails it clears the session and sends the person to /login. That is wrong for the exchange ITSELF. A 401 from it is its answer (a refusal and
// the code that says why), not an expired session, and the refresh calls the exchange too, so a refusal there used to wait on itself and never settle.

const { getIdToken, signOut, firebaseAuth } = vi.hoisted(() => {
  const getIdToken = vi.fn()
  return { getIdToken, signOut: vi.fn(), firebaseAuth: { currentUser: { getIdToken } } }
})
vi.mock('@/lib/firebase', () => ({ auth: firebaseAuth, devAuthEnabled: false }))
vi.mock('firebase/auth', () => ({ signOut }))

type Client = typeof import('./client')

type Answer = { status: number; data: unknown }

/**
 * Answers each request, recording what was asked: from `answers` in order, or from a function that sees the request (the real server refuses the
 * same token every time it is asked). A status of 400 or more is an HTTP error, as axios makes it.
 */
function script(client: Client, answers: Answer[] | ((url: string) => Answer)) {
  const requests: Array<{ url: string; authorization?: string }> = []
  client.apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    const answer = typeof answers === 'function' ? answers(String(config.url)) : answers[requests.length]
    requests.push({ url: String(config.url), authorization: config.headers?.Authorization as string | undefined })
    if (!answer) return Promise.reject(new Error(`no answer scripted for request ${requests.length} (${config.url})`))
    const response = { data: answer.data, status: answer.status, statusText: String(answer.status), headers: {}, config }
    return answer.status < 400
      ? Promise.resolve(response)
      : Promise.reject(new AxiosError(`Request failed with status code ${answer.status}`, 'ERR_BAD_REQUEST', config, null, response))
  }
  return requests
}

/** Whatever the promise does within `ms`, as text: a promise that never settles shows as HUNG instead of timing the test out. */
const outcome = (promise: Promise<unknown>, ms = 1000) =>
  Promise.race([
    promise.then(
      () => 'RESOLVED',
      (err: { response?: { status?: number; data?: { code?: string } } }) => `REJECTED ${err.response?.status} ${err.response?.data?.code ?? ''}`.trim(),
    ),
    new Promise<string>(resolve => setTimeout(() => resolve('HUNG'), ms)),
  ])

const refusal = (code: string) => ({ status: 401, data: { success: false, errors: ['x'], code } })

async function freshClient(): Promise<Client> {
  vi.resetModules()
  return import('./client')
}

beforeEach(() => {
  getIdToken.mockReset().mockResolvedValue('fresh-id-token')
  signOut.mockReset().mockResolvedValue(undefined)
  localStorage.clear()
})
afterEach(() => localStorage.clear())

describe('the exchange answering 401', () => {
  it('is passed on as it is, with its code, after one request: no refresh, no second exchange, no sign-out', async () => {
    const client = await freshClient()
    localStorage.setItem('odip_token', 'a-session')
    const requests = script(client, () => refusal('EmailNotVerified'))

    const result = await outcome(client.apiPostRaw('/auth/exchange', { idToken: 'the-id-token' }))

    expect(result).toBe('REJECTED 401 EmailNotVerified')
    expect(requests.map(r => r.url)).toEqual(['/auth/exchange'])
    expect(getIdToken).not.toHaveBeenCalled()
    expect(localStorage.getItem('odip_token')).toBe('a-session')
  })

  it('does the same for every code the sign-in page can show', async () => {
    for (const code of ['NoOdipAccount', 'TenantInactive', 'ProviderNotAllowed', 'Ambiguous', 'InvalidToken']) {
      const client = await freshClient()
      script(client, () => refusal(code))

      expect(await outcome(client.apiPostRaw('/auth/exchange', { idToken: 'x' }))).toBe(`REJECTED 401 ${code}`)
    }
  })

  it('keeps a 429 as it is too, with the headers the sign-in page reads the wait from', async () => {
    const client = await freshClient()
    const requests = script(client, [{ status: 429, data: { success: false, errors: ['x'], code: 'LockedOut' } }])

    expect(await outcome(client.apiPostRaw('/auth/exchange', { idToken: 'x' }))).toBe('REJECTED 429 LockedOut')
    expect(requests).toHaveLength(1)
  })
})

describe('a 401 on any other request', () => {
  it('still refreshes the session once and retries with the new token', async () => {
    const client = await freshClient()
    localStorage.setItem('odip_token', 'the-old-token')
    const requests = script(client, [
      { status: 401, data: {} },
      { status: 200, data: { success: true, data: { token: 'the-new-token' } } },
      { status: 200, data: { success: true, data: ['a participant'] } },
    ])

    const participants = await client.apiGet<string[]>('/participants')

    expect(participants).toEqual(['a participant'])
    expect(requests.map(r => r.url)).toEqual(['/participants', '/auth/exchange', '/participants'])
    expect(requests[2].authorization).toBe('Bearer the-new-token')
    expect(localStorage.getItem('odip_token')).toBe('the-new-token')
  })

  it('fails and clears the session when the refresh is refused (a tenant switched off mid-session), instead of waiting on itself', async () => {
    const client = await freshClient()
    // Signing out sets location.href, which jsdom reports as "not implemented: navigation"; that is the redirect to /login, so keep it out of the output.
    const jsdomNoise = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      localStorage.setItem('odip_token', 'the-old-token')
      localStorage.setItem('odip_user', '{}')
      // The same refusal every time the exchange is asked, as a real server gives it; the sign-out also posts /auth/logout, and its own 401 is ignored.
      script(client, url => (url === '/auth/exchange' ? refusal('TenantInactive') : { status: 401, data: {} }))

      const result = await outcome(client.apiGet('/participants'))

      expect(result).toBe('REJECTED 401')
      expect(localStorage.getItem('odip_token')).toBeNull()
      expect(localStorage.getItem('odip_user')).toBeNull()
    } finally {
      jsdomNoise.mockRestore()
    }
  })
})

// Sign-in sets a 7-day cookie that the API accepts when no token is sent, and only POST /auth/logout deletes it. The Sign Out button used to clear the browser
// keys and leave both the cookie and the Firebase user behind. endSession is the one way out: the button and the expired-session path both use it.
describe('endSession', () => {
  const KEYS = ['odip_token', 'odip_user', 'odip_viewing_tenant', 'odip_viewing_user', 'odip_superadmin_user']

  // Signing out sets location.href, which jsdom reports as "not implemented: navigation"; that is the redirect to /login, so keep it out of the output.
  async function endSessionWith(answers: Parameters<typeof script>[1]) {
    const client = await freshClient()
    const jsdomNoise = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const key of KEYS) localStorage.setItem(key, 'x')
      localStorage.setItem('odip_token', 'a-session')
      const requests = script(client, answers)
      await client.endSession()
      return requests
    } finally {
      jsdomNoise.mockRestore()
    }
  }

  it('asks the server to drop the cookie while the token is still sent, ends the Firebase session, then clears every key', async () => {
    const requests = await endSessionWith(() => ({ status: 200, data: { success: true } }))

    expect(requests).toEqual([{ url: '/auth/logout', authorization: 'Bearer a-session' }])
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledWith(firebaseAuth)
    for (const key of KEYS) expect(localStorage.getItem(key), key).toBeNull()
  })

  it('still ends the Firebase session and clears the keys when the server cannot be reached', async () => {
    await endSessionWith(() => ({ status: 500, data: {} }))

    expect(signOut).toHaveBeenCalledTimes(1)
    for (const key of KEYS) expect(localStorage.getItem(key), key).toBeNull()
  })

  it('still clears the keys when Firebase refuses to sign out', async () => {
    signOut.mockRejectedValue(new Error('network'))

    await endSessionWith(() => ({ status: 200, data: { success: true } }))

    for (const key of KEYS) expect(localStorage.getItem(key), key).toBeNull()
  })

  it('is what an expired session ends with: a refused refresh also posts the logout and signs out of Firebase', async () => {
    const client = await freshClient()
    const jsdomNoise = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      localStorage.setItem('odip_token', 'the-old-token')
      const requests = script(client, url => (url === '/auth/exchange' ? refusal('TenantInactive') : { status: 401, data: {} }))

      await outcome(client.apiGet('/participants'))

      expect(requests.map(r => r.url)).toContain('/auth/logout')
      expect(signOut).toHaveBeenCalledTimes(1)
    } finally {
      jsdomNoise.mockRestore()
    }
  })
})
