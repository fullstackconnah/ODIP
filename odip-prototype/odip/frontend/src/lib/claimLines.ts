import type { ClaimLineItemDto } from '@/api/types/claims'

export const dayTypeLabel = (dt: string) => {
  switch (dt) {
    case 'Weekday': return 'Weekday'
    case 'WeekdayEvening': return 'Weekday Evening'
    case 'WeekdayNight': return 'Weekday Night'
    case 'Saturday': return 'Saturday'
    case 'Sunday': return 'Sunday'
    case 'PublicHoliday': return 'Public Holiday'
    default: return dt
  }
}

type Line = Pick<ClaimLineItemDto, 'unit' | 'shiftId' | 'hours'>

/** A shift line billed as one flat item per night (unit E). A trip line never reads as a night. */
export const isSleepoverLine = (l: Pick<ClaimLineItemDto, 'unit' | 'shiftId'>) => l.unit === 'E' && !!l.shiftId

/** "1 night" / "2 nights" for a sleepover line, "8h" for the rest. */
export const lineQuantity = (l: Line) => isSleepoverLine(l) ? (l.hours === 1 ? '1 night' : `${l.hours} nights`) : `${l.hours}h`

/** True when some shift on the claim has a rejected line while another line of the same shift is not rejected, so a new claim run still skips that shift. */
export const hasPartlyRejectedShift = (lines: Pick<ClaimLineItemDto, 'shiftId' | 'status'>[]) => {
  const rejected = new Set<string>(), kept = new Set<string>()
  for (const l of lines) if (l.shiftId) (l.status === 'Rejected' ? rejected : kept).add(l.shiftId)
  return [...rejected].some(id => kept.has(id))
}
