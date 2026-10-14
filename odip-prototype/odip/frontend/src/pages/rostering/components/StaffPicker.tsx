import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, Search } from 'lucide-react'
import type { ShiftDto, StaffLeaveDto, StaffListDto } from '@/api/types'
import { SlideOver } from '@/components/SlideOver'
import { StatusBadge } from '@/components/StatusBadge'
import { TONE } from '@/lib/tone'
import { formatHoursMeter, formatShiftTimeRange } from '../lib/roster'
import { WEEK_TARGET_HOURS, firstName, moveLine, pickName, pickOptionName, pickerGroups, type PickRow } from '../lib/rosterDrag'

export type StaffPickerProps = {
  /** The Needs staff shift being filled. Null: closed. */
  target: ShiftDto | null
  staff: StaffListDto[]
  staffLoading: boolean
  /** Every shift on the RAW board: overlaps and hours never follow a filter. */
  shifts: ShiftDto[]
  leave: StaffLeaveDto[]
  hours: Map<string, number>
  /** Below md: the house SlideOver instead of the panel anchored to the chip. */
  sheet: boolean
  onPick: (row: PickRow) => void
  /** Closed without a pick: Escape, Tab (the panel), a mousedown outside, or the chip gone or scrolled out of the board. */
  onClose: () => void
}

const GROUPS = [
  { key: 'free', label: 'Free at this time' },
  { key: 'move', label: 'On another shift at this time' },
  { key: 'leave', label: 'On leave that day' },
] as const

const PANEL_WIDTH = 320
const PANEL_MAX_HEIGHT = 416   // 26rem
const FLIP_BELOW = 288         // 18rem
const EDGE = 8
const GAP = 4

/**
 * Where the md+ panel goes (the brief, section 4). It sits 4px under its chip, with their left edges together. It goes above the chip when the room below is under 18rem and the room
 * above is larger. When 320px would pass the window's right edge, its right edge lines up with the chip's. It always stays 8px inside the window, and never covers its own chip.
 */
export type PickerPlace = { left: number; width: number; maxHeight: number; top?: number; bottom?: number }

export function pickerPlacement(chip: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>, view: { width: number; height: number }): PickerPlace {
  const below = view.height - chip.bottom - GAP - EDGE
  const above = chip.top - GAP - EDGE
  const left = Math.max(EDGE, Math.min(chip.left + PANEL_WIDTH > view.width - EDGE ? chip.right - PANEL_WIDTH : chip.left, view.width - EDGE - PANEL_WIDTH))
  return below < FLIP_BELOW && above > below
    ? { left, width: PANEL_WIDTH, bottom: view.height - chip.top + GAP, maxHeight: Math.min(PANEL_MAX_HEIGHT, above) }
    : { left, width: PANEL_WIDTH, top: chip.bottom + GAP, maxHeight: Math.min(PANEL_MAX_HEIGHT, below) }
}

/**
 * The staff picker (spec 2026-10-15, decision C; the brief, section 4): a search and the active staff in three groups, for one Needs staff shift. It sorts people by what the board
 * already knows (overlap, leave, hours, the expired flag) and judges nothing: the page sends the pick as a drop would, and the server's findings answer it. It is a panel anchored to
 * its chip from md up, and the house SlideOver below.
 */
export function StaffPicker({ target, sheet, ...rest }: StaffPickerProps) {
  if (!target) return null
  return sheet ? <PickerSheet target={target} {...rest} /> : <PickerPanel target={target} {...rest} />
}

type OpenProps = Omit<StaffPickerProps, 'target' | 'sheet'> & { target: ShiftDto }

