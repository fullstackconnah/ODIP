import { describe, it, expect, afterEach, vi } from 'vitest'
import { clearEndDraft, loadEndDraft, saveEndDraft } from './endDraft'

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

describe('endDraft', () => {
  it('round-trips per shift and clears', () => {
    saveEndDraft('s1', { handoverText: 'hi', nothingToNote: true, nothingToHandOver: false, confirmedSig: 'x' })
    expect(loadEndDraft('s1')).toEqual({ handoverText: 'hi', nothingToNote: true, nothingToHandOver: false, confirmedSig: 'x' })
    expect(loadEndDraft('s2')).toBeNull()
    clearEndDraft('s1')
    expect(loadEndDraft('s1')).toBeNull()
  })
  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadEndDraft('s1')).toBeNull()
    expect(() => saveEndDraft('s1', { handoverText: '', nothingToNote: false, nothingToHandOver: false, confirmedSig: null })).not.toThrow()
  })
})
