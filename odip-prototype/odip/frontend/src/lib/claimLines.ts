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

type Line = Pick<ClaimLineItemDto, 'unit' | 'shiftId' | 'hours'> & Partial<Pick<ClaimLineItemDto, 'supportItemCode'>>

/** The kilometre line of a shift's provider travel: a unit E "each" item (04_799_...) whose quantity is dollars. */
const isTravelKmLine = (l: Partial<Pick<ClaimLineItemDto, 'supportItemCode'>>) => !!l.supportItemCode?.includes('_799_')

/** A shift line billed as one flat item per night (unit E). A trip line, and a travel kilometre line, never read as a night. */
export const isSleepoverLine = (l: Pick<ClaimLineItemDto, 'unit' | 'shiftId'> & Partial<Pick<ClaimLineItemDto, 'supportItemCode'>>) => l.unit === 'E' && !!l.shiftId && !isTravelKmLine(l)

/** "1 night" / "2 nights" for a sleepover line, "$12.87" for travel kilometres, "8h" for the rest. */
export const lineQuantity = (l: Line) => isSleepoverLine(l) ? (l.hours === 1 ? '1 night' : `${l.hours} nights`) : l.unit === 'E' && !!l.shiftId ? `${l.hours.toFixed(2)}` : `${l.hours}h`

/** What a shift line is called on a claim: its travel, a sleepover, or its day type. */
export const lineKindLabel = (l: Line & Pick<ClaimLineItemDto, 'claimType' | 'dayType'>) =>
  l.claimType === 'ProviderTravel' ? 'Provider travel' : isTravelKmLine(l) ? 'Provider travel costs' : isSleepoverLine(l) ? 'Sleepover' : dayTypeLabel(l.dayType)

/** True when some shift on the claim has a rejected line while another line of the same shift is not rejected, so a new claim run still skips that shift. */
export const hasPartlyRejectedShift = (lines: Pick<ClaimLineItemDto, 'shiftId' | 'status'>[]) => {
  const rejected = new Set<string>(), kept = new Set<string>()
  for (const l of lines) if (l.shiftId) (l.status === 'Rejected' ? rejected : kept).add(l.shiftId)
  return [...rejected].some(id => kept.has(id))
}
