import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, Search } from 'lucide-react'
import type { ShiftDto, StaffLeaveDto, StaffListDto } from '@/api/types'
import { SlideOver } from '@/components/SlideOver'
import { useDialogBehavior } from '@/hooks/useDialogBehavior'
import { StatusBadge } from '@/components/StatusBadge'
import { TONE } from '@/lib/tone'
import { formatHoursMeter, formatShiftTimeRange } from '../lib/roster'
import { useWeeklyHoursWarning } from '@/api/hooks/settings'
import { firstName, moveLine, pickName, pickOptionName, pickerGroups, pickerPlacement, swapCandidates, swapOptionName, type PickRow } from '../lib/rosterDrag'

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
  /** Closed without a pick: Escape, a mousedown outside, or the chip gone or scrolled out of the board. */
  onClose: () => void
}

const GROUPS = [
  { key: 'free', label: 'Free at this time' },
  { key: 'move', label: 'On another shift at this time' },
  { key: 'leave', label: 'On leave that day' },
  { key: 'notStarted', label: "Hasn't started yet" },
] as const

/**
 * The staff picker (spec 2026-10-15, decision C; the brief, section 4): a search and the active staff in three groups, for one Needs staff shift. It sorts people by what the board
 * already knows (overlap, leave, hours, the expired flag) and judges nothing: the page sends the pick as a drop would, and the server's findings answer it. It is a panel anchored to
 * its chip from md up, and the house SlideOver below.
 */
export function StaffPicker({ target, sheet, onClose, ...body }: StaffPickerProps) {
  if (!target) return null
  return (
    <PickerShell target={target} name={pickName(target)} title="Assign someone" sheet={sheet} onClose={onClose}>
      {inputRef => <PickerBody target={target} {...body} inputRef={inputRef} />}
    </PickerShell>
  )
}

export type SwapPickerProps = {
  /** The assigned shift whose person is swapped. Null: closed. */
  source: ShiftDto | null
  /** Every shift on the RAW board. */
  shifts: ShiftDto[]
  sheet: boolean
  onPick: (shift: ShiftDto) => void
  onClose: () => void
}

/** The menu's "Swap with…" (the lead's decision 1, 2026-10-15): the plus's shell, listing the shifts a drag swap could land on. The page sends the pick as a drag swap would. */
export function SwapPicker({ source, shifts, sheet, onPick, onClose }: SwapPickerProps) {
  if (!source) return null
  const name = `Swap ${firstName(source.staffName)} with…`
  return (
    <PickerShell target={source} name={name} title={name} sheet={sheet} onClose={onClose}>
      {inputRef => <SwapBody source={source} shifts={shifts} onPick={onPick} inputRef={inputRef} />}
    </PickerShell>
  )
}

/** The house picker shell: `name` is the panel's accessible name, `title` the sheet's heading. The body gets the search's ref, where focus starts. */
type ShellProps = { target: ShiftDto; name: string; title: string; sheet: boolean; onClose: () => void; children: (inputRef: RefObject<HTMLInputElement | null>) => ReactNode }

function PickerShell({ sheet, ...rest }: ShellProps) {
  return sheet ? <PickerSheet {...rest} /> : <PickerPanel {...rest} />
}

