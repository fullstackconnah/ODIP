import type { ShiftCompletionDto } from '@/api/types'

/** "850 m" under a kilometre, "1.2 km" from 1000 m (one decimal, no trailing zero). */
export function formatDistanceMetres(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${+(metres / 1000).toFixed(1)} km`
}

type CheckFields = Pick<ShiftCompletionDto, 'locationCheck' | 'locationDistanceMetres' | 'locationAccuracyMetres' | 'locationReason'>

/**
 * The approver's one plain-text line about where the shift started, or null when there is nothing to say (no place set, or the check never
 * ran). No colour and no pill, like its neighbours. Worded exactly as the plan's table (6.4); the accuracy part is left out when unknown.
 */
export function locationCheckLine(c: CheckFields): string | null {
  const reason = c.locationReason?.trim()
  switch (c.locationCheck) {
    case 'AtLocation': {
      const accuracy = c.locationAccuracyMetres != null ? `, accuracy ${formatDistanceMetres(c.locationAccuracyMetres)}` : ''
      return `At location (${formatDistanceMetres(c.locationDistanceMetres ?? 0)}${accuracy}).`
    }
    case 'NotAtLocation': {
      const away = `Not at location (${formatDistanceMetres(c.locationDistanceMetres ?? 0)} away)`
      return reason ? `${away}: ${reason}` : `${away}. No reason given.`
    }
    case 'Unavailable':
      return reason ? `Location not available: ${reason}` : 'Location not available. No reason given.'
    default:
      return null
  }
}
