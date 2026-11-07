import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OFFLINE_PREFIX, readSaved, readSession, sweepExpired, unsentOnDevice, wipeOffline, writeSaved } from './store'

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
    sessionStorage.setItem('odip_viewing_user', 'them')
    sessionStorage.setItem('odip_viewing_tenant', 't9')
    expect(readSession()).toEqual({ userId: 'them', viewAsTenant: 't9', viewAsUser: 'them' })
  })

  it('sweepExpired removes saved copies past 48h that were never read, and keeps fresh copies, the queue and the lease', () => {
    writeSaved('u1', 'detail:old', { a: 1 })
    localStorage.setItem(`${OFFLINE_PREFIX}u1:queue`, '[{"id":"r1"}]')
    localStorage.setItem(`${OFFLINE_PREFIX}u1:replay-lock`, '1')
    localStorage.setItem('unrelated', 'x')
    vi.setSystemTime(Date.now() + 49 * H)
    writeSaved('u1', 'detail:fresh', { b: 2 })
    sweepExpired()
    expect(localStorage.getItem(`${OFFLINE_PREFIX}u1:detail:old`)).toBeNull()
    expect(readSaved('u1', 'detail:fresh')?.data).toEqual({ b: 2 })
    expect(localStorage.getItem(`${OFFLINE_PREFIX}u1:queue`)).toBe('[{"id":"r1"}]')
    expect(localStorage.getItem(`${OFFLINE_PREFIX}u1:replay-lock`)).toBe('1')
    expect(localStorage.getItem('unrelated')).toBe('x')
  })

  describe('unsentOnDevice', () => {
    it('is 0 and nameless on empty storage', () => {
      expect(unsentOnDevice()).toEqual({ count: 0, firstName: null })
    })

    it('counts another worker’s queue and returns the first name kept with it', () => {
      localStorage.setItem(`${OFFLINE_PREFIX}u1:queue`, JSON.stringify([{ id: 'a', ownerFirstName: 'Asha' }, { id: 'b', ownerFirstName: 'Asha' }]))
      localStorage.setItem(`${OFFLINE_PREFIX}u2:detail:s1`, JSON.stringify({ savedAt: 1, data: {} }))
      expect(unsentOnDevice()).toEqual({ count: 2, firstName: 'Asha' })
    })

    it('counts records from an older build with no name as nameless', () => {
      localStorage.setItem(`${OFFLINE_PREFIX}u1:queue`, JSON.stringify([{ id: 'a' }]))
      expect(unsentOnDevice()).toEqual({ count: 1, firstName: null })
    })

    it('counts malformed JSON as 0 and does not throw', () => {
      localStorage.setItem(`${OFFLINE_PREFIX}u1:queue`, '{not json')
      localStorage.setItem(`${OFFLINE_PREFIX}u2:queue`, '{"a":1}')
      expect(unsentOnDevice()).toEqual({ count: 0, firstName: null })
    })
  })
})
