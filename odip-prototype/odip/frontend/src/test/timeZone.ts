// Switching the time zone inside a test. The gate runs in UTC and a developer machine in Sydney, so a test of date math sets the zone it
// needs (Node re-reads process.env.TZ on assignment) and puts the original back afterwards.
//
// Put the original back with `restoreZone()`, never `delete process.env.TZ`: after a delete Node keeps the last zone it was given, so the
// next test would run in the wrong one.
const ORIGINAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Switches to `zone`. False when this runtime would not switch (the caller skips that case); the zone is then unchanged. */
export function setZone(zone: string): boolean {
  process.env.TZ = zone
  return Intl.DateTimeFormat().resolvedOptions().timeZone === zone
}

/** Back to the zone the test process started in. Call it in `afterEach`. */
export function restoreZone(): void {
  process.env.TZ = ORIGINAL_ZONE
}
