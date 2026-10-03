// The login page sends the verification link at most ONCE per hold, however many times someone presses Sign In: Firebase rate-limits these, and every press with
// an unverified account would otherwise send another (and "Send it again" has no lockout of its own). The time of the last send ATTEMPT is kept in memory by the
// page and here in sessionStorage, so reloading the page does not reset it. Only the address, the time and whether it went are kept: never the password.

/** How long after a send another is held back: the automatic one is skipped, and "Send it again" waits. */
export const VERIFICATION_HOLD_MS = 30_000

const KEY = 'odip_verification_send'

export interface VerificationSendRecord {
  email: string
  /** When the send was attempted (ms since the epoch). */
  at: number
  /** Whether it went. A failed attempt holds the next one back too (Firebase counts attempts), but the page must not claim a link was sent. */
  went: boolean
}

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The last send attempt this tab made, or null. Never throws: sessionStorage can be missing or refused (private windows). */
export function readVerificationSend(): VerificationSendRecord | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<VerificationSendRecord> | null) : null
    return parsed && typeof parsed.email === 'string' && typeof parsed.at === 'number'
      ? { email: parsed.email, at: parsed.at, went: parsed.went !== false }
      : null
  } catch {
    return null
  }
}

/** Remembers a send attempt for this tab. Never throws; without sessionStorage the page's own copy still holds it until a reload. */
export function writeVerificationSend(record: VerificationSendRecord): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(record))
  } catch {
    /* nothing to do */
  }
}

/** How much of the hold is left for `email`, in ms: 0 when nothing was attempted for that address or the hold is over. */
export function holdLeftMs(record: VerificationSendRecord | null, email: string, now: number = Date.now()): number {
  if (!record || !sameAddress(record.email, email)) return 0
  // Clamped on both sides: a clock that moved backwards must not hold a person for longer than the hold.
  return Math.min(VERIFICATION_HOLD_MS, Math.max(0, VERIFICATION_HOLD_MS - (now - record.at)))
}
