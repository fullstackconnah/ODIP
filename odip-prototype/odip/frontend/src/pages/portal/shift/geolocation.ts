/**
 * Prompts for a geolocation stamp, then resolves regardless of the outcome (design spec ruling 1: Start/Finish must never be blocked on
 * permission): a grant resolves with lat/long and `geolocationDeclined: false`; a denial, timeout, or an environment with no Geolocation
 * API at all (jsdom in tests, or a browser under a `geolocation=()` Permissions-Policy) resolves with `geolocationDeclined: true` and no
 * coordinates. Short 5s timeout so a slow location fix doesn't stall the tap.
 */
export function requestGeolocation(): Promise<{ latitude?: number; longitude?: number; geolocationDeclined: boolean }> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ geolocationDeclined: true })
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, geolocationDeclined: false }),
      () => resolve({ geolocationDeclined: true }),
      { timeout: 5000 },
    )
  })
}
