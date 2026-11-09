import { useRef, useState } from 'react'
import { ChevronDown, MapPin, WifiOff } from 'lucide-react'
import { addDays, format, parseISO } from 'date-fns'
import { useFinishActivityShift, useSetActivityAttendance, useStartActivityShift } from '@/api/hooks'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { StatusBadge } from '@/components/StatusBadge'
import { fieldSurface } from '@/components/FormField'
import { formatShiftTimeRange, formatDayAccessibleName } from '@/pages/rostering/lib/roster'
import { firstName } from '@/pages/rostering/lib/rosterDrag'
import { apiErrorCode, apiErrorMessages, apiErrorStatus } from '@/lib/shiftPackageErrors'
import { formatWithTimeZone } from '@/lib/utils'
import { requestGeolocation } from '../shift/geolocation'
import { providerLocalToUtcInstant, utcInstantToProviderLocal } from '../shift/shiftTime'
import { useOnline } from '../shift/useOnline'
import { ShiftNotesSection } from './ShiftNotesSection'
import type { PortalActivityShiftDto, PortalActivityState } from '@/api/types'
import type { Tone } from '@/lib/tone'

const STATE_BADGE: Record<PortalActivityState, { label: string; tone: Tone }> = {
  NotStarted: { label: 'Not started', tone: 'neutral' },
  Started: { label: 'In progress', tone: 'info' },
  Finished: { label: 'Waiting for approval', tone: 'warning' },
  Approved: { label: 'Approved', tone: 'success' },
}

/** The server's wording for the typed start and the break pair (PortalActivityShiftsController), so a client check and a server refusal read the same. */
export const ACTIVITY_START_MESSAGE = 'Enter a start time in the last 24 hours.'
export const ACTIVITY_BREAK_PAIR_MESSAGE = 'Enter both break times, or neither.'
export const ACTIVITY_BREAK_RANGE_MESSAGE = 'The break must fall between the start and finish.'
const DAY_MS = 24 * 60 * 60 * 1000
const OFFLINE_HELP = "You're offline. Start, finish and attendance need a connection."

const fieldClass = `w-full py-2 min-h-[var(--control-h)] text-sm ${fieldSurface}`
const muted = 'text-sm text-[var(--color-muted-foreground)]'

/** Whether the planned end (provider wall clock) has passed. A string compare of "YYYY-MM-DDTHH:mm" is exact in one zone. */
function plannedEndPassed(shift: PortalActivityShiftDto, now: Date, tz: string): boolean {
  const day = shift.endsNextDay ? format(addDays(parseISO(shift.serviceDate.slice(0, 10)), 1), 'yyyy-MM-dd') : shift.serviceDate.slice(0, 10)
  return utcInstantToProviderLocal(now.toISOString(), tz) >= `${day}T${shift.endTime.slice(0, 5)}`
}

/** One field's inline error, tied to its input by aria-describedby. */
function FieldError({ id, message }: { id: string; message: string | null }) {
  return message ? <p id={id} role="alert" className="mt-1 text-xs text-[var(--color-destructive)]">{message}</p> : null
}

