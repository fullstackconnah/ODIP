import { beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()
vi.mock('@/api/client', () => ({ apiClient: { post: (...a: unknown[]) => post(...a) } }))

import { reportClientError, resetClientErrorReports } from './reportClientError'

describe('reportClientError', () => {
  beforeEach(() => {
    post.mockReset()
    post.mockResolvedValue({})
    resetClientErrorReports()
    localStorage.setItem('odip_token', 't')
    window.history.pushState({}, '', '/schedule?participant=abc#x')
  })

  it('posts the message, stacks, kind and a path without the query string', () => {
    reportClientError('boundary', new Error('boom'), 'in Foo')
    expect(post).toHaveBeenCalledTimes(1)
    const [url, body] = post.mock.calls[0]
    expect(url).toBe('/client-errors')
    expect(body).toMatchObject({ message: 'boom', kind: 'boundary', componentStack: 'in Foo', path: '/schedule' })
    expect(JSON.stringify(body)).not.toContain('participant=abc')
  })

  it('sends the same message once', () => {
    reportClientError('error', new Error('same'))
    reportClientError('rejection', new Error('same'))
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('sends at most five reports per page load', () => {
    for (let i = 0; i < 8; i++) reportClientError('error', new Error(`e${i}`))
    expect(post).toHaveBeenCalledTimes(5)
  })

  it('takes a non-Error reason', () => {
    reportClientError('rejection', 'plain string')
    expect(post.mock.calls[0][1]).toMatchObject({ message: 'plain string' })
  })

  it('does nothing when not signed in', () => {
    localStorage.removeItem('odip_token')
    reportClientError('error', new Error('x'))
    expect(post).not.toHaveBeenCalled()
  })

  it('swallows a failing post, sync or async', async () => {
    post.mockRejectedValueOnce(new Error('network'))
    expect(() => reportClientError('error', new Error('a'))).not.toThrow()
    post.mockImplementationOnce(() => { throw new Error('sync') })
    expect(() => reportClientError('error', new Error('b'))).not.toThrow()
    await Promise.resolve()
  })
})
