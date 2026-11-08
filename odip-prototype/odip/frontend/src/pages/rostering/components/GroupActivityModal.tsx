import { useMemo, useRef, useState } from 'react'
import { Clock, Plus, X } from 'lucide-react'
import type { GroupActivityDto, GroupActivityFormDto, ShiftDto, ShiftStatus, SupportRatio } from '@/api/types'
import { SUPPORT_RATIOS } from '@/api/types'
import {
  useActivities, useAddGroupParticipant, useAttachShifts, useCancelGroupActivity, useCreateActivityFromShift, useCreateGroupActivity, useDetachShift, useGroupActivity, useRemoveGroupStaff,
  useServiceLocations, useSetGroupRatio, useUpdateGroupActivity,
} from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Dropdown } from '@/components/Dropdown'
import { FormField, inputClass } from '@/components/FormField'
import { Modal } from '@/components/Modal'
import { SearchableSelect } from '@/components/SearchableSelect'
import { TAP_AREA } from '@/components/tapArea'
import { extractErrorMessage } from '@/lib/utils'
import { NO_LENGTH_MESSAGE, hasNoLength } from '../lib/shiftTimes'
import { RATIO_LABELS, formatShiftTimeRange } from '../lib/roster'
import { firstName } from '../lib/rosterDrag'
import { removeFromActivityCopy } from '../lib/groupActivities'
import { StaffPicker, type StaffPickerProps } from './StaffPicker'

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

type Form = { title: string; activityId: string; serviceDate: string; startTime: string; endTime: string; endsNextDay: boolean; serviceLocationId: string; location: string; minStaff: string; status: ShiftStatus; notes: string }

const hhmm = (t: string) => t.slice(0, 5)
const noBreak = (range: string) => range.replace(/–/g, '–⁠')

function formOf(a: GroupActivityDto | null, target: ActivityModalTarget | null): Form {
  if (a) return { title: a.title, activityId: a.activityId ?? '', serviceDate: a.serviceDate, startTime: hhmm(a.startTime), endTime: hhmm(a.endTime), endsNextDay: a.endsNextDay, serviceLocationId: a.serviceLocationId ?? '', location: a.location ?? '', minStaff: a.minStaffRequired == null ? '' : String(a.minStaffRequired), status: a.status, notes: a.notes ?? '' }
  const shift = target?.mode === 'new' ? target.fromShift : undefined
  return { title: '', activityId: '', serviceDate: shift?.serviceDate ?? (target?.mode === 'new' ? target.serviceDate : ''), startTime: shift ? hhmm(shift.startTime) : '10:00', endTime: shift ? hhmm(shift.endTime) : '14:00', endsNextDay: shift?.endsNextDay ?? false, serviceLocationId: '', location: '', minStaff: '', status: 'Draft', notes: '' }
}

/** Both-or-neither is the server's rule (GA_TIMES); the form always holds both, so only an end that is not after the start needs a word here. */
function toDto(f: Form): GroupActivityFormDto {
  return {
    serviceDate: f.serviceDate, startTime: f.startTime, endTime: f.endTime, endsNextDay: f.endsNextDay, title: f.title.trim(), activityId: f.activityId || null,
    location: f.location.trim() || null, serviceLocationId: f.serviceLocationId || null, notes: f.notes.trim() || null, minStaffRequired: f.minStaff.trim() === '' ? null : Number(f.minStaff),
  }
}

