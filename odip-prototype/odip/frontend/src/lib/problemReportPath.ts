import type { PlatformInfo } from './platformInfo'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALL_DIGITS = /^\d+$/

/**
 * The page a "Report a problem" note came from: the pathname only, with ids hidden. A record's id (a GUID) becomes `:id` and a number `:n`,
 * and the query and hash are dropped, so the note names the screen and never the participant or the search behind it.
 */
export function problemReportPagePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0]
  return path.split('/').map(part => (GUID.test(part) ? ':id' : ALL_DIGITS.test(part) ? ':n' : part)).join('/') || '/'
}

/** `1.4.2 (abcdef0)`: the build the reporter was running. `unknown` while the version is the 0.0.0 placeholder; a sha that is not hex is left out. */
export function problemReportAppVersion(info: Pick<PlatformInfo, 'version' | 'buildSha'>): string {
  const version = info.version && info.version !== '0.0.0' ? info.version : 'unknown'
  const sha = info.buildSha && /^[0-9a-f]{7,40}$/i.test(info.buildSha) ? info.buildSha.slice(0, 7) : null
  return sha ? `${version} (${sha})` : version
}
