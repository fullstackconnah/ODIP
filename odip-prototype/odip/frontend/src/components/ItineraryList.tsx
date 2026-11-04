import type { ItineraryDayDto } from '@/api/types/itinerary'
import { TONE } from '@/lib/tone'
import { itineraryRows, type ItineraryRow } from '@/lib/itineraryRows'
import { DataTable, CellText, type Column } from './DataTable'

const columns: Column<ItineraryRow>[] = [
  {
    key: 'when', header: 'When', wrap: true, mobile: 'meta',
    render: r => (
      <>
        <span>{r.when}</span>
        {r.time && <span className="ml-1 md:ml-0 md:block text-xs text-[var(--color-muted-foreground)]">{r.time}</span>}
      </>
    ),
  },
  {
    key: 'title', header: 'Item', mobile: 'primary',
    render: r => (
      <>
        <CellText lines={2} className="font-medium md:max-w-[12rem]">{r.title}</CellText>
        {r.accessibilityNotes && (
          <CellText lines={2} title={r.accessibilityNotes} className={`text-xs md:max-w-[12rem] ${TONE.warning.ink}`}>
            <span className="material-symbols-outlined text-base leading-none">accessible</span> {r.accessibilityNotes}
          </CellText>
        )}
      </>
    ),
  },
  { key: 'place', header: 'Place', maxWidth: '8rem', mobile: 'meta' },
  { key: 'status', header: 'Status', type: 'badge', mobile: 'status' },
]

export function ItineraryList({ days }: { days: ItineraryDayDto[] }) {
  return <DataTable data={itineraryRows(days)} columns={columns} keyField="key" emptyMessage="No activities scheduled" />
}
