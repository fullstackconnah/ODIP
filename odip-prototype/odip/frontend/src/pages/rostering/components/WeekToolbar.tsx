import { ChevronLeft, ChevronRight, AlertTriangle, Plus } from 'lucide-react'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import { ToggleGroup } from '@/components/ToggleGroup'
import { formatWeekRange } from '../lib/roster'
import type { BoardViewMode } from '../lib/useBoardViewMode'
import { plural } from '@/lib/format'

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
  // Every control here is a --control-h row: Button md / ToggleGroup / Dropdown form are all 32px at a
  // fine pointer and 44px under `pointer: coarse`, so the toolbar is one 32px line.
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {/* Prev/next are square Buttons: md height, width pinned to the same token (px-0! beats the
              size's own px-4, which would make a lone chevron 48px wide). */}
          <Button variant="secondary" size="md" onClick={onPrevWeek} aria-label="Previous week" className="w-[var(--control-h)] px-0!">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="md" onClick={onThisWeek}>
            This week
          </Button>
          <Button variant="secondary" size="md" onClick={onNextWeek} aria-label="Next week" className="w-[var(--control-h)] px-0!">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="font-display text-sm font-semibold tabular-nums text-foreground">{formatWeekRange(days)}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          options={[{ key: 'participant', label: 'By participant' }, { key: 'staff', label: 'By staff' }]}
          value={groupBy}
          onChange={key => onGroupByChange(key as BoardViewMode)}
        />
        {/* As wide as the name chosen (a participant's full name wrapped onto two lines inside a fixed 160px box), within limits. */}
        <div className="w-auto min-w-40 max-w-64">
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
        {/* Offered in both views (it narrows the staff board to its unfilled lane, and the participant board to the shifts nobody is assigned to). A single on/off filter is a toggle button (aria-pressed), not a one-option radio group — ToggleGroup's role="radiogroup"/role="radio" semantics assume >=2 mutually exclusive options, and its arrow-key roving-tabindex handling would otherwise fire on every arrow key with only one option to rove between (index±1 mod 1 is always 0). */}
        <Button
          variant={unfilledOnly ? 'primary' : 'ghost'}
          size="md"
          aria-pressed={unfilledOnly}
          onClick={() => onUnfilledOnlyChange(!unfilledOnly)}
        >
          Unfilled only
        </Button>
        <Button variant="secondary" size="md" onClick={onOpenExceptions}>
          <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {plural(exceptionsCount, 'exception')}
        </Button>
        {canWrite && (
          <Button size="md" onClick={onNewShift}>
            <Plus className="h-4 w-4" /> New shift
          </Button>
        )}
      </div>
    </div>
  )
}
