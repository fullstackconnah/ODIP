import { ChevronLeft, ChevronRight, AlertTriangle, Plus } from 'lucide-react'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import { ToggleGroup } from '@/components/ToggleGroup'
import { StatusBadge } from '@/components/StatusBadge'
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
  /** "All published" beside the range: a started week whose shifts are all published. The drafts count and Publish week are the page's banner now (2026-10-16). */
  allPublished?: boolean
  /** Unstaffed Drafts are still held back, so the week is not wholly out. */
  heldBack?: boolean
  /** The page's one primary is elsewhere (Start, or the banner's Publish week), so New shift steps back. */
  newShiftSecondary?: boolean
  /** A started week Start would still add agreement shifts to (a hand-made week): the secondary button. Absent hides it. */
  onAddAgreementShifts?: () => void
  addingAgreementShifts?: boolean
}

/** The week heading's id: the page moves focus here when the button it came from goes (after a publish). */
export const WEEK_HEADING_ID = 'roster-week-heading'

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
  allPublished,
  heldBack,
  newShiftSecondary,
  onAddAgreementShifts,
  addingAgreementShifts,
}: WeekToolbarProps) {
  // Every control here is a --control-h row: Button md / ToggleGroup / Dropdown form are all 32px at a
  // fine pointer and 44px under `pointer: coarse`, so the toolbar is one 32px line.
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      {/* On a phone the row wraps between its parts, never inside one: a pill broken over two lines, or "This week" on two, reads as broken (finish review). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* The week navigation is three buttons that cannot fit one narrow line: at a 200 %-equivalent
            layout width the content row is 163px and the three buttons need 195px. `shrink-0` on this
            group therefore made the whole PAGE wider than its client width (a 16px document overflow at
            195 CSS px, measured). It may shrink and wrap instead: the row then breaks between the
            buttons, each of which keeps its own words on one line, and the page no longer overflows.
            The board itself is untouched — its day columns still keep their floor, and the board's own
            sideways scroll is what reaches the wider grid (the Column Rule: a table wider than its box
            scrolls sideways inside its own box, the page never does). */}
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {/* Prev/next are square Buttons: md height, width pinned to the same token (px-0! beats the
              size's own px-4, which would make a lone chevron 48px wide). */}
          <Button variant="secondary" size="md" onClick={onPrevWeek} aria-label="Previous week" className="w-[var(--control-h)] px-0!">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="md" onClick={onThisWeek} className="whitespace-nowrap">
            This week
          </Button>
          <Button variant="secondary" size="md" onClick={onNextWeek} aria-label="Next week" className="w-[var(--control-h)] px-0!">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 id={WEEK_HEADING_ID} tabIndex={-1} className="whitespace-nowrap font-display text-sm font-semibold tabular-nums text-foreground outline-none">{formatWeekRange(days)}</h2>
        {allPublished && <StatusBadge tone="info" label={heldBack ? 'All staffed shifts published' : 'All published'} className="shrink-0 whitespace-nowrap" />}
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
        {/* Nothing to open at zero, so no button (V2-G). */}
        {exceptionsCount > 0 && (
          <Button variant="secondary" size="md" onClick={onOpenExceptions}>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {plural(exceptionsCount, 'exception')}
          </Button>
        )}
        {canWrite && onAddAgreementShifts && (
          // aria-disabled, not disabled, while it runs: a disabled button drops focus to body, and a failure must leave focus here (as the Start card).
          <Button
            variant="secondary"
            size="md"
            className="whitespace-nowrap aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={addingAgreementShifts || undefined}
            onClick={() => { if (!addingAgreementShifts) onAddAgreementShifts() }}
          >
            {/* The idle label sits invisible in the same grid cell, so the button keeps its width while it reads "Adding…" (as WizardNavFooter). */}
            <span className="grid">
              <span aria-hidden="true" data-reserve="Add agreement shifts" className="invisible col-start-1 row-start-1 before:content-[attr(data-reserve)]" />
              <span className="col-start-1 row-start-1">{addingAgreementShifts ? 'Adding…' : 'Add agreement shifts'}</span>
            </span>
          </Button>
        )}
        {canWrite && (
          // One primary per page: New shift steps back while Start or Publish week is the page's.
          <Button size="md" variant={newShiftSecondary ? 'secondary' : 'primary'} onClick={onNewShift}>
            <Plus className="h-4 w-4" /> New shift
          </Button>
        )}
      </div>
    </div>
  )
}