/** md and up: a non-modal panel portalled to the body. It follows its chip and closes once the chip leaves the board frame's visible area. */
function PickerPanel({ target, onClose, ...body }: OpenProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current
      const chip = document.querySelector<HTMLElement>(`[data-shift-chip="${target.id}"]`)
      if (!panel) return
      if (!chip) return closeRef.current()
      const rect = chip.getBoundingClientRect()
      const frame = chip.closest('.overflow-auto')?.getBoundingClientRect()
      if (frame && (rect.bottom <= frame.top || rect.top >= frame.bottom || rect.right <= frame.left || rect.left >= frame.right)) return closeRef.current()
      // Written straight to the node, before paint: no state set in an effect (react-hooks/set-state-in-effect), and no re-render of the list on every scroll event.
      const p = pickerPlacement(rect, { width: window.innerWidth, height: window.innerHeight })
      const px = (n?: number) => (n === undefined ? '' : `${n}px`)
      Object.assign(panel.style, { left: px(p.left), width: px(p.width), maxHeight: px(p.maxHeight), top: px(p.top), bottom: px(p.bottom) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [target.id])

  useEffect(() => { inputRef.current?.focus() }, [])

  // A mousedown anywhere else closes it. Its own plus is not "anywhere else": a click there toggles the picker (the page).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const node = e.target as Element
      if (panelRef.current?.contains(node) || node.closest?.(`[data-shift-plus="${target.id}"]`)) return
      closeRef.current()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [target.id])

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={pickName(target)}
      // Positioned by the layout effect above. The Floating Panel: card fill, --radius-md, the house shadow (StaffStrip's CarriedPuck), no border.
      className="fixed z-50 flex flex-col overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-card)] shadow-[0_24px_40px_-12px_color-mix(in_srgb,var(--color-foreground)_14%,transparent)]"
    >
      <PickerBody
        target={target}
        {...body}
        inputRef={inputRef}
        // Tab closes too, and focus goes back to the plus (the page): portalled to the end of the body, the panel would otherwise hand focus to nothing near its chip.
        onDismissKey={e => { if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose() } }}
      />
    </div>,
    document.body,
  )
}

/** Below md: the house SlideOver (SHAPE departure 6). It brings the focus trap, Escape, the scroll lock and focus return to the plus. A pick closes it, so it has no footer. */
function PickerSheet({ target, onClose, ...body }: OpenProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <SlideOver
      open
      onClose={onClose}
      title="Assign someone"
      description={`${target.participantName}, ${format(parseISO(target.serviceDate), 'EEE d MMM')}, ${formatShiftTimeRange(target.startTime, target.endTime)}`}
      initialFocusRef={inputRef}
      bodyClassName="flex flex-col overflow-hidden p-0"
    >
      <PickerBody target={target} {...body} inputRef={inputRef} />
    </SlideOver>
  )
}

type BodyProps = Omit<OpenProps, 'onClose'> & {
  inputRef: RefObject<HTMLInputElement | null>
  /** Keys that close without a pick. The panel passes Escape and Tab; the SlideOver handles its own Escape and keeps Tab trapped. */
  onDismissKey?: (e: KeyboardEvent<HTMLInputElement>) => void
}

