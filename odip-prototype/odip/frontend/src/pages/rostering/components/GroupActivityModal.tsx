import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarClock, Clock, FileText, UserCheck, Users, X } from 'lucide-react'
import type { GroupActivityDto, GroupActivityFormDto, ShiftDto, SupportRatio } from '@/api/types'
import { SUPPORT_RATIOS } from '@/api/types'
import {
  useActivities, useAddGroupParticipant, useAttachShifts, useCancelGroupActivity, useCreateActivityFromShift, useCreateGroupActivity, useDetachShift, useGroupActivity, useRemoveGroupStaff,
  useServiceLocations, useSetGroupAttendance, useSetGroupRatio, useUpdateGroupActivity,
} from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DiscardChangesDialog } from '@/components/DiscardChangesDialog'
import { FormField, inputClass } from '@/components/FormField'
import { SearchableSelect } from '@/components/SearchableSelect'
import { StatusBadge } from '@/components/StatusBadge'
import { TAP_AREA } from '@/components/tapArea'
import { useDialogBehavior } from '@/hooks/useDialogBehavior'
import { useIsBelowLg } from '@/hooks/useIsBelowLg'
import { formatServiceDate } from '@/lib/format'
import { extractErrorMessage } from '@/lib/utils'
import { useOnline } from '@/pages/portal/shift/useOnline'
import { NO_LENGTH_MESSAGE, hasNoLength } from '../lib/shiftTimes'
import { RATIO_LABELS, formatShiftTimeRange } from '../lib/roster'
import { firstName } from '../lib/rosterDrag'
import { removeFromActivityCopy } from '../lib/groupActivities'
import { StaffPickerPage, type StaffPickerProps } from './StaffPicker'
import { AddButton, HeaderIcon, OverviewRow, PageFrame, PickGroup, PickRow, Skeleton, StepItem } from './GroupActivityParts'

export type ActivityModalTarget = { mode: 'new'; serviceDate: string; fromShift?: ShiftDto } | { mode: 'edit'; id: string }

export type GroupActivityModalProps = {
  target: ActivityModalTarget | null
  canWrite: boolean
  participants: { id: string; fullName: string }[]
  /** The board's staff, shifts, leave and hours: what the staff picker groups people by. */
  pickerData: Omit<StaffPickerProps, 'target' | 'sheet' | 'onClose' | 'onPick'>
  /** The board's shifts, for the "Booked for group support today" group of the participant picker. */
  boardShifts: ShiftDto[]
  /** Add a worker through the board's own write, so a finding that needs a reason opens the same override prompt as a drop. Resolves to a message when the refusal is not about findings. */
  onAddStaff: (activityId: string, staffId: string) => Promise<string | null>
  /** A refusal that arrives after onAddStaff resolved (the override prompt's retry): shown in the callout until the next write here starts. */
  lateRefusal?: string | null
  onLateRefusalClear?: () => void
  onClose: () => void
}

type Form = { title: string; activityId: string; serviceDate: string; startTime: string; endTime: string; endsNextDay: boolean; serviceLocationId: string; location: string; minStaff: string; notes: string }
type PageId = 'when' | 'people' | 'staff' | 'details' | 'pickPerson' | 'pickStaff'

/** Which form fields each page owns: a page's Save sends its own edits on top of what is saved, and leaves the other page's edits where they are. */
const PAGE_KEYS: Record<'when' | 'details', (keyof Form)[]> = {
  when: ['title', 'activityId', 'serviceDate', 'startTime', 'endTime', 'endsNextDay', 'serviceLocationId', 'location'],
  details: ['minStaff', 'notes'],
}
const PARENT: Partial<Record<PageId, PageId>> = { pickPerson: 'people', pickStaff: 'staff' }
const PAGE_TITLE: Record<PageId, string> = { when: 'When and where', people: 'People', staff: 'Staff', details: 'Details', pickPerson: 'Add participant', pickStaff: 'Add staff' }

const hhmm = (t: string) => t.slice(0, 5)
const noBreak = (range: string) => range.replace(/–/g, '–⁠')

function formOf(a: GroupActivityDto | null, target: ActivityModalTarget | null): Form {
  if (a) return { title: a.title, activityId: a.activityId ?? '', serviceDate: a.serviceDate, startTime: hhmm(a.startTime), endTime: hhmm(a.endTime), endsNextDay: a.endsNextDay, serviceLocationId: a.serviceLocationId ?? '', location: a.location ?? '', minStaff: a.minStaffRequired == null ? '' : String(a.minStaffRequired), notes: a.notes ?? '' }
  const shift = target?.mode === 'new' ? target.fromShift : undefined
  return { title: '', activityId: '', serviceDate: shift?.serviceDate ?? (target?.mode === 'new' ? target.serviceDate : ''), startTime: shift ? hhmm(shift.startTime) : '10:00', endTime: shift ? hhmm(shift.endTime) : '14:00', endsNextDay: shift?.endsNextDay ?? false, serviceLocationId: '', location: '', minStaff: '', notes: '' }
}

