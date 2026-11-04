import type { ItineraryDayDto } from '@/api/types/itinerary'

// House no-wrap range: no-break spaces around the en dash and a word joiner (U+2060) after it.
const NBSP = String.fromCharCode(160)
const RANGE_DASH = NBSP + String.fromCharCode(0x2013, 0x2060) + NBSP

export function formatTime(time: string | null | undefined) {
  if (!time) return null
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'pm' : 'am'
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return `${h12}:${m}${ampm}`
}

export function parseLocalDate(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export type ItineraryRow = {
  key: string
  when: string
  time: string | null
  title: string
  place: string | null
  status: string | null
  accessibilityNotes: string | null
}

// Same order as the By day view (stays first, then activities as the server sent them) with no time sort, so the two views never disagree.
export function itineraryRows(days: ItineraryDayDto[]): ItineraryRow[] {
  return days.flatMap(day => {
    const [, mm, dd] = day.date.split('-')
    const date = `${parseLocalDate(day.date).toLocaleDateString('en-AU', { weekday: 'short' })} ${dd}/${mm}`
    const stays = (day.accommodationEvents ?? []).map((e, i): ItineraryRow => ({
      key: `${day.dayNumber}-ae-${i}`, when: date, time: null, title: `${e.eventType} — ${e.propertyName}`,
      place: e.address ?? null, status: null, accessibilityNotes: null,
    }))
    const activities = (day.activities ?? []).map((a, i): ItineraryRow => {
      const start = formatTime(a.startTime)
      const end = formatTime(a.endTime)
      const time = start && (end ? start + RANGE_DASH + end : start)
      return {
        key: `${day.dayNumber}-a-${i}`, when: date, time, title: a.title,
        place: a.location ?? null, status: a.status ?? null, accessibilityNotes: a.accessibilityNotes ?? null,
      }
    })
    return [...stays, ...activities]
  })
}
