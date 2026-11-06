// The finish page's entries survive leaving the page (Yes on "Anything to report?" opens the incident form; a reload; Back to shift) in
// sessionStorage, per shift. Every access is wrapped: storage can be missing or throw (private window, blocked site data), and the flow
// must work without it. Every field is type-checked on load, so a draft from an older build loads closed instead of breaking.
import type { PortalShiftDetailDto, ShiftCompletionDto } from '@/api/types'
import { offRosterMinutes, rosteredInstants } from '../lib/portal'
import { providerLocalToUtcInstant } from './shiftTime'

export interface EndDraft {
  /** Whether the finish page is open: false while the worker is back on the shift. */
  open: boolean
  /** When the worker tapped End shift (an instant). Kept across a dose block, so the end stays the tap and not the moment the dose was recorded. */
  tappedAt: string | null
  /** Whether the worker has typed anything since the page opened: an untouched draft shows what the server has saved instead. */
  touched: boolean
  /** The worker's start and finish, provider-local "yyyy-MM-ddTHH:mm", or null for the recorded time. */
  startOverride: string | null
  endOverride: string | null
  adjustmentReason: string
  /** The one optional box that explains an off-roster start and/or finish (W2). */
  timeReason: string
  /** The kilometre field as typed. */
  kilometres: string
  /** The four provider-travel fields as typed: the trip to the participant, then the trip after the shift. */
  preTravelMinutes: string
  preTravelKilometres: string
  postTravelMinutes: string
  postTravelKilometres: string
  /** "No trip" ticked: the leg is answered with nothing. */
  preTravelNone: boolean
  postTravelNone: boolean
  anythingToReport: 'yes' | 'no' | null
  handoverText: string
  nothingToNote: boolean
  nothingToHandOver: boolean
}

export const EMPTY_END_DRAFT: EndDraft = {
  open: false, tappedAt: null, touched: false, startOverride: null, endOverride: null, adjustmentReason: '', timeReason: '', kilometres: '',
  preTravelMinutes: '', preTravelKilometres: '', postTravelMinutes: '', postTravelKilometres: '', preTravelNone: false, postTravelNone: false,
  anythingToReport: null, handoverText: '', nothingToNote: false, nothingToHandOver: false,
}

const key = (shiftId: string) => `odip-shift-end-draft:${shiftId}`
const text = (v: unknown) => (typeof v === 'string' ? v : '')
const textOrNull = (v: unknown) => (typeof v === 'string' ? v : null)

export function loadEndDraft(shiftId: string): EndDraft | null {
  try {
    const raw = sessionStorage.getItem(key(shiftId))
    if (!raw) return null
    const d = JSON.parse(raw) as Record<string, unknown>
    return {
      open: d.open === true,
      tappedAt: textOrNull(d.tappedAt),
      touched: d.touched === true,
      startOverride: textOrNull(d.startOverride),
      endOverride: textOrNull(d.endOverride),
      adjustmentReason: text(d.adjustmentReason),
      timeReason: text(d.timeReason),
      kilometres: text(d.kilometres),
      preTravelMinutes: text(d.preTravelMinutes),
      preTravelKilometres: text(d.preTravelKilometres),
      postTravelMinutes: text(d.postTravelMinutes),
      postTravelKilometres: text(d.postTravelKilometres),
      preTravelNone: d.preTravelNone === true,
      postTravelNone: d.postTravelNone === true,
      anythingToReport: d.anythingToReport === 'yes' || d.anythingToReport === 'no' ? d.anythingToReport : null,
      handoverText: text(d.handoverText),
      nothingToNote: d.nothingToNote === true,
      nothingToHandOver: d.nothingToHandOver === true,
    }
  } catch {
    return null
  }
}

export function saveEndDraft(shiftId: string, draft: EndDraft): void {
  try { sessionStorage.setItem(key(shiftId), JSON.stringify(draft)) } catch { /* no storage: the draft just does not survive */ }
}

export function clearEndDraft(shiftId: string): void {
  try { sessionStorage.removeItem(key(shiftId)) } catch { /* nothing to clear */ }
}

const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

/** What the server has saved for the shift, as the page's fields: a worker coming back to add the rest sees their earlier answers, not blanks. */
export function endDraftFromServer(c: ShiftCompletionDto | null | undefined): EndDraft {
  if (!c) return EMPTY_END_DRAFT
  return {
    ...EMPTY_END_DRAFT,
    timeReason: c.finishTimeReason ?? '',
    adjustmentReason: c.timeAdjustmentReason ?? '',
    kilometres: num(c.kilometres),
    preTravelMinutes: num(c.preShiftTravelMinutes), preTravelKilometres: num(c.preShiftTravelKilometres),
    postTravelMinutes: num(c.postShiftTravelMinutes), postTravelKilometres: num(c.postShiftTravelKilometres),
    preTravelNone: c.preTravelNone, postTravelNone: c.postTravelNone,
    anythingToReport: c.anythingToReport === null ? null : c.anythingToReport ? 'yes' : 'no',
    handoverText: c.handoverText ?? '',
    nothingToHandOver: c.nothingToHandOver,
    nothingToNote: c.nothingToNoteConfirmed,
  }
}

/** Minutes off the rostered finish, and off the rostered start when Start did not already ask (a moved or manual start with no reason saved); null within 5. `end` is the finish as it stands: the tap, or the worker's earlier time. */
export function timeQuestions(shift: PortalShiftDetailDto, draft: EndDraft, end: Date): { start: number | null; finish: number | null } {
  const tz = shift.timeZoneId
  const c = shift.completion
  const rostered = rosteredInstants(shift)
  const startIso = (draft.startOverride ? providerLocalToUtcInstant(draft.startOverride, tz) : null) ?? c?.actualStart ?? null
  const endIso = (draft.endOverride ? providerLocalToUtcInstant(draft.endOverride, tz) : null) ?? end.toISOString()
  const startAsked = !!startIso && !c?.startTimeReason && (draft.startOverride !== null || !c?.actualStart)
  return {
    start: startAsked && rostered.start ? offRosterMinutes(startIso, rostered.start) : null,
    finish: rostered.end ? offRosterMinutes(endIso, rostered.end) : null,
  }
}
