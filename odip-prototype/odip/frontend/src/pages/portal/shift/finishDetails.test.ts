import { describe, it, expect } from 'vitest'
import type { PortalShiftDetailDto, ShiftCompletionDto } from '@/api/types'
import { buildDetails, effectiveEnd, missingNow, tappedEnd } from './finishDetails'
import { EMPTY_END_DRAFT, endDraftFromServer, type EndDraft } from './endDraft'

// Brisbane is UTC+10 all year. Rostered 09:00 to 17:00; started 09:05:40 local; tapped End shift at 17:00:30 local.
const completion = (over: Partial<ShiftCompletionDto> = {}) => ({
  actualStart: '2026-08-16T23:05:40Z', actualEnd: '2026-08-17T07:00:30Z', originalActualStart: null, originalActualEnd: null, timeAdjustmentReason: null,
  startTimeReason: null, finishTimeReason: null, kilometres: null, anythingToReport: null, handoverText: null, nothingToHandOver: false, nothingToNoteConfirmed: false,
  preTravelNone: false, postTravelNone: false, missingDetails: ['kilometres'], ...over,
}) as unknown as ShiftCompletionDto

const shift = (over: Partial<PortalShiftDetailDto> = {}, c: Partial<ShiftCompletionDto> = {}) => ({
  id: 's1', status: 'PendingReview', timeZoneId: 'Australia/Brisbane', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
  travelAsked: true, breaks: [], completion: completion(c), ...over,
}) as unknown as PortalShiftDetailDto

const typed = (over: Partial<EndDraft> = {}): EndDraft => ({ ...EMPTY_END_DRAFT, touched: true, ...over })

describe('buildDetails: what the PUT carries', () => {
  it('Deep N2: changing only the handover resends the saved start, reasons and end unchanged', () => {
    const s = shift({}, { startTimeReason: 'Traffic on the bridge', finishTimeReason: 'Waited for the taxi', kilometres: 12, anythingToReport: false, nothingToNoteConfirmed: true })
    const body = buildDetails(s, { ...endDraftFromServer(s.completion), touched: true, handoverText: 'All settled' }, 0)
    expect(body).toMatchObject({
      actualStart: '2026-08-16T23:05:40Z', actualEnd: null, startTimeReason: 'Traffic on the bridge', finishTimeReason: 'Waited for the taxi',
      kilometres: 12, handoverText: 'All settled', nothingToNote: true, anythingToReport: false,
    })
  })

  it('a finish the worker moved earlier is resent as saved, with its reason', () => {
    const s = shift({}, { actualEnd: '2026-08-17T06:50:00Z', originalActualEnd: '2026-08-17T07:00:30Z', timeAdjustmentReason: 'Left early' })
    const body = buildDetails(s, { ...endDraftFromServer(s.completion), touched: true }, 1)
    expect(body).toMatchObject({ actualEnd: '2026-08-17T06:50:00Z', timeAdjustmentReason: 'Left early' })
    expect(tappedEnd(s, EMPTY_END_DRAFT)?.toISOString()).toBe('2026-08-17T07:00:30.000Z')
    expect(effectiveEnd(s, EMPTY_END_DRAFT)?.toISOString()).toBe('2026-08-17T06:50:00.000Z')
  })

  it('a changed end is sent as an instant with its reason; the tapped minute restores the tap (null)', () => {
    const s = shift()
    expect(buildDetails(s, typed({ endOverride: '2026-08-17T16:50', adjustmentReason: ' Left early ' }), 1))
      .toMatchObject({ actualEnd: '2026-08-17T06:50:00Z', timeAdjustmentReason: 'Left early' })
    expect(buildDetails(s, typed({ endOverride: '2026-08-17T17:00', adjustmentReason: 'stale' }), 1))
      .toMatchObject({ actualEnd: null, timeAdjustmentReason: null })
  })

  it('No trip stores both values empty and counts as answered; travel not asked sends no leg at all', () => {
    const s = shift()
    expect(buildDetails(s, typed({ preTravelNone: true, preTravelMinutes: '20', preTravelKilometres: '5', postTravelMinutes: '15', postTravelKilometres: '6' }), 1)).toMatchObject({
      preTravelNone: true, preShiftTravelMinutes: null, preShiftTravelKilometres: null, postTravelNone: false, postShiftTravelMinutes: 15, postShiftTravelKilometres: 6,
    })
    expect(buildDetails(shift({ travelAsked: false }), typed({ preTravelMinutes: '20', preTravelKilometres: '5', preTravelNone: true }), 1)).toMatchObject({
      preTravelNone: false, preShiftTravelMinutes: null, postShiftTravelKilometres: null,
    })
  })

  it('blank kilometres are null, a typed zero is zero; a blank handover is null and Nothing to hand over clears it', () => {
    expect(buildDetails(shift(), typed({ kilometres: '' }), 0).kilometres).toBeNull()
    expect(buildDetails(shift(), typed({ kilometres: '0' }), 0).kilometres).toBe(0)
    expect(buildDetails(shift(), typed({ handoverText: '   ' }), 0).handoverText).toBeNull()
    expect(buildDetails(shift(), typed({ handoverText: 'typed', nothingToHandOver: true }), 0)).toMatchObject({ handoverText: null, nothingToHandOver: true })
  })

  it('Nothing to note counts only while there are no notes', () => {
    expect(buildDetails(shift(), typed({ nothingToNote: true }), 0).nothingToNote).toBe(true)
    expect(buildDetails(shift(), typed({ nothingToNote: true }), 2).nothingToNote).toBe(false)
  })
})

describe('missingNow: the live list, in the server order', () => {
  const none = { ...EMPTY_END_DRAFT, touched: true }
  it('lists everything unanswered; travel is skipped when not asked', () => {
    expect(missingNow(shift(), none, 0)).toEqual(['kilometres', 'tripTo', 'tripAfter', 'notes', 'handover', 'report'])
    expect(missingNow(shift({ travelAsked: false }), none, 1)).toEqual(['kilometres', 'handover', 'report'])
  })
  it('No trip, a typed zero, Nothing to note and Nothing to hand over each count as answered', () => {
    const d = typed({ preTravelNone: true, postTravelNone: true, kilometres: '0', nothingToNote: true, nothingToHandOver: true, anythingToReport: 'no' })
    expect(missingNow(shift(), d, 0)).toEqual([])
  })
})
