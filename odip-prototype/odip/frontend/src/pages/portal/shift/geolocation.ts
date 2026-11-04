/** Why a Start could not get a fix, in the words the no-fix sheet shows under "We couldn't check your location". */
export type GeoCause = 'denied' | 'timeout' | 'insecure' | 'unsupported'

export type GeoResult =
  | { ok: true; latitude: number; longitude: number; accuracyMetres: number }
  | { ok: false; cause: GeoCause }

const GIVE_UP_MS = 10_000

/**
 * Asks the phone where it is, once, for Start at a shift with a service location. It always resolves, never rejects (Start is never blocked on
 * permission). Plain HTTP (live) has no Geolocation, so that is `insecure` without a prompt; no API at all is `unsupported`. Browsers start the
 * `timeout` only once the prompt is answered, so a hard fallback ends a prompt left open. The fix goes to the server and nowhere else.
 */
export function requestGeolocation(): Promise<GeoResult> {
  return new Promise(resolve => {
    if (typeof window !== 'undefined' && !window.isSecureContext) return resolve({ ok: false, cause: 'insecure' })
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({ ok: false, cause: 'unsupported' })
    const giveUp = setTimeout(() => resolve({ ok: false, cause: 'timeout' }), GIVE_UP_MS)
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(giveUp); resolve({ ok: true, latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyMetres: pos.coords.accuracy }) },
      err => { clearTimeout(giveUp); resolve({ ok: false, cause: err.code === 1 ? 'denied' : 'timeout' }) },
      { timeout: 5000, enableHighAccuracy: true },
    )
  })
}
