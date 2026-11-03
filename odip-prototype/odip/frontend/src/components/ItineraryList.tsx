import type { ItineraryDayDto } from '@/api/types/itinerary'
import { TONE } from '@/lib/tone'
import { DataTable, type Column } from './DataTable'

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
      const time = start && (end ? `${start} –⁠ ${end}` : start)
      return {
        key: `${day.dayNumber}-a-${i}`, when: time ? `${date} · ${time}` : date, time, title: a.title,
        place: a.location ?? null, status: a.status ?? null, accessibilityNotes: a.accessibilityNotes ?? null,
      }
    })
    return [...stays, ...activities]
  })
}

const columns: Column<ItineraryRow>[] = [
  { key: 'when', header: 'When', className: 'whitespace-nowrap', mobile: 'meta' },
  {
    key: 'title', header: 'Item', maxWidth: '16rem', mobile: 'primary',
    render: r => (
      <>
        <span className="font-medium">{r.title}</span>
        {r.accessibilityNotes && (
          <span className={`flex items-center gap-1 text-xs ${TONE.warning.ink}`}>
            <span className="material-symbols-outlined text-base leading-none">accessible</span> {r.accessibilityNotes}
          </span>
        )}
      </>
    ),
  },
  { key: 'place', header: 'Place', maxWidth: '12rem', mobile: 'meta' },
  { key: 'status', header: 'Status', type: 'badge', mobile: 'status' },
]

export function ItineraryList({ days }: { days: ItineraryDayDto[] }) {
  return <DataTable data={itineraryRows(days)} columns={columns} keyField="key" emptyMessage="No activities scheduled" />
}
