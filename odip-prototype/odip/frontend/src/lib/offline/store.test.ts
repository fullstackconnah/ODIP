import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OFFLINE_PREFIX, readSaved, readSession, wipeOffline, writeSaved } from './store'

const H = 3_600_000

describe('offline store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T00:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('returns a saved copy 47h59m old and drops one 48h01m old, deleting it on read', () => {
    writeSaved('u1', 'detail:s1', { a: 1 })
    vi.setSystemTime(Date.now() + 48 * H - 60_000)
    expect(readSaved('u1', 'detail:s1')?.data).toEqual({ a: 1 })
    vi.setSystemTime(Date.now() + 2 * 60_000)
    expect(readSaved('u1', 'detail:s1')).toBeNull()
    expect(localStorage.getItem(`${OFFLINE_PREFIX}u1:detail:s1`)).toBeNull()
  })

  it('reports when it was saved', () => {
    writeSaved('u1', 'shifts:a:b', [1])
    expect(readSaved('u1', 'shifts:a:b')?.savedAt).toBe(Date.parse('2026-10-27T00:00:00Z'))
  })

  it('never throws when storage throws', () => {
    const boom = () => { throw new Error('denied') }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom)
    expect(() => writeSaved('u1', 'x', 1)).not.toThrow()
    expect(readSaved('u1', 'x')).toBeNull()
    expect(() => wipeOffline({})).not.toThrow()
    expect(readSession().userId).toBeNull()
    vi.restoreAllMocks()
  })

  it('wipeOffline clears only odip_offline keys, and keeps the queue when asked', () => {
    localStorage.setItem('odip_token', 't')
    writeSaved('u1', 'detail:s1', 1)
    localStorage.setItem(`${OFFLINE_PREFIX}u1:queue`, '[]')
    wipeOffline({ keepQueue: true })
    expect(localStorage.getItem('odip_token')).toBe('t')
    expect(localStorage.getItem(`${OFFLINE_PREFIX}u1:detail:s1`)).toBeNull()
    expect(localStorage.getItem(`${OFFLINE_PREFIX}u1:queue`)).toBe('[]')
    wipeOffline({})
    expect(localStorage.getItem(`${OFFLINE_PREFIX}u1:queue`)).toBeNull()
    expect(localStorage.getItem('odip_token')).toBe('t')
  })

  it('wipeOffline exceptUser keeps that user and removes the others', () => {
    writeSaved('u1', 'detail:s1', 1)
    writeSaved('u2', 'detail:s1', 2)
    wipeOffline({ exceptUser: 'u1' })
    expect(readSaved('u1', 'detail:s1')?.data).toBe(1)
    expect(readSaved('u2', 'detail:s1')).toBeNull()
  })

  it('the session is the effective user: the viewed user when set, else the signed-in one', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'me' }))
    expect(readSession()).toEqual({ userId: 'me', viewAsTenant: null, viewAsUser: null })
    localStorage.setItem('odip_viewing_user', 'them')
    localStorage.setItem('odip_viewing_tenant', 't9')
    expect(readSession()).toEqual({ userId: 'them', viewAsTenant: 't9', viewAsUser: 'them' })
  })
})
