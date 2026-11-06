import { describe, it, expect, afterEach, vi } from 'vitest'
import { clearEndDraft, EMPTY_END_DRAFT, endDraftFromServer, loadEndDraft, saveEndDraft, type EndDraft } from './endDraft'
import type { ShiftCompletionDto } from '@/api/types'

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

const full: EndDraft = {
  open: true, tappedAt: '2026-08-17T07:00:30Z', touched: true, startOverride: null, endOverride: '2026-08-17T16:50', adjustmentReason: 'Left early', timeReason: 'Waited for the taxi', kilometres: '12.5',
  preTravelMinutes: '25', preTravelKilometres: '12.3', postTravelMinutes: '20', postTravelKilometres: '10', preTravelNone: false, postTravelNone: true,
  anythingToReport: 'yes', handoverText: 'hi', nothingToNote: true, nothingToHandOver: false,
}

describe('endDraft', () => {
  it('round-trips per shift and clears', () => {
    saveEndDraft('s1', full)
    expect(loadEndDraft('s1')).toEqual(full)
    expect(loadEndDraft('s2')).toBeNull()
    clearEndDraft('s1')
    expect(loadEndDraft('s1')).toBeNull()
  })
  it('keeps the tap across a reload, so the end stays the tap (offline / dose block)', () => {
    saveEndDraft('s1', { ...EMPTY_END_DRAFT, open: true, tappedAt: '2026-08-17T07:00:30Z' })
    expect(loadEndDraft('s1')).toMatchObject({ open: true, tappedAt: '2026-08-17T07:00:30Z', touched: false })
  })
  it('loads a draft saved by an older build with the new fields empty', () => {
    sessionStorage.setItem('odip-shift-end-draft:s1', JSON.stringify({ kilometres: '5', preTravelMinutes: 25, postTravelKilometres: '10', step: 'report' }))
    expect(loadEndDraft('s1')).toEqual({ ...EMPTY_END_DRAFT, kilometres: '5', postTravelKilometres: '10' })
  })
  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadEndDraft('s1')).toBeNull()
    expect(() => saveEndDraft('s1', full)).not.toThrow()
  })
  it('drops values of the wrong type instead of trusting them', () => {
    sessionStorage.setItem('odip-shift-end-draft:s1', JSON.stringify({ open: 'yes', tappedAt: 5, anythingToReport: 'maybe', kilometres: 12, startOverride: 9, preTravelNone: 1 }))
    expect(loadEndDraft('s1')).toEqual(EMPTY_END_DRAFT)
    sessionStorage.setItem('odip-shift-end-draft:s1', 'null')
    expect(loadEndDraft('s1')).toBeNull()
  })
})

describe('endDraftFromServer (the saved answers a worker sees when they come back)', () => {
  const saved = {
    kilometres: 12.5, preShiftTravelMinutes: 20, preShiftTravelKilometres: 8.2, postShiftTravelMinutes: null, postShiftTravelKilometres: null,
    preTravelNone: false, postTravelNone: true, anythingToReport: false, handoverText: 'All settled', nothingToHandOver: false, nothingToNoteConfirmed: true,
    finishTimeReason: 'Waited for the taxi', timeAdjustmentReason: 'Left early',
  } as unknown as ShiftCompletionDto

  it('reads every saved answer as the field the worker would have typed', () => {
    expect(endDraftFromServer(saved)).toEqual({
      ...EMPTY_END_DRAFT, kilometres: '12.5', preTravelMinutes: '20', preTravelKilometres: '8.2', postTravelNone: true, anythingToReport: 'no',
      handoverText: 'All settled', nothingToNote: true, timeReason: 'Waited for the taxi', adjustmentReason: 'Left early',
    })
  })
  it('keeps an unanswered question unanswered, and a zero a zero', () => {
    const d = endDraftFromServer({ ...saved, kilometres: 0, anythingToReport: null, handoverText: null } as unknown as ShiftCompletionDto)
    expect(d).toMatchObject({ kilometres: '0', anythingToReport: null, handoverText: '' })
  })
  it('is the empty draft when there is no completion', () => {
    expect(endDraftFromServer(null)).toEqual(EMPTY_END_DRAFT)
  })
})
