import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Check, Plus } from 'lucide-react'
import type { AgreementState, PlanDayName, PlanPriceZone, PlanPricingSettingsDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import { SlideOver } from '@/components/SlideOver'
import { useIsBelowLg } from '@/hooks/useIsBelowLg'
import { plural } from '@/lib/format'
import { writtenDay } from '@/lib/fundingPlan'
import {
  appendShifts, blocksToShifts, chargeHolidaysByDefault, limitMessage, newShift, overlappingShiftIds, patchShift, selectionTitle, shiftLabel, type EngineLimits, type Shift,
} from '@/lib/agreementShifts'
import { PLAN_DAYS, clock, endsNextDay, toMinutes } from '@/lib/planBlocks'
import { PLAN_TEMPLATES, templateByKey } from '@/lib/planTemplates'
import { TONE } from '@/lib/tone'
import { ShiftEditor, type ShiftPatch } from './ShiftEditor'

type WeekStepProps = {
  shifts: Shift[]
  onChange: (shifts: Shift[]) => void
  selected: string[]
  onSelect: (ids: string[]) => void
  state: AgreementState
  zone: PlanPriceZone
  settings?: PlanPricingSettingsDto
  /** Shifts the pricing has something to say about: a chip marks them. */
  flagged: ReadonlySet<string>
  from: string
  to: string
  /** Nobody can change this agreement (a person who only reads, or one that was approved): the schedule is shown and nothing more. */
  readOnly: boolean
  limits: EngineLimits
}

const PRESETS = PLAN_TEMPLATES.filter(template => template.key !== 'blank').map(template => ({ value: template.key, label: template.title, description: template.summary }))
const WEEKDAYS = PLAN_DAYS.slice(0, 5)
const byStart = (a: Shift, b: Shift) => toMinutes(a.block.start) - toMinutes(b.block.start)

/**
 * The Week step: the schedule as seven days, each with its shifts as chips to select, and ONE editor for whatever is selected. A day can hold several shifts. The grid is a group of toggle
 * buttons (`aria-pressed`); arrows move between shifts, Space toggles, Enter edits, Delete removes (with Undo). From lg the editor is docked beside the grid; below it, it is a panel over the
 * page, opened by "Edit" or by adding a shift. Days run down the page rather than across it: the editor takes a third of the step, and seven columns would leave each chip about 70px.
 */
export function WeekStep({ shifts, onChange, selected, onSelect, state, zone, settings, flagged, from, to, readOnly, limits }: WeekStepProps) {
  const belowLg = useIsBelowLg()
  const [editing, setEditing] = useState(false)
  const [undo, setUndo] = useState<{ before: Shift[]; after: Shift[]; count: number } | null>(null)
  const anchor = useRef<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const editorHeading = useRef<HTMLHeadingElement>(null)
  const focusLater = useRef<(() => void) | null>(null)
  const clash = useMemo(() => overlappingShiftIds(shifts), [shifts])
  const ordered = useMemo(() => PLAN_DAYS.flatMap(day => shifts.filter(shift => shift.day === day).sort(byStart)), [shifts])
  const selectedShifts = ordered.filter(shift => selected.includes(shift.id))
  const open = !readOnly && selectedShifts.length > 0

  // Focus that has to wait for the render that follows an action (the shift that took a removed one's place, the editor's heading after Enter).
  useEffect(() => {
    focusLater.current?.()
    focusLater.current = null
  })

  const add = (day: PlanDayName) => {
    const added = newShift(day, shifts, state, zone)
    onChange([...shifts, added])
    onSelect([added.id])
    setEditing(true)
    focusLater.current = () => editorHeading.current?.focus()
  }
  // Done (and Escape in the phone panel, which useDialogBehavior closes through onClose): the edit is over, so the selection goes and focus returns to where the coordinator was in the grid.
  const finish = () => {
    const first = selectedShifts[0]?.id
    focusLater.current = () => grid.current?.querySelector<HTMLElement>(`[data-shift-id="${first}"]`)?.focus()
    setEditing(false)
    onSelect([])
  }
  const toggle = (id: string, range: boolean) => {
    const from = anchor.current ? ordered.findIndex(shift => shift.id === anchor.current) : -1
    const at = ordered.findIndex(shift => shift.id === id)
    if (range && from >= 0) {
      const [low, high] = from < at ? [from, at] : [at, from]
      onSelect([...new Set([...selected, ...ordered.slice(low, high + 1).map(shift => shift.id)])])
    } else {
      onSelect(selected.includes(id) ? selected.filter(other => other !== id) : [...selected, id])
    }
    anchor.current = id
  }
  const remove = (ids: string[]) => {
    const at = ordered.findIndex(shift => ids.includes(shift.id))
    const next = ordered.find((shift, index) => index > at && !ids.includes(shift.id)) ?? [...ordered].reverse().find(shift => !ids.includes(shift.id))
    const after = shifts.filter(shift => !ids.includes(shift.id))
    const day = ordered[at]?.day
    onChange(after)
    onSelect(selected.filter(id => !ids.includes(id)))
    setUndo({ before: shifts, after, count: ids.length })
    focusLater.current = () => (next ? grid.current?.querySelector<HTMLElement>(`[data-shift-id="${next.id}"]`) : grid.current?.querySelector<HTMLElement>(`[data-add="${day}"]`))?.focus()
  }
  const patchSelected = (patch: ShiftPatch) => onChange(shifts.map(shift => (selected.includes(shift.id) ? patchShift(shift, patch) : shift)))
  const addPreset = (key: string) => {
    const template = templateByKey(key)
    if (template) onChange(appendShifts(shifts, chargeHolidaysByDefault(blocksToShifts([template.build('b1', state, zone)]))))
  }

  const move = (event: KeyboardEvent<HTMLElement>, shift: Shift) => {
    const chips = [...(grid.current?.querySelectorAll<HTMLElement>('[data-shift-id]') ?? [])]
    const sameDay = ordered.filter(other => other.day === shift.day)
    const index = sameDay.findIndex(other => other.id === shift.id)
    const focusShift = (target?: Shift) => { if (target) chips.find(chip => chip.dataset.shiftId === target.id)?.focus() }
    switch (event.key) {
      case 'ArrowRight': focusShift(sameDay[index + 1]); break
      case 'ArrowLeft': focusShift(sameDay[index - 1]); break
      case 'ArrowDown': case 'ArrowUp': {
        const step = event.key === 'ArrowDown' ? 1 : -1
        const dayAt = PLAN_DAYS.indexOf(shift.day)
        for (let d = dayAt + step; d >= 0 && d < 7; d += step) {
          const there = ordered.filter(other => other.day === PLAN_DAYS[d])
          if (there.length > 0) { focusShift(there[Math.min(index, there.length - 1)]); break }
        }
        break
      }
      case 'Enter':
        if (!selected.includes(shift.id)) onSelect([shift.id])
        setEditing(true)
        focusLater.current = () => editorHeading.current?.focus()
        break
      case 'Delete': case 'Backspace': remove(selected.includes(shift.id) ? selected : [shift.id]); break
      default: return
    }
    event.preventDefault()
  }

  const title = selectionTitle(selectedShifts)
  const editor = open && (
    <ShiftEditor shifts={selectedShifts} onPatch={patchSelected} onRemove={() => { remove(selected); setEditing(false) }} onDone={finish} settings={settings} limitNotice={limitMessage(limits)} />
  )
  const note = limitMessage(limits)

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && <Dropdown variant="menu" label="Start from a common week" items={PRESETS} onSelect={addPreset} align="left" />}
        {!readOnly && shifts.length > 0 && (
          <>
            <Button variant="secondary" onClick={() => onSelect(ordered.filter(shift => WEEKDAYS.includes(shift.day)).map(shift => shift.id))}>Select weekdays</Button>
            {!belowLg && selected.length > 0 && <Button variant="ghost" onClick={() => onSelect([])}>Clear selection</Button>}
          </>
        )}
      </div>
      <p className="text-sm text-[var(--color-muted-foreground)]">
        {shifts.length === 0 && !readOnly && <span className="mb-1 block font-medium text-[var(--color-foreground)]">Click a day to add a shift</span>}
        {belowLg && shifts.length > 0 && !readOnly && <span className="mb-1 block">Tap shifts to select them</span>}
        {from && to ? `Repeats every week from ${writtenDay(from)} to ${writtenDay(to)}.` : 'Repeats every week. Set the agreement dates in the first step.'}
      </p>
      {!readOnly && belowLg && selectedShifts.length > 0 && (
        <div role="group" aria-label="Selected shifts" className="sticky top-12 z-20 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-sm">
          <span className="mr-auto text-sm font-medium">{selectedShifts.length} selected</span>
          <Button aria-label={`Edit ${plural(selectedShifts.length, 'shift')}`} onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="ghost" aria-label="Clear selection" onClick={() => onSelect([])}>Clear</Button>
        </div>
      )}
      {note && !open && <p role="alert" className={`text-sm ${TONE.warning.ink}`}>{note}</p>}

      <div className="flex flex-col gap-[var(--section-gap)] lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div ref={grid} role="group" aria-label="Weekly schedule" className="flex min-w-0 flex-col gap-2">
          {PLAN_DAYS.map(day => {
            const there = ordered.filter(shift => shift.day === day)
            const allOn = there.length > 0 && there.every(shift => selected.includes(shift.id))
            return (
              <div key={day} className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-2 sm:flex-row sm:items-start">
                {readOnly || there.length === 0 ? (
                  <p className={`flex min-h-[var(--control-h)] items-center text-sm font-semibold sm:w-32 sm:shrink-0${readOnly ? '' : ' pl-6'}`}>{day}</p>
                ) : (
                  <label className="flex min-h-[var(--control-h)] cursor-pointer items-center gap-2 text-sm font-semibold sm:w-32 sm:shrink-0">
                    <input type="checkbox" checked={allOn} onChange={() => onSelect(allOn ? selected.filter(id => !there.some(shift => shift.id === id)) : [...new Set([...selected, ...there.map(shift => shift.id)])])} />
                    <span>{day}<span className="sr-only"> (select all its shifts)</span></span>
                  </label>
                )}
                <div className="flex min-h-[var(--control-h)] min-w-0 flex-1 flex-wrap items-center gap-2">
                  {there.map(shift => {
                    const on = selected.includes(shift.id)
                    const marks = [clash.has(shift.id) ? 'overlaps another shift' : '', flagged.has(shift.id) ? 'needs attention' : ''].filter(Boolean)
                    const text = (
                      <>
                        <span className="flex items-center gap-1 font-medium tabular-nums">
                          {!readOnly && on && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                          {marks.length > 0 && <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${on ? '' : TONE.warning.ink}`} aria-hidden="true" />}
                          {clock(shift.block.start)} to {clock(shift.block.end)}{endsNextDay(shift.block) && <span className="text-xs font-normal"> +1 day</span>}
                        </span>
                        <span className="text-xs">{`${shiftLabel(shift).split(' · ').slice(1).join(' · ')}`}</span>
                      </>
                    )
                    const name = `${day} ${shiftLabel(shift)}${marks.length > 0 ? `, ${marks.join(', ')}` : ''}`
                    return readOnly ? (
                      <p key={shift.id} aria-label={name} className="flex min-h-[var(--control-h)] flex-col justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1 text-sm">{text}</p>
                    ) : (
                      <button
                        key={shift.id}
                        type="button"
                        aria-pressed={on}
                        aria-label={name}
                        data-shift-id={shift.id}
                        onClick={event => toggle(shift.id, event.shiftKey)}
                        onKeyDown={event => move(event, shift)}
                        className={`flex min-h-[var(--control-h)] flex-col justify-center rounded-[var(--radius-sm)] border px-3 py-1 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
                          on ? 'border-transparent bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)]'}`}
                      >
                        {text}
                      </button>
                    )
                  })}
                  {!readOnly && (
                    <Button variant="ghost" size="sm" data-add={day} aria-label={`Add a shift on ${day}`} onClick={() => add(day)}><Plus className="h-4 w-4" aria-hidden="true" />Add</Button>
                  )}
                </div>
              </div>
            )
          })}
          <div role="status" aria-live="polite" className="min-h-5 text-sm">
            {undo && shifts === undo.after && (
              <span className="flex items-center gap-2">{plural(undo.count, 'shift')} removed. <Button variant="secondary" size="sm" onClick={() => { onChange(undo.before); setUndo(null) }}>Undo</Button></span>
            )}
          </div>
        </div>

        {!readOnly && !belowLg && (
          <aside aria-label="Shift editor" className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] lg:sticky lg:top-20 lg:max-h-[calc(100vh-10.5rem)] lg:overflow-y-auto">
            <h3 ref={editorHeading} tabIndex={-1} className="mb-[var(--section-gap)] text-base font-semibold focus:outline-none">{open ? title : 'Shift editor'}</h3>
            {open ? editor : <p className="text-sm text-[var(--color-muted-foreground)]">Select one or more shifts to change their times, support and more together, or click a day to add one.</p>}
          </aside>
        )}
      </div>

      {!readOnly && belowLg && (
        <SlideOver open={editing && open} onClose={finish} title={title} size="lg">
          {editor}
        </SlideOver>
      )}
    </div>
  )
}