/** The group-activity modal (SHAPE section 5): the activity form behind Save, with the participants and the staff beside it as immediate writes. The parent keys it by target. */
export function GroupActivityModal({ target, canWrite, participants, pickerData, boardShifts, onAddStaff, lateRefusal, onLateRefusalClear, onClose }: GroupActivityModalProps) {
  const [savedId, setSavedId] = useState<string | null>(null)
  const id = target?.mode === 'edit' ? target.id : savedId
  const query = useGroupActivity(id)
  const activity = query.data ?? null
  const isNew = id === null
  const fromShift = target?.mode === 'new' ? target.fromShift : undefined
  const [form, setForm] = useState<Form | null>(null)
  const initial = useMemo(() => formOf(activity, target), [activity, target])
  const values = form ?? initial
  const set = (patch: Partial<Form>) => setForm({ ...values, ...patch })
  const dirty = form !== null && JSON.stringify(form) !== JSON.stringify(initial)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [titleError, setTitleError] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [removing, setRemoving] = useState<{ kind: 'participant' | 'staff'; key: string; name: string; run: () => Promise<unknown> } | null>(null)
  const [pickingStaff, setPickingStaff] = useState(false)
  const [pickingPerson, setPickingPerson] = useState(false)
  const [personSearch, setPersonSearch] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

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
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const saving = create.isPending || createFromShift.isPending || update.isPending

  const cancelled = activity?.status === 'Cancelled'
  const readOnly = !canWrite || cancelled
  const title = isNew ? 'New group activity' : activity?.title || 'Group activity'
  const noLength = hasNoLength(values.startTime, values.endTime, values.endsNextDay)

  /** An immediate write: on a refusal the server's message shows and nothing else changes (the refetch redraws the truth). */
  async function write(key: string, run: () => Promise<unknown>, fallback: string) {
    setWriteError(null)
    onLateRefusalClear?.()
    setPendingKey(key)
    try { await run() } catch (err) { setWriteError(extractErrorMessage(err, fallback)) } finally { setPendingKey(null) }
  }

  async function save() {
    if (!values.title.trim()) { setTitleError(true); titleRef.current?.focus(); return }
    if (noLength) return
    setSaveError(null)
    try {
      if (isNew) {
        const made = fromShift ? await createFromShift.mutateAsync({ shiftId: fromShift.id, title: values.title.trim() }) : await create.mutateAsync(toDto(values))
        setSavedId(made.id)
        setForm(null)
      } else if (activity) {
        await update.mutateAsync({ id: activity.id, data: toDto(values), status: values.status })
        setForm(null)
      }
    } catch (err) {
      setSaveError(`Couldn't save. Your changes are still here. ${extractErrorMessage(err, '')}`.trim())
    }
  }

  const staffPickerTarget: ShiftDto | null = activity && pickingStaff
    ? { id: activity.id, participantId: '', participantName: activity.title, serviceDate: activity.serviceDate, startTime: activity.startTime, endTime: activity.endTime, endsNextDay: activity.endsNextDay, durationHours: 0, ratio: 'OneToOne', nightType: 'None', status: activity.status, shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false }
    : null
  const staffHere = new Set(activity?.staff.map(s => s.staffId))
  const peopleHere = new Set(activity?.participants.map(p => p.participantId))
  const booked = activity ? boardShifts.filter(s => s.isGroupLine && !s.groupActivityId && s.serviceDate === activity.serviceDate && !peopleHere.has(s.participantId) && s.status !== 'Cancelled') : []
  const search = personSearch.trim().toLowerCase()
  const others = participants.filter(p => !peopleHere.has(p.id) && !booked.some(s => s.participantId === p.id) && p.fullName.toLowerCase().includes(search))

  const staffFooter = readOnly ? null : (
    <>
      {!isNew && <Button variant="ghost-danger" onClick={() => setConfirmCancel(true)}>Cancel activity</Button>}
    </>
  )
  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div>{staffFooter}</div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {readOnly || (!isNew && !dirty) ? (
          <Button variant="secondary" onClick={onClose}><span className="whitespace-nowrap">Close</span></Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}><span className="whitespace-nowrap">Cancel</span></Button>
            <Button onClick={save} disabled={saving || (!isNew && !dirty)}><span className="whitespace-nowrap">{isNew ? (saving ? 'Creating…' : 'Create activity') : saving ? 'Saving…' : 'Save changes'}</span></Button>
          </>
        )}
      </div>
    </div>
  )

  const loading = !isNew && query.isLoading
  const loadFailed = !isNew && query.isError && !activity

  return (
    <Modal open={target !== null} onClose={onClose} title={title} size="xl" stickyFooter dirty={dirty} initialFocusRef={titleRef} footer={loadFailed || loading ? <Button variant="secondary" onClick={onClose}>Close</Button> : footer}>
      {cancelled && <p className="mb-3 text-sm text-muted-foreground">Cancelled</p>}
      {loadFailed ? (
        <Callout tone="danger" actions={<Button variant="secondary" onClick={() => void query.refetch()}>Try again</Button>}>Couldn't load this activity.</Callout>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <section aria-label="Activity" className="min-w-0">
            <h4 className="mb-2 text-sm font-semibold">Activity</h4>
            {loading ? <Skeleton /> : (
              <div className="flex flex-col gap-[var(--field-gap-y)]">
                <FormField label="Title" required error={titleError && !values.title.trim() ? 'Add a title.' : undefined}>
                  <input ref={titleRef} type="text" value={values.title} maxLength={200} disabled={readOnly} autoComplete="off" onChange={e => { setTitleError(false); set({ title: e.target.value }) }} />
                </FormField>
                <FormField label="Activity (optional)">
                  <SearchableSelect
                    value={values.activityId}
                    onChange={v => { const picked = catalogue.find(a => a.id === v); set({ activityId: v, ...(picked && !values.title.trim() ? { title: picked.activityName } : {}) }) }}
                    disabled={readOnly}
                    placeholder="None"
                    items={[{ value: '', label: 'None' }, ...catalogue.map(a => ({ value: a.id, label: a.activityName }))]}
                  />
                </FormField>
                <FormField label="Date" required hint={fromShift ? 'The date and times come from the shift.' : undefined}>
                  <input type="date" value={values.serviceDate} disabled={readOnly || Boolean(fromShift)} onChange={e => set({ serviceDate: e.target.value })} />
                </FormField>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Start" required><input type="time" className="px-1" value={values.startTime} disabled={readOnly || Boolean(fromShift)} onChange={e => set({ startTime: e.target.value })} /></FormField>
                  <FormField label="End" required error={noLength ? NO_LENGTH_MESSAGE : undefined}><input type="time" className="px-1" value={values.endTime} disabled={readOnly || Boolean(fromShift)} onChange={e => set({ endTime: e.target.value })} /></FormField>
                </div>
                <FormField label="Ends the next day" layout="checkbox"><input type="checkbox" checked={values.endsNextDay} disabled={readOnly || Boolean(fromShift)} onChange={e => set({ endsNextDay: e.target.checked })} /></FormField>
                <FormField label="Service location">
                  <SearchableSelect value={values.serviceLocationId} onChange={v => set({ serviceLocationId: v })} disabled={readOnly} placeholder="None" items={[{ value: '', label: 'None' }, ...places.map(p => ({ value: p.id, label: p.name }))]} />
                </FormField>
                <FormField label="Location details"><input type="text" value={values.location} maxLength={200} autoComplete="off" disabled={readOnly} onChange={e => set({ location: e.target.value })} /></FormField>
                <FormField label="Minimum staff" hint="Leave blank to go by each person's ratio.">
                  <input type="number" min={1} step={1} value={values.minStaff} disabled={readOnly} onChange={e => set({ minStaff: e.target.value })} />
                </FormField>
                {!isNew && (
                  <FormField label="Status">
                    <Dropdown variant="form" value={values.status === 'Cancelled' ? 'Draft' : values.status} onChange={v => set({ status: v as ShiftStatus })} disabled={readOnly} items={[{ value: 'Draft', label: 'Draft' }, { value: 'Published', label: 'Published' }]} />
                  </FormField>
                )}
                <FormField label="Notes"><textarea rows={3} value={values.notes} disabled={readOnly} onChange={e => set({ notes: e.target.value })} /></FormField>
                {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
              </div>
            )}
          </section>

          <section aria-label="Participants" className="min-w-0">
            <h4 className="mb-2 text-sm font-semibold">Participants · {activity?.participants.length ?? (fromShift ? 1 : 0)}</h4>
            {loading ? <Skeleton /> : (
              <div className="flex flex-col gap-2">
                {fromShift && isNew && (
                  <div className="rounded-sm border border-border p-2 text-sm"><span className="font-medium">{fromShift.participantName}</span><p className="text-xs text-muted-foreground">Added when you create the activity.</p></div>
                )}
                {activity?.participants.length === 0 && <p className="text-sm text-muted-foreground">No one yet.</p>}
                {activity?.participants.map(p => {
                  const pending = pendingKey === `p:${p.participantId}`
                  return (
                    <div key={p.participantId} data-participant-row={p.participantId} className={`flex flex-col gap-1 rounded-sm border border-border p-2 ${pending ? 'opacity-60' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{p.participantName}</span>
                        {!readOnly && (
                          <button type="button" aria-label={`Remove ${p.participantName} from ${activity.title}`} disabled={pending} onClick={() => setRemoving({ kind: 'participant', key: `p:${p.participantId}`, name: p.participantName, run: async () => { for (const shiftId of p.shiftIds) await detach.mutateAsync({ id: activity.id, shiftId }) } })} className={`inline-flex h-[var(--control-h-sm)] w-[var(--control-h-sm)] items-center justify-center rounded-[var(--radius-sm)] ${TAP_AREA}`}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{pending ? 'Saving…' : formatShiftTimeRange(activity.startTime, activity.endTime)}</p>
                      {p.timesDiffer && (
                        <p className="flex items-start gap-1 text-xs text-muted-foreground"><Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span>Times differ from agreement {p.agreementStartTime && p.agreementEndTime ? `(${noBreak(formatShiftTimeRange(p.agreementStartTime, p.agreementEndTime))})` : ''}</span></p>
                      )}
                      <select aria-label={`Ratio for ${p.participantName}`} className={inputClass} value={p.ratio} disabled={readOnly || pending || p.ratio === 'TwoToOne'} onChange={e => void write(`p:${p.participantId}`, () => setRatio.mutateAsync({ id: activity.id, participantId: p.participantId, ratio: e.target.value as SupportRatio }), `Couldn't change the ratio for ${firstName(p.participantName)}.`)}>{SUPPORT_RATIOS.filter(r => r !== 'TwoToOne' || p.ratio === r).map(r => <option key={r} value={r}>{RATIO_LABELS[r] ?? r}</option>)}</select>
                    </div>
                  )
                })}
                {!readOnly && <AddButton disabled={isNew} onClick={() => setPickingPerson(true)}>Add participant</AddButton>}
                {isNew && !readOnly && <p className="text-xs text-muted-foreground">Create the activity, then add people.</p>}
              </div>
            )}
          </section>

          <section aria-label="Staff" className="min-w-0">
            <h4 className="mb-2 text-sm font-semibold">Staff · {cancelled || !activity?.staffNeeded ? (activity?.staffAssigned ?? 0) : `${activity.staffAssigned} of ${activity.staffNeeded}`}</h4>
            {loading ? <Skeleton /> : (
              <div className="flex flex-col gap-2">
                {activity && !cancelled && <p className="text-xs text-muted-foreground">{activity.minStaffRequired != null ? `Needs ${activity.staffNeeded}: the minimum set for this activity.` : `Needs ${activity.staffNeeded}: from each person's ratio.`}</p>}
                {activity && activity.staffNeeded > activity.staffAssigned && !cancelled && <Callout tone="warning">{activity.staffNeeded - activity.staffAssigned} more staff needed.</Callout>}
                {activity?.staff.length === 0 && <p className="text-sm text-muted-foreground">{cancelled ? 'No staff.' : 'No staff yet. Drag someone onto the activity on the board, or add them here.'}</p>}
                {activity?.staff.map(s => {
                  const pending = pendingKey === `s:${s.id}`
                  return (
                    <div key={s.id} data-staff-row={s.id} className={`flex flex-col gap-1 rounded-sm border border-border p-2 ${pending ? 'opacity-60' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{s.staffName}</span>
                        {!readOnly && (
                          <button type="button" aria-label={`Remove ${s.staffName} from ${activity.title}`} disabled={pending} onClick={() => setRemoving({ kind: 'staff', key: `s:${s.id}`, name: s.staffName, run: () => removeStaff.mutateAsync({ id: activity.id, rowId: s.id }) })} className={`inline-flex h-[var(--control-h-sm)] w-[var(--control-h-sm)] items-center justify-center rounded-[var(--radius-sm)] ${TAP_AREA}`}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{pending ? 'Saving…' : formatShiftTimeRange(s.startTime, s.endTime)}</p>
                      {s.findings.map(f => <p key={f.code} className="text-xs text-[var(--color-on-warning-container)]">{f.message}</p>)}
                    </div>
                  )
                })}
                {!readOnly && <AddButton disabled={isNew} onClick={() => setPickingStaff(true)}>Add staff</AddButton>}
                {isNew && !readOnly && <p className="text-xs text-muted-foreground">Create the activity, then add people.</p>}
              </div>
            )}
          </section>
        </div>
      )}
      {(writeError ?? lateRefusal) && <div className="mt-4"><Callout tone="danger">{writeError ?? lateRefusal}</Callout></div>}

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

      <Modal open={pickingPerson} onClose={() => setPickingPerson(false)} title="Add participant" size="sm">
        <input type="search" aria-label="Find participant" placeholder="Find participant" value={personSearch} onChange={e => setPersonSearch(e.target.value)} className="mb-2" />
        {booked.length > 0 && <PickGroup label="Booked for group support today">
          {booked.filter(s => s.participantName.toLowerCase().includes(search)).map(s => (
            <PickRow key={s.id} label={s.participantName} sub={noBreak(formatShiftTimeRange(s.startTime, s.endTime))} onPick={() => { setPickingPerson(false); if (activity) void write(`p:${s.participantId}`, () => attach.mutateAsync({ id: activity.id, shiftIds: [s.id] }), `Couldn't add ${firstName(s.participantName)}.`) }} />
          ))}
        </PickGroup>}
        <PickGroup label="Everyone else">
          {others.map(p => <PickRow key={p.id} label={p.fullName} onPick={() => { setPickingPerson(false); if (activity) void write(`p:${p.id}`, () => addPerson.mutateAsync({ id: activity.id, participantId: p.id, ratio: 'OneToOne' }), `Couldn't add ${firstName(p.fullName)}.`) }} />)}
        </PickGroup>
      </Modal>

      <StaffPicker
        key={staffPickerTarget?.id ?? 'closed'}
        {...pickerData}
        staff={pickerData.staff.filter(s => !staffHere.has(s.id))}
        target={staffPickerTarget}
        sheet
        onClose={() => setPickingStaff(false)}
        onPick={row => {
          setPickingStaff(false)
          if (activity) void write('add-staff', async () => { const refusal = await onAddStaff(activity.id, row.person.id); if (refusal) throw new Error(refusal) }, `Couldn't add ${firstName(row.person.fullName)}.`)
        }}
      />
    </Modal>
  )
}

function Skeleton() {
  return <div className="flex flex-col gap-2" aria-busy="true">{[0, 1].map(i => <div key={i} className="h-[var(--control-h)] animate-pulse rounded-sm bg-muted" />)}</div>
}

function AddButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: string }) {
  return <Button variant="secondary" onClick={onClick} disabled={disabled}><Plus className="h-3.5 w-3.5" aria-hidden="true" />{children}</Button>
}

function PickGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mb-2"><p className="mb-1 text-xs font-semibold text-muted-foreground">{label}</p><ul className="flex flex-col">{children}</ul></div>
}

function PickRow({ label, sub, onPick }: { label: string; sub?: string; onPick: () => void }) {
  return (
    <li><button type="button" onClick={onPick} className="flex min-h-[var(--control-h)] w-full flex-col justify-center rounded-sm px-2 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="text-sm font-medium">{label}</span>{sub && <span className="text-xs text-muted-foreground">{sub}</span>}</button></li>
  )
}
