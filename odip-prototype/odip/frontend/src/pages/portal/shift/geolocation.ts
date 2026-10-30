/**
 * Prompts for a geolocation stamp, then resolves regardless of the outcome (design spec ruling 1: Start/Finish must never be blocked on
 * permission): a grant resolves with lat/long and `geolocationDeclined: false`; a denial, timeout, or an environment with no Geolocation
 * API at all (jsdom in tests, or a browser under a `geolocation=()` Permissions-Policy) resolves with `geolocationDeclined: true` and no
 * coordinates. Short 5s timeout so a slow location fix doesn't stall the tap, and a hard 10s fallback for a prompt that is never answered.
 */
export function requestGeolocation(): Promise<{ latitude?: number; longitude?: number; geolocationDeclined: boolean }> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ geolocationDeclined: true })
      return
    }
    // Browsers start the `timeout` below only once the permission prompt is answered, so a prompt left open never calls back.
    const giveUp = setTimeout(() => resolve({ geolocationDeclined: true }), 10_000)
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(giveUp); resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, geolocationDeclined: false }) },
      () => { clearTimeout(giveUp); resolve({ geolocationDeclined: true }) },
      { timeout: 5000 },
    )
  })
}