/** Both-or-neither is the server's rule (GA_TIMES); the form always holds both, so only an end that is not after the start needs a word here. */
function toDto(f: Form): GroupActivityFormDto {
  return {
    serviceDate: f.serviceDate, startTime: f.startTime, endTime: f.endTime, endsNextDay: f.endsNextDay, title: f.title.trim(), activityId: f.activityId || null,
    location: f.location.trim() || null, serviceLocationId: f.serviceLocationId || null, notes: f.notes.trim() || null, minStaffRequired: f.minStaff.trim() === '' ? null : Number(f.minStaff),
  }
}

const minStaffInvalid = (v: string) => v.trim() !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 20)

/**
 * The group-activity sheet (SHAPE direction B): an overview of four rows, each opening its own page. Below lg one pane shows at a time; from lg the overview is a left column and the open page sits beside it.
 * Create walks the same pages (What and when, People, Staff). Fields save per page; participants and staff are immediate writes. The parent keys it by target.
 */
export function GroupActivityModal({ target, canWrite, participants, pickerData, boardShifts, onAddStaff, lateRefusal, onLateRefusalClear, onClose }: GroupActivityModalProps) {
  const open = target !== null
  const [savedId, setSavedId] = useState<string | null>(null)
  const id = target?.mode === 'edit' ? target.id : savedId
  const query = useGroupActivity(id)
  const activity = query.data ?? null
  const isNew = id === null
  const fromShift = target?.mode === 'new' ? target.fromShift : undefined
  const wide = !useIsBelowLg()
  const [page, setPage] = useState<PageId | null>(target?.mode === 'new' ? 'when' : null)
  const [walking, setWalking] = useState(target?.mode === 'new')
  const shown: PageId | null = page ?? (wide ? (isNew ? 'when' : 'people') : null)

  const [edits, setEdits] = useState<Partial<Form>>({})
  const initial = useMemo(() => formOf(activity, target), [activity, target])
  const values: Form = { ...initial, ...edits }
  const set = (patch: Partial<Form>) => setEdits(prev => {
    const next = { ...prev, ...patch }
    for (const k of Object.keys(next) as (keyof Form)[]) if (next[k] === initial[k]) delete next[k]
    return next
  })
  const changed = (k: keyof Form) => k in edits && edits[k] !== initial[k]
  const dirtyIn = (keys: (keyof Form)[]) => keys.some(changed)
  const dirty = (Object.keys(edits) as (keyof Form)[]).some(changed)

  const [tried, setTried] = useState(false)
  const [minTried, setMinTried] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [writeKey, setWriteKey] = useState<string | null>(null)   // which immediate write the error belongs to: a `p:<id>` one shows under that participant row
  const [refusedName, setRefusedName] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [removing, setRemoving] = useState<{ kind: 'participant' | 'staff'; key: string; name: string; run: () => Promise<unknown> } | null>(null)
  const [personSearch, setPersonSearch] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const staffSearchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastRow = useRef<PageId | null>(null)
  const headingId = useId()

  const catalogue = useActivities().data ?? []
  const places = (useServiceLocations().data ?? []).filter(p => p.isActive || p.id === values.serviceLocationId)
  const create = useCreateGroupActivity()
  const createFromShift = useCreateActivityFromShift()
  const update = useUpdateGroupActivity()
  const cancel = useCancelGroupActivity()
  const attach = useAttachShifts()
  const detach = useDetachShift()
  const addPerson = useAddGroupParticipant()
  const setRatio = useSetGroupRatio()
  const removeStaff = useRemoveGroupStaff()
  const setAttendance = useSetGroupAttendance()
  const online = useOnline()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  // After a mark or an undo the button swaps for its twin; focus follows the person's row once the refetch shows the new state.
  const focusAfter = useRef<{ id: string; didNotAttend: boolean } | null>(null)
  useEffect(() => {
    const want = focusAfter.current
    if (!want || pendingKey || activity?.participants.find(p => p.participantId === want.id)?.didNotAttend !== want.didNotAttend) return
    focusAfter.current = null
    document.querySelector<HTMLElement>(`[data-participant-row="${want.id}"] [data-attendance-action]`)?.focus()
  }, [activity, pendingKey])
  const saving = create.isPending || createFromShift.isPending || update.isPending

  const cancelled = activity?.status === 'Cancelled'
  const readOnly = !canWrite || cancelled
  // From the start the participants are final but for attendance: the server refuses Remove and a ratio change there, so neither is offered.
  const started = activity?.status === 'InProgress' || activity?.status === 'PendingReview' || activity?.status === 'Completed'
  const markable = started && canWrite && activity?.status !== 'Completed'
  const fieldsDisabled = readOnly || started
  const staffLocked = readOnly || activity?.status === 'Completed'
  const hasPeople = (activity?.participants.length ?? 0) > 0
  const noLength = hasNoLength(values.startTime, values.endTime, values.endsNextDay)
  const title = isNew ? 'New group activity' : activity?.title || 'Group activity'
  const loading = !isNew && query.isLoading
  const loadFailed = !isNew && query.isError && !activity

  // ── Navigation ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const requestClose = () => { if (dirty) setConfirmDiscard(true); else onClose() }
  const openPage = (p: PageId) => { if (!PARENT[p]) lastRow.current = p; setPage(p) }
  const back = () => setPage(shown && PARENT[shown] ? PARENT[shown]! : null)
  useDialogBehavior({
    open, containerRef: dialogRef, initialFocusRef: titleRef,
    onClose: () => { if (page && !isNew && (!wide || PARENT[page])) back(); else requestClose() },
  })

  // The heading takes focus when a page opens (the title field does on create); back on the overview, the row that opened the page does.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    if (page) headingRef.current?.focus()
    else if (lastRow.current) document.querySelector<HTMLElement>(`[data-overview-row="${lastRow.current}"]`)?.focus()
  }, [page])
  useEffect(() => { if (page === 'pickStaff') staffSearchRef.current?.focus() }, [page])

  /** An immediate write: on a refusal the server's message shows and nothing else changes (the refetch redraws the truth). */
  async function write(key: string, run: () => Promise<unknown>, fallback: string) {
    setWriteError(null)
    setWriteKey(key)
    onLateRefusalClear?.()
    setPendingKey(key)
    try { await run() } catch (err) { setWriteError(extractErrorMessage(err, fallback)) } finally { setPendingKey(null) }
  }

  function markAttendance(p: GroupActivityDto['participants'][number], attended: boolean) {
    if (!activity) return
    focusAfter.current = { id: p.participantId, didNotAttend: !attended }
    void write(`p:${p.participantId}`, () => setAttendance.mutateAsync({ id: activity.id, participantId: p.participantId, attended }),
      attended ? `Couldn't undo for ${firstName(p.participantName)}.` : `Couldn't mark ${firstName(p.participantName)} as didn't attend.`)
  }

  const whenErrors = [!values.title.trim() && 'title', noLength && 'end'].filter(Boolean) as string[]

  async function createDraft() {
    setTried(true)
    if (whenErrors.length) { (whenErrors[0] === 'title' ? titleRef.current : dialogRef.current?.querySelector<HTMLElement>('[data-field="end"]'))?.focus(); return }
    setSaveError(null)
    try {
      const made = fromShift ? await createFromShift.mutateAsync({ shiftId: fromShift.id, title: values.title.trim() }) : await create.mutateAsync(toDto(values))
      setSavedId(made.id)
      setEdits({})
      setTried(false)
      setPage('people')
    } catch (err) {
      setSaveError(`Couldn't save. Your changes are still here. ${extractErrorMessage(err, '')}`.trim())
    }
  }

  /** One page's Save: its own edits go on top of what is saved, so the other page's unsaved edits are neither sent nor lost. */
  async function savePage(which: 'when' | 'details') {
    if (!activity) return
    if (which === 'when') {
      setTried(true)
      if (whenErrors.length) { (whenErrors[0] === 'title' ? titleRef.current : dialogRef.current?.querySelector<HTMLElement>('[data-field="end"]'))?.focus(); return }
    } else {
      setMinTried(true)
      if (minStaffInvalid(values.minStaff)) return
    }
    const keys = PAGE_KEYS[which]
    const merged = { ...initial, ...Object.fromEntries(keys.filter(k => k in edits).map(k => [k, edits[k]])) } as Form
    setSaveError(null)
    try {
      await update.mutateAsync({ id: activity.id, data: toDto(merged), status: activity.status })
      setEdits(prev => { const next = { ...prev }; for (const k of keys) delete next[k]; return next })
      setTried(false)
      setMinTried(false)
    } catch (err) {
      setSaveError(`Couldn't save. Your changes are still here. ${extractErrorMessage(err, '')}`.trim())
    }
  }

  function discardPage(which: 'when' | 'details') {
    setEdits(prev => { const next = { ...prev }; for (const k of PAGE_KEYS[which]) delete next[k]; return next })
    setTried(false); setMinTried(false); setSaveError(null)
    back()
  }

  function setStatus(status: 'Draft' | 'Published') {
    if (activity) void write('status', () => update.mutateAsync({ id: activity.id, data: toDto(initial), status }), status === 'Published' ? "Couldn't publish the activity." : "Couldn't change the activity back to a draft.")
  }

  // ── Picker data ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const staffPickerTarget: ShiftDto | null = activity
    ? { id: activity.id, participantId: '', participantName: activity.title, serviceDate: activity.serviceDate, startTime: activity.startTime, endTime: activity.endTime, endsNextDay: activity.endsNextDay, durationHours: 0, ratio: 'OneToOne', nightType: 'None', status: activity.status, shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false }
    : null
  const staffHere = new Set(activity?.staff.map(s => s.staffId))
  const peopleHere = new Set(activity?.participants.map(p => p.participantId))
  const booked = activity ? boardShifts.filter(s => s.isGroupLine && !s.groupActivityId && s.serviceDate === activity.serviceDate && !peopleHere.has(s.participantId) && s.status !== 'Cancelled') : []
  const search = personSearch.trim().toLowerCase()
  const others = participants.filter(p => !peopleHere.has(p.id) && !booked.some(s => s.participantId === p.id) && p.fullName.toLowerCase().includes(search))

  // ── Overview ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const place = places.find(p => p.id === values.serviceLocationId)?.name
  const timeRange = activity ? noBreak(formatShiftTimeRange(activity.startTime, activity.endTime)) : ''
  const staffShort = activity && !cancelled ? Math.max(0, activity.staffNeeded - activity.staffAssigned) : 0
  const lockedFields = started || cancelled
  const overviewNotice = writeError && (writeKey === 'cancel' || writeKey === 'status') ? writeError : null

  const stepState = (n: number): 'done' | 'now' | 'next' => { const now = isNew ? 1 : shown === 'staff' || shown === 'pickStaff' ? 3 : 2; return n < now ? 'done' : n === now ? 'now' : 'next' }

  const overview = (
    <aside aria-label="Overview" className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-surface-container-low)] lg:w-80 lg:flex-none lg:border-r lg:border-[var(--color-border)]">
      <header className="shrink-0 border-b border-[var(--color-border)] p-[var(--card-pad)]">
        <div className="flex items-start gap-2">
          <h2 id={headingId} ref={shown === null ? headingRef : undefined} tabIndex={-1} className="min-w-0 flex-1 break-words font-display text-lg font-semibold text-[var(--color-foreground)] focus:outline-none">{title}</h2>
          <HeaderIcon label="Close" onClick={requestClose} className="-mr-2 -mt-1 lg:hidden"><X className="h-5 w-5" aria-hidden="true" /></HeaderIcon>
        </div>
        {loading ? <div className="mt-2"><Skeleton lines={1} /></div> : activity ? (
          <>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{formatServiceDate(activity.serviceDate)} · {timeRange}{place ? ` · ${place}` : ''}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={activity.status} label={activity.status === 'InProgress' ? 'In progress' : undefined} />
              {!readOnly && !started && activity.status === 'Draft' && <Button size="sm" onClick={() => setStatus('Published')} disabled={pendingKey === 'status'}>Publish</Button>}
              {!readOnly && !started && activity.status === 'Published' && <Button size="sm" variant="ghost" onClick={() => setStatus('Draft')} disabled={pendingKey === 'status'}>Back to draft</Button>}
              {activity.status === 'Published' && <span className="text-xs text-[var(--color-muted-foreground)]">Workers can see it</span>}
            </div>
          </>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activity && (
          <div className="flex flex-col gap-2 px-4 pt-3 empty:hidden">
            {cancelled && <Callout tone="danger">Cancelled. It stays on the board. No one can be added.</Callout>}
            {!cancelled && activity.status === 'Completed' && <Callout tone="info">Completed. Everything here is read-only.</Callout>}
            {!cancelled && started && activity.status !== 'Completed' && <Callout tone="info">Started. The details are locked. Staff can still change until it ends.</Callout>}
            {!canWrite && <Callout tone="info">Only a SuperAdmin, Admin or Coordinator can change this.</Callout>}
            {overviewNotice && <Callout tone="danger">{overviewNotice}</Callout>}
          </div>
        )}
        {isNew ? (
          <ol aria-label="Steps" className="py-2">
            <StepItem n={1} label="What and when" sub="Title, day and times" state={stepState(1)} />
            <StepItem n={2} label="People" sub="Who is coming" state={stepState(2)} />
            <StepItem n={3} label="Staff" sub="Who supports them" state={stepState(3)} />
          </ol>
        ) : loading ? (
          <div className="p-4"><Skeleton lines={4} /></div>
        ) : activity ? (
          <ul className="py-2">
            <OverviewRow id="when" icon={CalendarClock} label="When and where" value={`${formatServiceDate(activity.serviceDate)} · ${timeRange}`} current={shown === 'when'} locked={lockedFields} onOpen={() => openPage('when')} />
            <OverviewRow id="people" icon={Users} label="People" value={activity.participants.length === 0 ? '0 · No one yet' : `${activity.participants.length} · ${activity.participants.map(p => firstName(p.participantName)).join(', ')}`} current={shown === 'people' || shown === 'pickPerson'} onOpen={() => openPage('people')} />
            <OverviewRow
              id="staff" icon={UserCheck} label="Staff" value={cancelled || !activity.staffNeeded ? String(activity.staffAssigned) : `${activity.staffAssigned} of ${activity.staffNeeded}`}
              extra={staffShort > 0 ? <StatusBadge tone="warning" label={`${staffShort} short`} className="mt-1 inline-block" /> : undefined}
              current={shown === 'staff' || shown === 'pickStaff'} onOpen={() => openPage('staff')}
            />
            <OverviewRow id="details" icon={FileText} label="Details" value={[activity.minStaffRequired != null && `Minimum staff ${activity.minStaffRequired}`, activity.notes && 'Notes added'].filter(Boolean).join(' · ') || 'Minimum staff and notes'} current={shown === 'details'} locked={lockedFields} onOpen={() => openPage('details')} />
          </ul>
        ) : null}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] p-[var(--card-pad)]">
        <div>{!isNew && !readOnly && activity && <Button variant="ghost-danger" onClick={() => setConfirmCancel(true)}>Cancel activity</Button>}</div>
        <Button variant="secondary" onClick={requestClose}><span className="whitespace-nowrap">Close</span></Button>
      </footer>
    </aside>
  )

  // ── Pages ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const closeFooter = <Button variant="secondary" onClick={requestClose}><span className="whitespace-nowrap">Close</span></Button>
  const frame = (p: PageId, hint: string | undefined, footer: ReactNode, body: ReactNode) => (
    <PageFrame
      key={p} title={p === 'when' && isNew ? 'What and when' : PAGE_TITLE[p]} hint={hint} headingId={`${headingId}-${p}`} headingRef={headingRef}
      onBack={isNew && p === 'when' ? undefined : wide && !PARENT[p] ? undefined : back} backLabel={PARENT[p] ? `Back to ${PAGE_TITLE[PARENT[p]!]}` : 'Back to overview'} onClose={requestClose} footer={footer}
    >{body}</PageFrame>
  )
  const saveCallout = saveError && <div className="mb-3"><Callout tone="danger">{saveError}</Callout></div>

  function whenPage() {
    const showErrors = tried && whenErrors.length > 0
    const creating = isNew
    const footer = fieldsDisabled ? closeFooter : creating ? (
      <>
        <Button variant="secondary" onClick={requestClose}>Cancel</Button>
        <Button onClick={createDraft} disabled={saving} aria-busy={saving || undefined}><span className="whitespace-nowrap">{saving ? 'Creating…' : 'Create draft'}</span></Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={() => discardPage('when')}>Cancel</Button>
        <Button onClick={() => void savePage('when')} disabled={saving || !dirtyIn(PAGE_KEYS.when)} aria-busy={saving || undefined}><span className="whitespace-nowrap">{saving ? 'Saving…' : 'Save changes'}</span></Button>
      </>
    )
    return frame('when', creating ? 'Step 1 of 3. People and staff come next.' : undefined, footer, (
      <div className="flex flex-col gap-[var(--field-gap-y)]">
        {saveCallout}
        {showErrors && creating && <Callout tone="danger">{`Fix the ${whenErrors.length} field${whenErrors.length === 1 ? '' : 's'} marked in red, then create the draft.`}</Callout>}
        <FormField label="Title" required error={tried && !values.title.trim() ? 'Add a title.' : undefined}>
          <input ref={titleRef} type="text" value={values.title} maxLength={200} disabled={fieldsDisabled} autoComplete="off" onChange={e => set({ title: e.target.value })} />
        </FormField>
        <FormField label="Activity (optional)">
          <SearchableSelect
            value={values.activityId}
            onChange={v => { const picked = catalogue.find(a => a.id === v); set({ activityId: v, ...(picked && !values.title.trim() ? { title: picked.activityName } : {}) }) }}
            disabled={fieldsDisabled}
            placeholder="None"
            items={[{ value: '', label: 'None' }, ...catalogue.map(a => ({ value: a.id, label: a.activityName }))]}
          />
        </FormField>
        <FormField label="Date" required hint={fromShift && isNew ? 'The date and times come from the shift.' : hasPeople ? 'Remove the participants to move the day.' : undefined}>
          <input type="date" value={values.serviceDate} disabled={fieldsDisabled || Boolean(fromShift && isNew) || hasPeople} onChange={e => set({ serviceDate: e.target.value })} />
        </FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Start" required><input type="time" className="px-1" value={values.startTime} disabled={fieldsDisabled || Boolean(fromShift && isNew)} onChange={e => set({ startTime: e.target.value })} /></FormField>
          <FormField label="End" required error={noLength ? NO_LENGTH_MESSAGE : undefined}><input type="time" data-field="end" className="px-1" value={values.endTime} disabled={fieldsDisabled || Boolean(fromShift && isNew)} onChange={e => set({ endTime: e.target.value })} /></FormField>
        </div>
        <FormField label="Ends the next day" layout="checkbox"><input type="checkbox" checked={values.endsNextDay} disabled={fieldsDisabled || Boolean(fromShift && isNew)} onChange={e => set({ endsNextDay: e.target.checked })} /></FormField>
        {fromShift && isNew ? (
          <div className="rounded-sm border border-border p-2 text-sm">
            <span className="font-medium">{fromShift.participantName}</span>
            <p className="text-xs text-muted-foreground">Adds when you create.</p>
            <p className="mt-1 text-xs text-muted-foreground">Place, location, minimum staff and notes go on Details once the draft exists.</p>
          </div>
        ) : (
          <>
            <FormField label="Service location">
              <SearchableSelect value={values.serviceLocationId} onChange={v => set({ serviceLocationId: v })} disabled={fieldsDisabled} placeholder="None" items={[{ value: '', label: 'None' }, ...places.map(p => ({ value: p.id, label: p.name }))]} />
            </FormField>
            <FormField label="Location details"><input type="text" value={values.location} maxLength={200} autoComplete="off" disabled={fieldsDisabled} onChange={e => set({ location: e.target.value })} /></FormField>
          </>
        )}
      </div>
    ))
  }

  function detailsPage() {
    const footer = fieldsDisabled ? closeFooter : (
      <>
        <Button variant="secondary" onClick={() => discardPage('details')}>Cancel</Button>
        <Button onClick={() => void savePage('details')} disabled={saving || !dirtyIn(PAGE_KEYS.details)} aria-busy={saving || undefined}><span className="whitespace-nowrap">{saving ? 'Saving…' : 'Save changes'}</span></Button>
      </>
    )
    return frame('details', undefined, footer, (
      <div className="flex flex-col gap-[var(--field-gap-y)]">
        {saveCallout}
        <FormField label="Minimum staff" hint="Leave blank to go by each person's ratio." error={minTried && minStaffInvalid(values.minStaff) ? 'Minimum staff can be 0 to 20.' : undefined}>
          <input type="number" min={0} max={20} step={1} value={values.minStaff} disabled={fieldsDisabled} onChange={e => set({ minStaff: e.target.value })} />
        </FormField>
        <FormField label="Notes"><textarea rows={4} value={values.notes} maxLength={2000} disabled={fieldsDisabled} onChange={e => set({ notes: e.target.value })} /></FormField>
      </div>
    ))
  }

  function peoplePage() {
    const step = walking && !isNew
    const footer = readOnly ? closeFooter : step ? (
      <>
        <AddButton primary disabled={!activity} onClick={() => openPage('pickPerson')}>Add participant</AddButton>
        <Button variant="ghost" onClick={() => { setWalking(false); setPage(wide ? 'staff' : null) }}>Skip for now</Button>
        <Button variant="secondary" onClick={() => setPage('staff')}>Next: Staff</Button>
      </>
    ) : started ? closeFooter : <AddButton primary disabled={!activity} onClick={() => openPage('pickPerson')}>Add participant</AddButton>
    return frame('people', step ? 'Step 2 of 3. Each person is added as you pick them.' : undefined, footer, loading || !activity ? <Skeleton lines={5} /> : (
      <div className="flex flex-col gap-2">
        {writeError && writeKey === 'add' && <Callout tone="danger" title={`${refusedName} wasn't added.`}>{writeError}</Callout>}
        {markable && !online && <Callout tone="warning">You're offline. Attendance changes wait until you're back.</Callout>}
        {markable && <p className="text-xs text-muted-foreground">{"Mark anyone who didn't attend. Everyone else is marked as attended when the last staff shift is approved."}</p>}
        {activity.participants.length === 0 && <p className="text-sm text-muted-foreground">No one yet.</p>}
        {activity.participants.map(p => {
          const pending = pendingKey === `p:${p.participantId}`
          return (
            <div key={p.participantId} data-participant-row={p.participantId} className={`flex flex-col gap-1 rounded-sm border border-border p-2 ${pending ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{p.participantName}</span>
                {!readOnly && !started && (
                  <button type="button" aria-label={`Remove ${p.participantName} from ${activity.title}`} disabled={pending} onClick={() => setRemoving({ kind: 'participant', key: `p:${p.participantId}`, name: p.participantName, run: async () => { for (const shiftId of p.shiftIds) await detach.mutateAsync({ id: activity.id, shiftId }) } })} className={`inline-flex h-[var(--control-h-sm)] w-[var(--control-h-sm)] items-center justify-center rounded-[var(--radius-sm)] ${TAP_AREA}`}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
                )}
                {started && (
                  <div className="flex shrink-0 items-center gap-2">
                    {p.didNotAttend && <StatusBadge tone="neutral" label="Didn't attend" />}
                    {!p.didNotAttend && activity.status === 'Completed' && <StatusBadge tone="success" label="Attended" />}
                    {markable && (
                      <Button
                        variant={p.didNotAttend ? 'ghost' : 'secondary'} size="sm" data-attendance-action className="whitespace-nowrap pointer-coarse:min-h-[var(--tap-min)]"
                        aria-label={p.didNotAttend ? `Undo didn't attend for ${p.participantName}` : `Mark ${p.participantName} as didn't attend`}
                        disabled={pending || !online} title={online ? undefined : "You're offline."} onClick={() => markAttendance(p, p.didNotAttend)}
                      >{p.didNotAttend ? 'Undo' : "Didn't attend"}</Button>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{pending ? 'Saving…' : p.didNotAttend ? 'Shift cancelled as a no-show.' : formatShiftTimeRange(activity.startTime, activity.endTime)}</p>
              {writeError && writeKey === `p:${p.participantId}` && <p role="alert" className="text-xs text-destructive">{writeError}</p>}
              {p.timesDiffer && (
                <p className="flex items-start gap-1 text-xs text-muted-foreground"><Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span>Times differ from agreement {p.agreementStartTime && p.agreementEndTime ? `(${noBreak(formatShiftTimeRange(p.agreementStartTime, p.agreementEndTime))})` : ''}</span></p>
              )}
              {!started && <select aria-label={`Ratio for ${p.participantName}`} className={inputClass} value={p.ratio} disabled={readOnly || pending || p.ratio === 'TwoToOne'} onChange={e => { if (e.target.value !== p.ratio) void write(`p:${p.participantId}`, () => setRatio.mutateAsync({ id: activity.id, participantId: p.participantId, ratio: e.target.value as SupportRatio }), `Couldn't change the ratio for ${firstName(p.participantName)}.`) }}>{SUPPORT_RATIOS.filter(r => r !== 'TwoToOne' || p.ratio === r).map(r => <option key={r} value={r}>{RATIO_LABELS[r] ?? r}</option>)}</select>}
            </div>
          )
        })}
      </div>
    ))
  }

  function staffPage() {
    const step = walking && !isNew
    const footer = staffLocked ? closeFooter : step ? (
      <>
        <AddButton primary disabled={!activity} onClick={() => openPage('pickStaff')}>Add staff</AddButton>
        <Button variant="ghost" onClick={() => { setWalking(false); setPage(null) }}>Skip for now</Button>
        <Button variant="secondary" onClick={requestClose}>Done</Button>
      </>
    ) : <AddButton primary disabled={!activity} onClick={() => openPage('pickStaff')}>Add staff</AddButton>
    const notice = writeError && writeKey && (writeKey === 'add-staff' || writeKey.startsWith('s:')) ? writeError : lateRefusal
    return frame('staff', step ? 'Step 3 of 3. Each add runs the board\'s checks.' : undefined, footer, loading || !activity ? <Skeleton lines={5} /> : (
      <div className="flex flex-col gap-2">
        {notice && <Callout tone="danger">{notice}</Callout>}
        {!cancelled && <p className="text-xs text-muted-foreground">{activity.minStaffRequired != null ? `Needs ${activity.staffNeeded}: the minimum set for this activity.` : `Needs ${activity.staffNeeded}: from each person's ratio.`}</p>}
        {staffShort > 0 && <Callout tone="warning">{staffShort} more staff needed.</Callout>}
        {activity.staff.length === 0 && <p className="text-sm text-muted-foreground">{cancelled ? 'No staff.' : 'No staff yet. Drag someone onto the activity on the board, or add them here.'}</p>}
        {activity.staff.map(s => {
          const pending = pendingKey === `s:${s.id}`
          return (
            <div key={s.id} data-staff-row={s.id} className={`flex flex-col gap-1 rounded-sm border border-border p-2 ${pending ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{s.staffName}</span>
                {!staffLocked && (
                  <button type="button" aria-label={`Remove ${s.staffName} from ${activity.title}`} disabled={pending} onClick={() => setRemoving({ kind: 'staff', key: `s:${s.id}`, name: s.staffName, run: () => removeStaff.mutateAsync({ id: activity.id, rowId: s.id }) })} className={`inline-flex h-[var(--control-h-sm)] w-[var(--control-h-sm)] items-center justify-center rounded-[var(--radius-sm)] ${TAP_AREA}`}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{pending ? 'Saving…' : formatShiftTimeRange(s.startTime, s.endTime)}</p>
              {s.findings.map(f => <p key={f.code} className="text-xs text-[var(--color-on-warning-container)]">{f.message}</p>)}
            </div>
          )
        })}
      </div>
    ))
  }

  function pickPersonPage() {
    const pick = (label: string, run: () => Promise<unknown>) => {
      setRefusedName(firstName(label))
      setPersonSearch('')
      setPage('people')
      void write('add', run, `Couldn't add ${firstName(label)}.`)
    }
    return frame('pickPerson', undefined, undefined, (
      <div className="flex flex-col">
        <input type="search" aria-label="Find participant" placeholder="Find participant" value={personSearch} onChange={e => setPersonSearch(e.target.value)} className={`${inputClass} sticky top-0 z-[1] mb-2`} />
        {booked.length > 0 && <PickGroup label="Booked for group support today">
          {booked.filter(s => s.participantName.toLowerCase().includes(search)).map(s => (
            <PickRow key={s.id} label={s.participantName} sub={noBreak(formatShiftTimeRange(s.startTime, s.endTime))} onPick={() => { if (activity) pick(s.participantName, () => attach.mutateAsync({ id: activity.id, shiftIds: [s.id] })) }} />
          ))}
        </PickGroup>}
        <PickGroup label="Everyone else">
          {others.map(p => <PickRow key={p.id} label={p.fullName} onPick={() => { if (activity) pick(p.fullName, () => addPerson.mutateAsync({ id: activity.id, participantId: p.id, ratio: 'OneToOne' })) }} />)}
        </PickGroup>
      </div>
    ))
  }

  function pickStaffPage() {
    return frame('pickStaff', undefined, undefined, staffPickerTarget && (
      <StaffPickerPage
        {...pickerData}
        staff={pickerData.staff.filter(s => !staffHere.has(s.id))}
        target={staffPickerTarget}
        inputRef={staffSearchRef}
        onPick={row => {
          setPage('staff')
          if (activity) void write('add-staff', async () => { const refusal = await onAddStaff(activity.id, row.person.id); if (refusal) throw new Error(refusal) }, `Couldn't add ${firstName(row.person.fullName)}.`)
        }}
      />
    ))
  }

  const pages: Record<PageId, () => ReactNode> = { when: whenPage, people: peoplePage, staff: staffPage, details: detailsPage, pickPerson: pickPersonPage, pickStaff: pickStaffPage }
  const pageView = shown ? pages[shown]() : null

  if (!open) return null

  return (
    <>
      <div className="modal-scrim fixed inset-0 z-50 flex justify-center bg-black/50 pb-[var(--mobile-nav-h)] sm:items-center sm:p-4 lg:pb-0" onClick={requestClose}>
        <div
          ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={e => e.stopPropagation()}
          className="flex h-full w-full overflow-hidden border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-float)] sm:h-[min(44rem,100%)] sm:max-w-lg sm:rounded-[var(--radius-lg)] sm:border lg:max-w-5xl"
        >
          {loadFailed ? (
            <PageFrame title="Group activity" headingId={`${headingId}-failed`} headingRef={headingRef} onClose={requestClose} footer={closeFooter}>
              <Callout tone="danger" actions={<Button variant="secondary" onClick={() => void query.refetch()}>Try again</Button>}>Couldn't load this activity.</Callout>
            </PageFrame>
          ) : (
            <>
              {(wide || !shown) && overview}
              {shown && pageView}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title={`Cancel ${activity?.title ?? 'activity'}?`}
        message="It stays on the board, marked Cancelled. No one can be added after this."
        confirmLabel="Cancel activity"
        cancelLabel="Keep activity"
        variant="danger"
        loading={cancel.isPending}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => { if (activity) void write('cancel', () => cancel.mutateAsync(activity.id), "Couldn't cancel the activity.").then(() => setConfirmCancel(false)) }}
      />

      {removing && activity && (() => {
        const copy = removeFromActivityCopy(removing.kind, firstName(removing.name), activity.title)
        return (
          <ConfirmDialog
            open
            title={copy.title}
            message={copy.message}
            confirmLabel="Remove"
            cancelLabel="Keep"
            variant="danger"
            onCancel={() => setRemoving(null)}
            onConfirm={() => { const r = removing; setRemoving(null); void write(r.key, r.run, `Couldn't remove ${firstName(r.name)}.`) }}
          />
        )
      })()}

      <DiscardChangesDialog open={confirmDiscard} onKeep={() => setConfirmDiscard(false)} onDiscard={() => { setConfirmDiscard(false); onClose() }} />
    </>
  )
}