/** The search, the Published line and the grouped listbox. Focus stays in the search; the active option is virtual (aria-activedescendant), as in SearchableSelect. */
function PickerBody({ target, staff, staffLoading, shifts, leave, hours, onPick, inputRef, onDismissKey }: BodyProps) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const q = query.trim().toLowerCase()
  const groups = useMemo(() => pickerGroups(target, staff, shifts, leave, hours), [target, staff, shifts, leave, hours])
  // The search matches any part of the full name, ignoring case, in every group. An empty group draws no label.
  const shown = GROUPS.map(g => ({ ...g, rows: groups[g.key].filter(r => !q || r.person.fullName.toLowerCase().includes(q)) })).filter(g => g.rows.length > 0)
  const options = shown.flatMap(g => g.rows)
  const firstIndex = shown.map((_, i) => shown.slice(0, i).reduce((n, g) => n + g.rows.length, 0))
  const optionId = (i: number) => `${listId}-opt-${i}`

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (options.length === 0) return
      // Nothing is active on open: Down goes to the first option, Up to the last, and both wrap.
      setActive(i => (e.key === 'ArrowDown' ? (i + 1) % options.length : i <= 0 ? options.length - 1 : i - 1))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      if (options.length > 0) setActive(e.key === 'Home' ? 0 : options.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // With nothing active, Enter picks only when one option is left, so a stray Enter never assigns somebody (SearchableSelect's rule).
      const row = options[active] ?? (options.length === 1 ? options[0] : undefined)
      if (row) onPick(row)
    } else onDismissKey?.(e)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-1.5 p-2">
        {/* SearchInput's look; it takes no ref and no combobox role, so the input is written out here. */}
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Find staff"
            placeholder="Find staff"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && active < options.length ? optionId(active) : undefined}
            autoComplete="off"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(-1) }}
            onKeyDown={handleKeyDown}
            className="h-[var(--control-h)] w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-input)] pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          />
        </div>
        {/* A pick on a Published shift tells the person at once: said once, in the replace prompt's own words (SHAPE departure 5). */}
        {target.status === 'Published' && <p className={`text-xs ${TONE.info.ink}`}>This shift is published, so the change goes out now.</p>}
      </div>
      <div role="listbox" id={listId} aria-label="Staff" aria-busy={staffLoading || undefined} className="min-h-0 flex-1 overflow-y-auto pb-1">
        {staffLoading ? (
          // The strip's skeleton look: three muted bars the size of a row.
          [0, 1, 2].map(i => <div key={i} aria-hidden="true" className="mx-3 my-1.5 h-[calc(var(--control-h)_-_12px)] animate-pulse rounded-sm bg-muted" />)
        ) : options.length === 0 ? (
          <p role="presentation" className="px-3 py-2 text-[13px] text-muted-foreground">{q ? `No staff match “${query.trim()}”.` : 'No active staff.'}</p>
        ) : (
          shown.map((group, g) => (
            <div key={group.key} role="group" aria-labelledby={`${listId}-${group.key}`}>
              {/* Sticky, on the card fill, so a long Free list stays named while it scrolls. Not a heading: a heading is not valid inside a listbox. */}
              <div id={`${listId}-${group.key}`} role="presentation" className="sticky top-0 z-10 bg-[var(--color-card)] px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                {group.label}
              </div>
              {group.rows.map((row, r) => (
                <PickOption key={row.key} id={optionId(firstIndex[g] + r)} row={row} active={firstIndex[g] + r === active} onPick={onPick} onHover={() => setActive(firstIndex[g] + r)} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** One person: the strip puck's language (StaffStrip). The flag, the name and "12 / 38 h". Then the leave badge and the Move line, when there is one. Then "Published: tells {name}" when that shift is out. */
function PickOption({ id, row, active, onPick, onHover }: { id: string; row: PickRow; active: boolean; onPick: (row: PickRow) => void; onHover: () => void }) {
  const { person, source } = row
  // Past 38 the figure takes the warning ink. The strip shows the same with its amber meter; a list of meters would read as a bar chart.
  const over = row.hours > WEEK_TARGET_HOURS
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-label={pickOptionName(row)}
      // Focus stays in the search: the browser's mousedown would take it before the click picks (SearchableSelect).
      onMouseDown={e => e.preventDefault()}
      onClick={() => onPick(row)}
      onMouseEnter={onHover}
      className={`flex min-h-[var(--control-h)] cursor-pointer flex-col justify-center px-3 py-1.5 ${active ? 'bg-[var(--color-surface-container-low)]' : 'hover:bg-[var(--color-surface-container-low)]'}`}
    >
      <span className="flex items-center gap-1.5">
        {person.hasExpiredQualifications && <AlertTriangle className="h-3 w-3 shrink-0 text-[var(--color-on-warning-container)]" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={person.fullName}>{person.fullName}</span>
        <span className={`shrink-0 text-xs tabular-nums ${over ? TONE.warning.ink : 'text-muted-foreground'}`}>{formatHoursMeter(row.hours, WEEK_TARGET_HOURS)}</span>
      </span>
      {(row.leave || source) && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {row.leave && <StatusBadge tone={row.leave === 'Approved' ? 'neutral' : 'warning'} label={row.leave === 'Approved' ? 'On leave' : 'Leave pending'} />}
          {source && <span className="min-w-0 truncate">{moveLine(source)}</span>}
        </span>
      )}
      {source?.status === 'Published' && <span className={`text-xs ${TONE.info.ink}`}>Published: tells {firstName(person.fullName)}</span>}
    </div>
  )
}
