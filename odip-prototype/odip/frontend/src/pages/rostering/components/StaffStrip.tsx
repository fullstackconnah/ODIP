import { useContext, useId, useState } from 'react'
import { useDndContext, useDraggable } from '@dnd-kit/core'
import { AlertTriangle } from 'lucide-react'
import type { StaffListDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { SearchInput } from '@/components/SearchInput'
import { formatHoursMeter } from '../lib/roster'
import { DropStateContext, WEEK_TARGET_HOURS, carriedLine, dropOutcome, type DragCarry, type DropTarget } from '../lib/rosterDrag'

export type StaffStripProps = {
  staff: StaffListDto[]
  isLoading: boolean
  /** Hours each person holds this week, from the RAW board (staffWeekHours): a filter never moves a total. */
  hours: Map<string, number>
  regionOptions: { value: string; label: string }[]
  regionFilter: string
  onRegionFilterChange: (value: string) => void
}

const hoursText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * The staff strip (roster drag and drop, the brief section 3): every active person as a puck to carry onto a shift or an empty day. The page shows it in the Participant view, for
 * writers, from md up. Fixed height: two control rows beside two puck rows. More pucks wrap and scroll inside it, and search is the fast path (no sorting, no paging).
 */
export function StaffStrip({ staff, isLoading, hours, regionOptions, regionFilter, onRegionFilterChange }: StaffStripProps) {
  const [query, setQuery] = useState('')
  const captionId = useId()
  const q = query.trim().toLowerCase()
  const shown = staff.filter(s => s.isActive && (!regionFilter || s.region === regionFilter) && (!q || s.fullName.toLowerCase().includes(q)))

  return (
    <section
      aria-labelledby={captionId}
      className="relative flex h-[calc(2*var(--control-h)_+_0.5rem_+_2*var(--card-pad)_+_2px)] gap-3 rounded-[var(--radius-md)] border border-border bg-surface-container-low p-[var(--card-pad)]"
    >
      {/* The caption sits on the top border, as in the brief's sketch. */}
      <h2 id={captionId} className="absolute -top-2.5 left-3 bg-[var(--color-background)] px-1 text-xs font-semibold text-muted-foreground">Staff</h2>
      <div className="flex w-56 shrink-0 flex-col gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Find staff" className="w-full" />
        <Dropdown variant="form" value={regionFilter} onChange={onRegionFilterChange} label="All regions" items={[{ value: '', label: 'All regions' }, ...regionOptions]} />
      </div>
      {isLoading ? (
        <div className="flex min-w-0 flex-1 flex-wrap content-start gap-1" aria-hidden="true">
          {[0, 1, 2].map(i => <div key={i} className="h-[calc(var(--row-h)_-_6px)] w-40 animate-pulse rounded-sm bg-muted" />)}
        </div>
      ) : shown.length === 0 ? (
        <p className="self-center text-[13px] text-muted-foreground">{q ? `No staff match “${query.trim()}”.` : 'No active staff.'}</p>
      ) : (
        <ul className="flex min-w-0 flex-1 flex-wrap content-start gap-1 overflow-y-auto">
          {shown.map(s => <li key={s.id}><StaffPuck person={s} hours={hours.get(s.id) ?? 0} /></li>)}
        </ul>
      )}
    </section>
  )
}

/** One person in the strip. The whole puck is the drag source: it has no other action, so it needs no separate handle. */
function StaffPuck({ person, hours }: { person: StaffListDto; hours: number }) {
  const { disabled } = useContext(DropStateContext)
  const carry: DragCarry = { staffId: person.id, staffName: person.fullName }
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `staff:${person.id}`, data: carry, disabled })
  const over = hours > WEEK_TARGET_HOURS
  const name = `${person.fullName}, ${hoursText(hours)} of ${WEEK_TARGET_HOURS} hours this week${person.hasExpiredQualifications ? ', qualifications expired' : ''}`

  return (
    // Not touch-none: a swipe still scrolls the strip, and a 200 ms press lifts the puck (the page's TouchSensor).
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-label={name}
      className={`relative flex h-[calc(var(--row-h)_-_6px)] max-w-56 cursor-grab touch-manipulation items-center gap-1.5 overflow-hidden rounded-sm border border-border bg-card px-2 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* The chip's own warning mark, in the on-warning ink (ShiftChip): a flagged person can still be carried; the server decides. */}
      {person.hasExpiredQualifications && <AlertTriangle className="h-3 w-3 shrink-0 text-[var(--color-on-warning-container)]" aria-hidden="true" />}
      <span className="min-w-0 truncate font-medium text-foreground" title={person.fullName}>{person.fullName}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatHoursMeter(hours, WEEK_TARGET_HOURS)}</span>
      {/* StaffRow's hours meter: 2px on the bottom edge, olive, amber past the target. */}
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-input" aria-hidden="true">
        <span className={`block h-full ${over ? 'bg-[var(--color-warning)]' : 'bg-primary'}`} style={{ width: `${Math.min(100, (hours / WEEK_TARGET_HOURS) * 100)}%` }} />
      </span>
    </button>
  )
}

/** The puck that rides the pointer in the page's DragOverlay: the person, and a second line naming what letting go here would do. */
export function CarriedPuck({ carry, hours }: { carry: DragCarry; hours: number }) {
  const { over } = useDndContext()
  const line = carriedLine(carry, dropOutcome(carry, over?.data.current as DropTarget | undefined))
  // The Floating Panel shadow (DESIGN.md), its tint taken from --color-foreground (27,28,26 at 14%) so no literal colour joins the uiStandards baseline.
  return (
    <div className="flex w-max max-w-64 cursor-grabbing flex-col rounded-sm border border-border bg-card px-2 py-1 text-[13px] shadow-[0_24px_40px_-12px_color-mix(in_srgb,var(--color-foreground)_14%,transparent)]">
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 truncate font-medium text-foreground">{carry.staffName}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatHoursMeter(hours, WEEK_TARGET_HOURS)}</span>
      </span>
      {line && <span className="text-xs text-muted-foreground">{line}</span>}
    </div>
  )
}
