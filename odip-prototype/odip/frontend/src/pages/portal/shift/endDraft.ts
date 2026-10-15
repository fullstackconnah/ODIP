// The finish flow's entries survive leaving the page (Yes on "Anything to report?" opens the incident form; a reload; Back to shift) in
// sessionStorage, per shift. Every access is wrapped: storage can be missing or throw (private window, blocked site data), and the flow
// must work without it. Every field is type-checked on load, so a draft from an older build loads closed instead of breaking.
import { FINISH_STEPS, type FinishStepKey } from './checklist'

export interface EndDraft {
  /** The open step, or null while the flow is closed (the worker went back to the shift). */
  step: FinishStepKey | null
  /** The furthest step reached: the rail's pills up to it can be tapped. */
  reached: FinishStepKey
  /** The worker's start and finish, provider-local "yyyy-MM-ddTHH:mm", or null for the recorded time. */
  startOverride: string | null
  endOverride: string | null
  adjustmentReason: string
  /** The kilometre field as typed. */
  kilometres: string
  anythingToReport: 'yes' | 'no' | null
  handoverText: string
  nothingToNote: boolean
  nothingToHandOver: boolean
  /** breaksSignature when step 1 was confirmed: if the breaks change after that, the flow resumes at step 1. */
  timesSig: string | null
}

export const EMPTY_END_DRAFT: EndDraft = {
  step: null, reached: 'times', startOverride: null, endOverride: null, adjustmentReason: '', kilometres: '',
  anythingToReport: null, handoverText: '', nothingToNote: false, nothingToHandOver: false, timesSig: null,
}

const key = (shiftId: string) => `odip-shift-end-draft:${shiftId}`
const isStep = (v: unknown): v is FinishStepKey => FINISH_STEPS.some(s => s.key === v)
const text = (v: unknown) => (typeof v === 'string' ? v : '')
const textOrNull = (v: unknown) => (typeof v === 'string' ? v : null)

export function loadEndDraft(shiftId: string): EndDraft | null {
  try {
    const raw = sessionStorage.getItem(key(shiftId))
    if (!raw) return null
    const d = JSON.parse(raw) as Record<string, unknown>
    return {
      step: isStep(d.step) ? d.step : null,
      reached: isStep(d.reached) ? d.reached : 'times',
      startOverride: textOrNull(d.startOverride),
      endOverride: textOrNull(d.endOverride),
      adjustmentReason: text(d.adjustmentReason),
      kilometres: text(d.kilometres),
      anythingToReport: d.anythingToReport === 'yes' || d.anythingToReport === 'no' ? d.anythingToReport : null,
      handoverText: text(d.handoverText),
      nothingToNote: d.nothingToNote === true,
      nothingToHandOver: d.nothingToHandOver === true,
      timesSig: textOrNull(d.timesSig),
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