/** md and up: a non-modal panel portalled to the body. It follows its chip and closes once the chip leaves the board frame's visible area. */
function PickerPanel({ target, name, onClose, children }: Omit<ShellProps, 'sheet' | 'title'>) {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  const placeRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current
      const chip = document.querySelector<HTMLElement>(`[data-shift-chip="${target.id}"]`)
      if (!panel) return
      if (!chip) return closeRef.current()
      const rect = chip.getBoundingClientRect()
      const frame = chip.closest('.overflow-auto')?.getBoundingClientRect()
      if (frame && (rect.bottom < frame.top || rect.top > frame.bottom || rect.right < frame.left || rect.left > frame.right)) return closeRef.current()
      // Written straight to the node, before paint: no state set in an effect (react-hooks/set-state-in-effect), and no re-render of the list on every scroll event.
      const p = pickerPlacement(rect, { width: window.innerWidth, height: window.innerHeight })
      const px = (n?: number) => (n === undefined ? '' : `${n}px`)
      Object.assign(panel.style, { left: px(p.left), width: px(p.width), maxHeight: px(p.maxHeight), top: px(p.top), bottom: px(p.bottom) })
    }
    placeRef.current = place
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [target.id])
  // And after every render: a refetch can reflow the board under an open panel (a row added above), with no scroll or resize to say so. No dependency list, on purpose.
  useLayoutEffect(() => placeRef.current())

  // The house layer (lead, 2026-10-15): Escape closes this layer only, Tab stays in the panel, focus starts in the search. Not modal, so the page still scrolls;
  // focus goes back to the plus from the page (closePicker), because after a pick it belongs on the shift instead.
  useDialogBehavior({ open: true, onClose, containerRef: panelRef, initialFocusRef: inputRef, lockScroll: false, returnFocus: false })

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
      aria-label={name}
      // Positioned by the layout effect above. The Floating Panel: card fill, --radius-md, the house shadow (StaffStrip's CarriedPuck), no border.
      className="fixed z-50 flex flex-col overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-card)] shadow-[var(--shadow-float)]"
    >
      {children(inputRef)}
    </div>,
    document.body,
  )
}

/** Below md: the house SlideOver (SHAPE departure 6). It brings the focus trap, Escape, the scroll lock and focus return to the plus. A pick closes it, so it has no footer. */
function PickerSheet({ target, title, onClose, children }: Omit<ShellProps, 'sheet' | 'name'>) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <SlideOver
      open
      onClose={onClose}
      title={title}
      description={`${target.participantName}, ${format(parseISO(target.serviceDate), 'EEE d MMM')}, ${formatShiftTimeRange(target.startTime, target.endTime)}`}
      initialFocusRef={inputRef}
      bodyClassName="flex flex-col overflow-hidden p-0"
    >
      {children(inputRef)}
    </SlideOver>
  )
}

type BodyProps = Omit<StaffPickerProps, 'target' | 'sheet' | 'onClose'> & {
  target: ShiftDto
  inputRef: RefObject<HTMLInputElement | null>
}

/** The keyboard model both bodies share: focus stays in the search; the active option is virtual (aria-activedescendant), as in SearchableSelect. */
function useListbox<R>(options: R[], onPick: (row: R) => void) {
  const listId = useId()
  const [active, setActive] = useState(-1)
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
    }
  }
  return { listId, active, setActive, optionId, handleKeyDown, activeId: active >= 0 && active < options.length ? optionId(active) : undefined }
}

/** SearchInput's look; it takes no ref and no combobox role, so the input is written out here. */
function PickerSearch({ inputRef, listId, activeId, value, onChange, onKeyDown }: {
  inputRef: RefObject<HTMLInputElement | null>; listId: string; activeId?: string; value: string; onChange: (value: string) => void; onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
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
        aria-activedescendant={activeId}
        autoComplete="off"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="h-[var(--control-h)] w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-input)] pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
      />
    </div>
  )
}

const OPTION = 'flex min-h-[var(--control-h)] cursor-pointer px-3 py-1.5'
const optionFill = (active: boolean) => (active ? 'bg-[var(--color-surface-container-low)]' : 'hover:bg-[var(--color-surface-container-low)]')

/** The search, the Published line and the grouped listbox. */
function PickerBody({ target, staff, staffLoading, shifts, leave, hours, onPick, inputRef }: BodyProps) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const groups = useMemo(() => pickerGroups(target, staff, shifts, leave, hours), [target, staff, shifts, leave, hours])
  // The search matches any part of the full name, ignoring case, in every group. An empty group draws no label.
  const shown = GROUPS.map(g => ({ ...g, rows: groups[g.key].filter(r => !q || r.person.fullName.toLowerCase().includes(q)) })).filter(g => g.rows.length > 0)
  const options = shown.flatMap(g => g.rows)
  const firstIndex = shown.map((_, i) => shown.slice(0, i).reduce((n, g) => n + g.rows.length, 0))
  const { listId, active, setActive, optionId, handleKeyDown, activeId } = useListbox(options, onPick)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-1.5 p-2">
        <PickerSearch inputRef={inputRef} listId={listId} activeId={activeId} value={query} onChange={v => { setQuery(v); setActive(-1) }} onKeyDown={handleKeyDown} />
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