function FinishSheet({ shift, tz, now, onClose, onFinished }: { shift: PortalActivityShiftDto; tz: string; now: Date; onClose: () => void; onFinished: () => void }) {
  const finish = useFinishActivityShift()
  const needsStart = shift.state === 'NotStarted'
  const [start, setStart] = useState('')
  const [addBreak, setAddBreak] = useState(false)
  const [breakStart, setBreakStart] = useState('')
  const [breakEnd, setBreakEnd] = useState('')
  const [startError, setStartError] = useState<string | null>(null)
  const [breakError, setBreakError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setStartError(null); setBreakError(null); setError(null)
    const utc = (local: string) => (local ? providerLocalToUtcInstant(local, tz) : null)
    const startUtc = needsStart ? utc(start) : null
    const startMs = startUtc ? Date.parse(startUtc) : null
    if (needsStart && (startMs === null || startMs >= now.getTime() || startMs < now.getTime() - DAY_MS)) return setStartError(ACTIVITY_START_MESSAGE)
    const bs = addBreak ? utc(breakStart) : null
    const be = addBreak ? utc(breakEnd) : null
    if (addBreak && (breakStart === '') !== (breakEnd === '')) return setBreakError(ACTIVITY_BREAK_PAIR_MESSAGE)
    if (bs && be) {
      const lower = startMs ?? (shift.actualStart ? Date.parse(shift.actualStart) : null)
      if (Date.parse(be) <= Date.parse(bs) || Date.parse(be) > now.getTime() || (lower !== null && Date.parse(bs) < lower)) return setBreakError(ACTIVITY_BREAK_RANGE_MESSAGE)
    }
    finish.mutate({ id: shift.id, data: { ...(startUtc ? { actualStart: startUtc } : {}), ...(bs && be ? { breakStart: bs, breakEnd: be } : {}) } }, {
      onSuccess: onFinished,
      onError: e => {
        const message = apiErrorMessages(e)[0] ?? "Couldn't finish this shift. Try again."
        const code = apiErrorCode(e)
        if (code === 'GA_TIMES') setStartError(message)
        else if (code === 'GA_BREAK' || code === 'GA_BREAK_RANGE') setBreakError(message)
        else setError(message)
      },
    })
  }

  return (
    <Modal
      open
      onClose={finish.isPending ? () => {} : onClose}
      title="Finish shift"
      size="md"
      closeOnBackdrop={false}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={finish.isPending}>Cancel</Button>
          <Button size="lg" onClick={submit} disabled={finish.isPending}>{finish.isPending ? 'Finishing…' : 'Finish shift'}</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        {needsStart && (
          <div>
            <label htmlFor="activity-start" className="text-sm font-medium">Start time</label>
            <input
              id="activity-start" type="datetime-local" className={fieldClass} value={start} autoFocus
              aria-invalid={startError ? true : undefined} aria-describedby={startError ? 'activity-start-error' : undefined}
              onChange={e => { setStart(e.target.value); setStartError(null) }}
            />
            <FieldError id="activity-start-error" message={startError} />
          </div>
        )}
        {!addBreak ? (
          <Button variant="ghost" size="md" onClick={() => setAddBreak(true)}>Add a break</Button>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="activity-break-start" className="text-sm font-medium">Break start</label>
              <input id="activity-break-start" type="datetime-local" className={fieldClass} value={breakStart} aria-invalid={breakError ? true : undefined}
                aria-describedby={breakError ? 'activity-break-error' : undefined} onChange={e => { setBreakStart(e.target.value); setBreakError(null) }} />
            </div>
            <div>
              <label htmlFor="activity-break-end" className="text-sm font-medium">Break end</label>
              <input id="activity-break-end" type="datetime-local" className={fieldClass} value={breakEnd} aria-invalid={breakError ? true : undefined}
                aria-describedby={breakError ? 'activity-break-error' : undefined} onChange={e => { setBreakEnd(e.target.value); setBreakError(null) }} />
              <FieldError id="activity-break-error" message={breakError} />
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
      </div>
    </Modal>
  )
}

/**
 * One participant's attendance (ga-portal-attendance): a badge when they did not attend, and one persistent button that marks or undoes it.
 * Only the server's answer flips the badge (no optimistic change), so a refusal never flips back. Saving and the error are this row's own.
 */
function ParticipantAttendance({ rowId, person, editable, online, onDone }: { rowId: string; person: PortalActivityShiftDto['participants'][number]; editable: boolean; online: boolean; onDone: (message: string) => void }) {
  const set = useSetActivityAttendance()
  const [error, setError] = useState<string | null>(null)
  const marking = !person.didNotAttend
  const tap = () => {
    if (set.isPending) return
    setError(null)
    set.mutate({ id: rowId, participantId: person.participantId, attended: !marking }, {
      onSuccess: () => onDone(marking ? `Marked ${person.name} as didn't attend.` : `Undid didn't attend for ${person.name}.`),
      onError: e => setError(apiErrorMessages(e)[0] ?? (apiErrorStatus(e) === 404 ? 'This shift is no longer available.' : marking ? `Couldn't mark ${firstName(person.name)} as didn't attend.` : `Couldn't undo for ${firstName(person.name)}.`)),
    })
  }
  return (
    <>
      <div className="flex min-h-[var(--control-h)] items-center justify-between gap-2">
        <span className="flex items-center">{person.didNotAttend && <StatusBadge tone="neutral" label="Didn't attend" />}</span>
        {editable && (
          <Button
            variant="secondary" size="md" className="whitespace-nowrap" disabled={!online} aria-disabled={set.isPending || undefined} onClick={tap}
            aria-label={marking ? `Mark ${person.name} as didn't attend` : `Undo didn't attend for ${person.name}`}
          >
            {/* One grid holds every label so the button is as wide as the widest and never resizes under the finger. */}
            <span className="grid">
              {([["Didn't attend", marking && !set.isPending], ['Undo', !marking && !set.isPending], ['Saving…', set.isPending]] as const).map(([label, on]) => (
                <span key={label} className={`[grid-area:1/1] ${on ? '' : 'invisible'}`}>{label}</span>
              ))}
            </span>
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-destructive)]">{error}</p>}
    </>
  )
}

/**
 * A worker's row on a group activity (GA PR3): Start, Finish, the planned and recorded times, and the participants with their notes.
 * Live only: with no signal both buttons are disabled and the card says why. A refused write shows the server's words under the button
 * and the list refetches, so a row the server no longer has drops out.
 */
export function ActivityShiftCard({ shift, tz, now }: { shift: PortalActivityShiftDto; tz: string; now: Date }) {
  const online = useOnline()
  const start = useStartActivityShift()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [notesFor, setNotesFor] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const finishButton = useRef<HTMLButtonElement>(null)

  const showFinish = shift.state === 'Started' || (shift.state === 'NotStarted' && plannedEndPassed(shift, now, tz))
  const showStart = shift.state === 'NotStarted' && !showFinish
  const badge = STATE_BADGE[shift.state]
  const clock = (iso: string) => formatWithTimeZone(iso, tz, { hour: 'numeric', minute: '2-digit' })
  const breakMinutes = shift.breakStartedAt && shift.breakEndedAt ? Math.round((Date.parse(shift.breakEndedAt) - Date.parse(shift.breakStartedAt)) / 60000) : null

  const refused = (e: unknown) => setError(apiErrorMessages(e)[0] ?? (apiErrorStatus(e) === 404 ? 'This shift is no longer available.' : "Couldn't reach Bunya Support. Try again."))
  const doStart = async () => {
    setError(null)
    const fix = await requestGeolocation()
    start.mutate({ id: shift.id, data: fix.ok ? { latitude: fix.latitude, longitude: fix.longitude, accuracyMetres: fix.accuracyMetres } : { geolocationDeclined: true } }, { onError: refused })
  }

  return (
    <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 space-y-3" data-testid="activity-shift-card">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-semibold text-[var(--color-foreground)]">{shift.title}</p>
        <StatusBadge tone={badge.tone} label={badge.label} className="shrink-0 whitespace-nowrap" />
      </div>
      <div className={muted}>
        <p>{formatDayAccessibleName(shift.serviceDate.slice(0, 10))} · {formatShiftTimeRange(shift.startTime, shift.endTime)}{shift.endsNextDay && <span className="ml-1">(+1 day)</span>}</p>
        {shift.location?.trim() && (
          <p className="flex items-center gap-1 min-w-0"><MapPin className="w-3 h-3 shrink-0" aria-hidden /><span className="truncate"><span className="sr-only">Location: </span>{shift.location.trim()}</span></p>
        )}
        {shift.role?.trim() && <p>Role: {shift.role.trim()}</p>}
        {shift.actualStart && <p>Started {clock(shift.actualStart)}</p>}
        {shift.actualEnd && <p>Finished {clock(shift.actualEnd)}{breakMinutes !== null && ` · break ${breakMinutes} min`}</p>}
      </div>

      {(showStart || showFinish) && (
        <div className="space-y-2">
          {showStart ? (
            <Button size="lg" className="w-full" disabled={!online || start.isPending} onClick={doStart}>{start.isPending ? 'Starting…' : 'Start'}</Button>
          ) : (
            <Button ref={finishButton} size="lg" className="w-full" disabled={!online} onClick={() => { setError(null); setSheetOpen(true) }}>Finish</Button>
          )}
          {!online && <p className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]"><WifiOff className="w-3 h-3 shrink-0" aria-hidden />{OFFLINE_HELP}</p>}
          {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
        </div>
      )}

      {shift.participants.length > 0 && (
        <div>
          <AnnouncementRegion message={announce} />
          <button
            type="button" aria-expanded={peopleOpen} aria-controls={`people-${shift.id}`} onClick={() => setPeopleOpen(o => !o)}
            className="flex min-h-[var(--tap-min)] w-full items-center justify-between gap-2 text-sm font-medium"
          >
            <span>Participants ({shift.participants.length})</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${peopleOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {peopleOpen && (
            <ul id={`people-${shift.id}`} className="divide-y divide-[var(--color-border)]">
              {shift.participants.map(p => (
                <li key={p.shiftId} className="py-1">
                  <div className="flex min-h-[var(--control-h)] items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 break-words text-sm [overflow-wrap:anywhere]">{p.name}</span>
                    {/* A marked person's shift is cancelled, so the server has no notes for them (the mark must be undone first). */}
                    {!p.didNotAttend && <Button variant="ghost" size="md" aria-expanded={notesFor === p.shiftId} onClick={() => setNotesFor(n => (n === p.shiftId ? null : p.shiftId))}>Notes</Button>}
                  </div>
                  {(shift.state === 'Started' || p.didNotAttend) && (
                    <ParticipantAttendance rowId={shift.id} person={p} editable={shift.state === 'Started'} online={online} onDone={setAnnounce} />
                  )}
                  {notesFor === p.shiftId && (
                    <ShiftNotesSection
                      shiftId={p.shiftId} participantId={p.participantId} participantName={p.name}
                      serviceDate={shift.serviceDate} startTime={shift.startTime} endTime={shift.endTime} endsNextDay={shift.endsNextDay}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sheetOpen && (
        <FinishSheet
          shift={shift} tz={tz} now={now}
          onClose={() => { setSheetOpen(false); requestAnimationFrame(() => finishButton.current?.focus()) }}
          onFinished={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}
