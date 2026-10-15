import { describe, it, expect, afterEach, vi } from 'vitest'
import { clearEndDraft, EMPTY_END_DRAFT, loadEndDraft, saveEndDraft, type EndDraft } from './endDraft'

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

const full: EndDraft = {
  step: 'report', reached: 'report', startOverride: null, endOverride: '2026-08-17T16:50', adjustmentReason: 'Left early', kilometres: '12.5',
  anythingToReport: 'yes', handoverText: 'hi', nothingToNote: true, nothingToHandOver: false, timesSig: 'x',
}

describe('endDraft', () => {
  it('round-trips per shift and clears', () => {
    saveEndDraft('s1', full)
    expect(loadEndDraft('s1')).toEqual(full)
    expect(loadEndDraft('s2')).toBeNull()
    clearEndDraft('s1')
    expect(loadEndDraft('s1')).toBeNull()
  })
  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadEndDraft('s1')).toBeNull()
    expect(() => saveEndDraft('s1', full)).not.toThrow()
  })
  it('loads a draft saved before the redesign closed, keeping its handover (Review Focus 4)', () => {
    sessionStorage.setItem('odip-shift-end-draft:s1', JSON.stringify({ handoverText: 'Half written', nothingToNote: true, nothingToHandOver: false, confirmedSig: 'x' }))
    expect(loadEndDraft('s1')).toEqual({ ...EMPTY_END_DRAFT, handoverText: 'Half written', nothingToNote: true })
  })
  it('drops values of the wrong type instead of trusting them', () => {
    sessionStorage.setItem('odip-shift-end-draft:s1', JSON.stringify({ step: 'bogus', reached: 3, anythingToReport: 'maybe', kilometres: 12, startOverride: 9 }))
    expect(loadEndDraft('s1')).toEqual(EMPTY_END_DRAFT)
    sessionStorage.setItem('odip-shift-end-draft:s1', 'null')
    expect(loadEndDraft('s1')).toBeNull()
  })
})