/** The swap picker's body: the search and one flat list, the person then the day and time (the lead's decision 1). The person is the visible lead, so the search matches their name. */
function SwapBody({ source, shifts, onPick, inputRef }: { source: ShiftDto; shifts: ShiftDto[]; onPick: (shift: ShiftDto) => void; inputRef: RefObject<HTMLInputElement | null> }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const candidates = useMemo(() => swapCandidates(source, shifts), [source, shifts])
  const options = candidates.filter(s => !q || (s.staffName ?? '').toLowerCase().includes(q))
  const { listId, active, setActive, optionId, handleKeyDown, activeId } = useListbox(options, onPick)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-2">
        <PickerSearch inputRef={inputRef} listId={listId} activeId={activeId} value={query} onChange={v => { setQuery(v); setActive(-1) }} onKeyDown={handleKeyDown} />
      </div>
      <div role="listbox" id={listId} aria-label="Shifts" className="min-h-0 flex-1 overflow-y-auto pb-1">
        {options.length === 0 ? (
          <p role="presentation" className="px-3 py-2 text-[13px] text-muted-foreground">{q ? `No staff match “${query.trim()}”.` : 'No one else is rostered this week to swap with.'}</p>
        ) : options.map((shift, i) => (
          <div
            key={shift.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            aria-label={swapOptionName(shift)}
            // Focus stays in the search: the browser's mousedown would take it before the click picks (SearchableSelect).
            onMouseDown={e => e.preventDefault()}
            onClick={() => onPick(shift)}
            onMouseEnter={() => setActive(i)}
            className={`${OPTION} items-center gap-1 ${optionFill(i === active)}`}
          >
            <span className="min-w-0 truncate text-sm font-medium text-foreground" title={shift.staffName ?? undefined}>{shift.staffName}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">· {format(parseISO(shift.serviceDate), 'EEE')} {formatShiftTimeRange(shift.startTime, shift.endTime)} · {firstName(shift.participantName)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One person: the strip puck's language (StaffStrip). The flag, the name and "12 / 38 h". Then the leave badge and the Move line, when there is one. Then "Published: tells {name}" when that shift is out. */
function PickOption({ id, row, active, onPick, onHover }: { id: string; row: PickRow; active: boolean; onPick: (row: PickRow) => void; onHover: () => void }) {
  const { person, source } = row
  const weeklyHours = useWeeklyHoursWarning()
  // Past the organisation's weekly figure the hours take the warning ink. The strip shows the same with its amber meter; a list of meters would read as a bar chart.
  const over = row.hours > weeklyHours
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-label={pickOptionName(row, weeklyHours)}
      // Focus stays in the search: the browser's mousedown would take it before the click picks (SearchableSelect).
      onMouseDown={e => e.preventDefault()}
      onClick={() => onPick(row)}
      onMouseEnter={onHover}
      className={`${OPTION} flex-col justify-center ${optionFill(active)}`}
    >
      <span className="flex items-center gap-1.5">
        {person.hasExpiredQualifications && <AlertTriangle className="h-3 w-3 shrink-0 text-[var(--color-on-warning-container)]" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={person.fullName}>{person.fullName}</span>
        <span className={`shrink-0 text-xs tabular-nums ${over ? TONE.warning.ink : 'text-muted-foreground'}`}>{formatHoursMeter(row.hours, weeklyHours)}</span>
      </span>
      {(row.leave || row.notStarted || source) && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {row.leave && <StatusBadge tone={row.leave === 'Approved' ? 'neutral' : 'warning'} label={row.leave === 'Approved' ? 'On leave' : 'Leave pending'} />}
          {row.notStarted && <StatusBadge tone="neutral" label="Hasn't started yet" />}
          {source && <span className="min-w-0 truncate">{moveLine(source)}</span>}
        </span>
      )}
      {source?.status === 'Published' && <span className={`text-xs ${TONE.info.ink}`}>Published: tells {firstName(person.fullName)}</span>}
    </div>
  )
}
