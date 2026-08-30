import { ChevronLeft, ChevronRight, AlertTriangle, Plus } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { ToggleGroup } from '@/components/ToggleGroup'
import { formatWeekRange } from '../lib/roster'
import type { BoardViewMode } from '../lib/useBoardViewMode'

export type WeekToolbarProps = {
  days: string[]
  onPrevWeek: () => void
  onThisWeek: () => void
  onNextWeek: () => void
  groupBy: BoardViewMode
  onGroupByChange: (mode: BoardViewMode) => void
  participantOptions: { value: string; label: string }[]
  participantFilter: string
  onParticipantFilterChange: (value: string) => void
  regionOptions: { value: string; label: string }[]
  regionFilter: string
  onRegionFilterChange: (value: string) => void
  unfilledOnly: boolean
  onUnfilledOnlyChange: (value: boolean) => void
  exceptionsCount: number
  onOpenExceptions: () => void
  canWrite: boolean
  onNewShift: () => void
}

export function WeekToolbar({
  days,
  onPrevWeek,
  onThisWeek,
  onNextWeek,
  groupBy,
  onGroupByChange,
  participantOptions,
  participantFilter,
  onParticipantFilterChange,
  regionOptions,
  regionFilter,
  onRegionFilterChange,
  unfilledOnly,
  onUnfilledOnlyChange,
  exceptionsCount,
  onOpenExceptions,
  canWrite,
  onNewShift,
}: WeekToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={onPrevWeek}
            aria-label="Previous week"
            className="rounded-md p-3.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onThisWeek}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            This week
          </button>
          <button
            type="button"
            onClick={onNextWeek}
            aria-label="Next week"
            className="rounded-md p-3.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h2 className="font-display text-lg font-semibold text-foreground">{formatWeekRange(days)}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          options={[{ key: 'participant', label: 'By participant' }, { key: 'staff', label: 'By staff' }]}
          value={groupBy}
          onChange={key => onGroupByChange(key as BoardViewMode)}
        />
        <div className="w-40">
          <Dropdown
            variant="form"
            value={participantFilter}
            onChange={onParticipantFilterChange}
            searchable
            label="All participants"
            items={[{ value: '', label: 'All participants' }, ...participantOptions]}
          />
        </div>
        {groupBy === 'staff' && (
          <div className="w-36">
            <Dropdown
              variant="form"
              value={regionFilter}
              onChange={onRegionFilterChange}
              label="All regions"
              items={[{ value: '', label: 'All regions' }, ...regionOptions]}
            />
          </div>
        )}
        {groupBy === 'staff' && (
          // A single on/off filter is a toggle button (aria-pressed), not a one-option radio
          // group — ToggleGroup's role="radiogroup"/role="radio" semantics assume >=2 mutually
          // exclusive options, and its arrow-key roving-tabindex handling would otherwise fire
          // on every arrow key with only one option to rove between (index±1 mod 1 is always 0).
          <button
            type="button"
            aria-pressed={unfilledOnly}
            onClick={() => onUnfilledOnlyChange(!unfilledOnly)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              unfilledOnly
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            Unfilled only
          </button>
        )}
        <button
          type="button"
          onClick={onOpenExceptions}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors duration-150 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {exceptionsCount} exception{exceptionsCount === 1 ? '' : 's'}
        </button>
        {canWrite && (
          <button
            type="button"
            onClick={onNewShift}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md shadow-primary/20 transition-all duration-150 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" /> New shift
          </button>
        )}
      </div>
    </div>
  )
}
