// The End-of-shift inputs survive leaving the page (Report incident navigates away) in sessionStorage, per shift. Every access is wrapped:
// storage can be missing or throw (private window, blocked site data) and the screen must work without it.
export interface EndDraft {
  handoverText: string
  nothingToNote: boolean
  nothingToHandOver: boolean
  confirmedSig: string | null
}

const key = (shiftId: string) => `odip-shift-end-draft:${shiftId}`

export function loadEndDraft(shiftId: string): EndDraft | null {
  try {
    const raw = sessionStorage.getItem(key(shiftId))
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<EndDraft>
    return {
      handoverText: typeof d.handoverText === 'string' ? d.handoverText : '',
      nothingToNote: d.nothingToNote === true,
      nothingToHandOver: d.nothingToHandOver === true,
      confirmedSig: typeof d.confirmedSig === 'string' ? d.confirmedSig : null,
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
