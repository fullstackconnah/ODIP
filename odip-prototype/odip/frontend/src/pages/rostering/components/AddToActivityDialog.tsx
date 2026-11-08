import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { GroupActivityDto, ShiftDto } from '@/api/types'
import { useAttachShifts } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Modal } from '@/components/Modal'
import { plural } from '@/lib/format'
import { extractErrorMessage } from '@/lib/utils'
import { formatShiftTimeRange } from '../lib/roster'
import { firstName } from '../lib/rosterDrag'

export type AddToActivityDialogProps = {
  /** The shift being added; null keeps the dialog closed. The parent keys it by shift. */
  shift: ShiftDto | null
  /** The board's activities (any day): the dialog lists that shift's day. */
  activities: GroupActivityDto[]
  onClose: () => void
  /** "New activity": the parent opens the group modal prefilled from the shift. */
  onNew: (shift: ShiftDto) => void
  onAttached: (activity: GroupActivityDto, shift: ShiftDto) => void
}

const NEW = '__new__'
const hhmm = (t: string) => t.slice(0, 5)
// U+2060 after each en dash so a range never breaks inside.
const range = (start: string, end: string) => formatShiftTimeRange(start, end).replace(/–/g, '–⁠')

/** "Add to an activity…" (SHAPE section 6.2): a radio list of the day's activities and New activity; a different time range asks first. */
export function AddToActivityDialog({ shift, activities, onClose, onNew, onAttached }: AddToActivityDialogProps) {
  const attach = useAttachShifts()
  const [choice, setChoice] = useState<string>('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!shift) return null
  const day = activities.filter(a => a.serviceDate === shift.serviceDate && a.status !== 'Cancelled')
  const picked = day.find(a => a.id === choice)
  const first = firstName(shift.participantName)
  const differs = picked ? hhmm(picked.startTime) !== hhmm(shift.startTime) || hhmm(picked.endTime) !== hhmm(shift.endTime) : false
  const weekday = format(parseISO(shift.serviceDate), 'EEEE d MMM')

  async function attachTo(activity: GroupActivityDto) {
    setError(null)
    try {
      await attach.mutateAsync({ id: activity.id, shiftIds: [shift!.id] })
      onAttached(activity, shift!)
    } catch (err) {
      setError(extractErrorMessage(err, `Couldn't add ${first} to ${activity.title}.`))
      setConfirming(false)
    }
  }

  function next() {
    if (choice === NEW) onNew(shift!)
    else if (picked && differs && !confirming) setConfirming(true)
    else if (picked) void attachTo(picked)
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={confirming ? `Change ${first}'s times?` : `Add ${first} to an activity`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {confirming ? <Button variant="secondary" onClick={() => setConfirming(false)}><span className="whitespace-nowrap">Back</span></Button> : <Button variant="secondary" onClick={onClose}><span className="whitespace-nowrap">Cancel</span></Button>}
          <Button onClick={next} disabled={!choice || attach.isPending}><span className="whitespace-nowrap">{confirming ? 'Add to activity' : 'Continue'}</span></Button>
        </div>
      }
    >
      {confirming && picked ? (
        <p className="text-sm">Agreement {range(shift.startTime, shift.endTime)}, activity {range(picked.startTime, picked.endTime)}. {first}'s shift moves to the activity's times.</p>
      ) : (
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Activity</legend>
          {day.length === 0 && <p className="mb-1 text-sm text-muted-foreground">No activities on {weekday} yet.</p>}
          {day.map(a => (
            <Choice key={a.id} value={a.id} checked={choice === a.id} onChange={setChoice} label={a.title} sub={`${range(a.startTime, a.endTime)} · ${plural(a.participants.filter(p => !p.didNotAttend).length, 'person', 'people')}`} />
          ))}
          <Choice value={NEW} checked={choice === NEW} onChange={setChoice} label="New activity" />
        </fieldset>
      )}
      {error && <div className="mt-3"><Callout tone="danger">{error}</Callout></div>}
    </Modal>
  )
}

function Choice({ value, checked, onChange, label, sub }: { value: string; checked: boolean; onChange: (v: string) => void; label: string; sub?: string }) {
  return (
    <label className="flex min-h-[var(--control-h)] cursor-pointer items-center gap-2 rounded-sm px-2 hover:bg-accent/60 pointer-coarse:min-h-[var(--tap-min)]">
      <input type="radio" name="activity" value={value} checked={checked} onChange={() => onChange(value)} className="h-4 w-4 shrink-0" />
      <span className="flex min-w-0 flex-col"><span className="text-sm font-medium">{label}</span>{sub && <span className="text-xs text-muted-foreground">{sub}</span>}</span>
    </label>
  )
}
