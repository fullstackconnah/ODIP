// What the finish page sends and checks, as pure functions of the shift and the worker's entries. The PUT replaces every detail as a whole,
// so a save resends the saved start, reasons and end unchanged unless the worker edited them (Deep N2).
import type { FinishDetailsDto, PortalShiftDetailDto } from '@/api/types'
import { missingDetails, movedTimes, parseKilometres, parseTravelMinutes, type DetailKey, type DetailsForm, type TimesInput } from './checklist'
import { timeQuestions, type EndDraft } from './endDraft'
import { providerLocalToUtcInstant } from './shiftTime'

/** An older tap than this is not sent as `endTappedAt` (the server refuses taps over 30 minutes old online); the server clock is then the end. */
export const MAX_TAP_AGE_MS = 25 * 60_000

/** Whether a tap is recent enough to send as the end. */
export const tapIsFresh = (iso: string | null | undefined, now = Date.now()) => !!iso && now - Date.parse(iso) <= MAX_TAP_AGE_MS

/** When the worker tapped End shift: the server's stamp once the shift is ended (the original when the finish was moved), else the draft's tap. */
export function tappedEnd(shift: PortalShiftDetailDto, d: EndDraft): Date | null {
  const c = shift.completion
  const iso = c?.originalActualEnd ?? c?.actualEnd ?? d.tappedAt
  return iso ? new Date(iso) : null
}

/** The finish as it stands: the worker's typed time, else the one saved earlier, else the tap. */
export function effectiveEnd(shift: PortalShiftDetailDto, d: EndDraft): Date | null {
  const c = shift.completion
  const typed = d.endOverride ? providerLocalToUtcInstant(d.endOverride, shift.timeZoneId) : null
  const iso = typed ?? (c?.originalActualEnd ? c.actualEnd : null)
  return iso ? new Date(iso) : tappedEnd(shift, d)
}

export function timesInput(shift: PortalShiftDetailDto, d: EndDraft): TimesInput | null {
  const tapped = tappedEnd(shift, d)
  const c = shift.completion
  if (!c || !tapped) return null
  return {
    tz: shift.timeZoneId, stampedStart: c.originalActualStart ?? c.actualStart, tappedEnd: tapped, startOverride: d.startOverride, endOverride: d.endOverride,
    reason: d.adjustmentReason, kilometres: d.kilometres, breaks: shift.breaks,
    // Travel is checked only when the organisation asks for it; a stale draft value is never sent or blocking.
    ...(shift.travelAsked && !d.preTravelNone && { preTravelMinutes: d.preTravelMinutes, preTravelKilometres: d.preTravelKilometres }),
    ...(shift.travelAsked && !d.postTravelNone && { postTravelMinutes: d.postTravelMinutes, postTravelKilometres: d.postTravelKilometres }),
  }
}

const valid = <T>(v: T | 'invalid'): T | null => (v === 'invalid' ? null : v)

/** The unsaved form, as the same facts the server counts (`ShiftDetailsFacts`). */
export function detailsForm(d: EndDraft, noteCount: number): DetailsForm {
  return {
    kilometres: valid(parseKilometres(d.kilometres)),
    preMinutes: valid(parseTravelMinutes(d.preTravelMinutes)), preKm: valid(parseKilometres(d.preTravelKilometres)), preNone: d.preTravelNone,
    postMinutes: valid(parseTravelMinutes(d.postTravelMinutes)), postKm: valid(parseKilometres(d.postTravelKilometres)), postNone: d.postTravelNone,
    handoverText: d.handoverText, nothingToHandOver: d.nothingToHandOver,
    nothingToNote: noteCount === 0 && d.nothingToNote,
    anythingToReport: d.anythingToReport === null ? null : d.anythingToReport === 'yes',
  }
}

export function missingNow(shift: PortalShiftDetailDto, d: EndDraft, noteCount: number): DetailKey[] {
  return missingDetails(detailsForm(d, noteCount), { travelAsked: !!shift.travelAsked, hasNote: noteCount > 0 })
}

export function buildDetails(shift: PortalShiftDetailDto, d: EndDraft, noteCount: number): FinishDetailsDto {
  const c = shift.completion
  const input = timesInput(shift, d)
  const moved = input ? movedTimes(input) : { start: null, end: null }
  // A time the worker left alone is sent as the server has it; one they touched is sent only if it really moved (null restores the stamp or the tap).
  const actualStart = d.startOverride !== null ? moved.start : c?.actualStart ?? null
  const actualEnd = d.endOverride !== null ? moved.end : c?.originalActualEnd ? c.actualEnd : null
  const startMoved = actualStart !== null && (d.startOverride !== null || !!c?.originalActualStart)
  const timeReason = d.timeReason.trim()
  const end = effectiveEnd(shift, d)
  const asksStart = end ? timeQuestions(shift, d, end).start !== null : false
  const f = detailsForm(d, noteCount)
  const legs = !!shift.travelAsked
  return {
    actualStart,
    actualEnd,
    timeAdjustmentReason: startMoved || actualEnd !== null ? d.adjustmentReason.trim() || null : null,
    startTimeReason: timeReason && asksStart ? timeReason : c?.startTimeReason ?? null,
    finishTimeReason: timeReason || null,
    kilometres: f.kilometres,
    preShiftTravelMinutes: legs && !d.preTravelNone ? f.preMinutes : null,
    preShiftTravelKilometres: legs && !d.preTravelNone ? f.preKm : null,
    postShiftTravelMinutes: legs && !d.postTravelNone ? f.postMinutes : null,
    postShiftTravelKilometres: legs && !d.postTravelNone ? f.postKm : null,
    preTravelNone: legs && d.preTravelNone,
    postTravelNone: legs && d.postTravelNone,
    handoverText: d.nothingToHandOver ? null : d.handoverText.trim() || null,
    nothingToHandOver: d.nothingToHandOver,
    nothingToNote: f.nothingToNote,
    anythingToReport: f.anythingToReport,
  }
}
