import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useComplaint, useCreateComplaint, useUpdateComplaint, useIncidents, useStaff } from '@/api/hooks'
import type { ComplaintDto, IncidentListDto, SaveComplaintDto } from '@/api/types'
import {
  COMPLAINANT_KIND_LABELS, COMPLAINANT_KINDS, COMPLAINT_CHANNEL_LABELS, COMPLAINT_CHANNELS, COMPLAINT_STATUS_LABELS, COMPLAINT_STATUSES,
  type ComplainantKind, type ComplaintChannel, type ComplaintStatus,
} from '@/api/types/enums'
import { LONG_OPEN_DAYS } from '@/api/types'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { BackButton, BackActionButton } from '@/components/BackButton'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { CheckboxField } from '@/components/CheckboxField'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { ParticipantPicker } from '@/components/ParticipantPicker'
import { SearchableSelect } from '@/components/SearchableSelect'
import { SelectField } from '@/components/SelectField'
import { StatusBadge } from '@/components/StatusBadge'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { formGrid, span } from '@/lib/formGrid'
import { localIsoDate } from '@/lib/dateOnly'
import { isNotFoundError } from '@/lib/httpStatus'
import { plural } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { retryingAfterError } from '@/lib/queryPhase'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { extractErrorMessage, formatDateAu } from '@/lib/utils'

const TEXT_MAX = 4000
const NAME_MAX = 200

/** The form's own shape: every field a string (or a flag) so a controlled input never flips between controlled and uncontrolled. */
type FormValues = {
  receivedOn: string
  channel: ComplaintChannel | ''
  summary: string
  incidentReportId: string
  complainantKind: ComplainantKind | ''
  participantId: string
  complainantName: string
  status: ComplaintStatus
  handledByUserId: string
  acknowledgedOn: string
  actionsTaken: string
  outcome: string
  outcomeCommunicatedOn: string
  closedOn: string
  toldAboutCommission: boolean
  toldAboutCommissionOn: string
}

type FieldErrors = Partial<Record<keyof FormValues, string>>

const CHANNEL_OPTIONS = COMPLAINT_CHANNELS.map(c => ({ value: c, label: COMPLAINT_CHANNEL_LABELS[c] }))
const KIND_OPTIONS = COMPLAINANT_KINDS.map(k => ({ value: k, label: COMPLAINANT_KIND_LABELS[k] }))
const STATUS_OPTIONS = COMPLAINT_STATUSES.map(s => ({ value: s, label: COMPLAINT_STATUS_LABELS[s] }))
const FUTURE = "The date can't be in the future."
const BEFORE_RECEIVED = "This date can't be before the complaint was received."

function blankValues(handledByUserId: string): FormValues {
  return {
    receivedOn: localIsoDate(), channel: '', summary: '', incidentReportId: '', complainantKind: '', participantId: '', complainantName: '',
    status: 'Open', handledByUserId, acknowledgedOn: '', actionsTaken: '', outcome: '', outcomeCommunicatedOn: '', closedOn: '',
    toldAboutCommission: false, toldAboutCommissionOn: '',
  }
}

function valuesFrom(c: ComplaintDto): FormValues {
  return {
    receivedOn: c.receivedOn, channel: c.channel, summary: c.summary, incidentReportId: c.incidentReportId ?? '',
    complainantKind: c.complainantKind, participantId: c.participantId ?? '', complainantName: c.complainantName ?? '',
    status: c.status, handledByUserId: c.handledByUserId ?? '', acknowledgedOn: c.acknowledgedOn ?? '', actionsTaken: c.actionsTaken ?? '',
    outcome: c.outcome ?? '', outcomeCommunicatedOn: c.outcomeCommunicatedOn ?? '', closedOn: c.closedOn ?? '',
    toldAboutCommission: c.toldAboutCommission, toldAboutCommissionOn: c.toldAboutCommissionOn ?? '',
  }
}

/** The same rules the server applies (ComplaintsController.ValidateAsync); the server stays the authority. */
function validate(v: FormValues, isEdit: boolean, today: string): FieldErrors {
  const errors: FieldErrors = {}
  if (!v.receivedOn) errors.receivedOn = 'Enter the date it was received.'
  else if (v.receivedOn > today) errors.receivedOn = FUTURE
  if (!v.channel) errors.channel = 'Choose how it came in.'
  if (!v.summary.trim()) errors.summary = 'Describe the complaint.'
  else if (v.summary.trim().length > TEXT_MAX) errors.summary = 'Keep it to 4,000 characters.'
  if (!v.complainantKind) errors.complainantKind = 'Choose who made the complaint.'
  else if (v.complainantKind === 'Participant' && !v.participantId) errors.participantId = 'Choose the participant.'
  if (v.complainantName.trim().length > NAME_MAX) errors.complainantName = 'Keep the name to 200 characters.'
  if (v.actionsTaken.trim().length > TEXT_MAX) errors.actionsTaken = 'Keep it to 4,000 characters.'
  if (v.outcome.trim().length > TEXT_MAX) errors.outcome = 'Keep it to 4,000 characters.'

  const later = (key: 'acknowledgedOn' | 'outcomeCommunicatedOn' | 'closedOn' | 'toldAboutCommissionOn') => {
    const d = v[key]
    if (!d) return
    if (d > today) errors[key] = FUTURE
    else if (v.receivedOn && d < v.receivedOn) errors[key] = BEFORE_RECEIVED
  }
  later('acknowledgedOn')
  if (isEdit) {
    later('outcomeCommunicatedOn')
    if (v.status === 'Closed') {
      if (!v.closedOn) errors.closedOn = 'Enter the day it was closed.'
      else later('closedOn')
    }
  }
  if (v.toldAboutCommission) {
    if (!v.toldAboutCommissionOn) errors.toldAboutCommissionOn = 'Enter the day you told them.'
    else later('toldAboutCommissionOn')
  }
  return errors
}

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null)

function toDto(v: FormValues, isEdit: boolean, expectedUpdatedAt?: string): SaveComplaintDto {
  const anonymous = v.complainantKind === 'Anonymous'
  const participant = v.complainantKind === 'Participant'
  const closed = isEdit && v.status === 'Closed'
  return {
    receivedOn: v.receivedOn,
    channel: v.channel as ComplaintChannel,
    complainantKind: v.complainantKind as ComplainantKind,
    participantId: anonymous ? null : v.participantId || null,
    // The participant is the complainant: their record names them, so no typed name is kept beside it.
    complainantName: anonymous || participant ? null : orNull(v.complainantName),
    summary: v.summary.trim(),
    status: isEdit ? v.status : 'Open',
    acknowledgedOn: v.acknowledgedOn || null,
    actionsTaken: isEdit ? orNull(v.actionsTaken) : null,
    outcome: isEdit ? orNull(v.outcome) : null,
    outcomeCommunicatedOn: isEdit ? v.outcomeCommunicatedOn || null : null,
    toldAboutCommission: v.toldAboutCommission,
    toldAboutCommissionOn: v.toldAboutCommission ? v.toldAboutCommissionOn || null : null,
    closedOn: closed ? v.closedOn || null : null,
    handledByUserId: v.handledByUserId || null,
    incidentReportId: v.incidentReportId || null,
    ...(isEdit ? { expectedUpdatedAt: expectedUpdatedAt ?? null } : {}),
  }
}

function StatusLine({ complaint }: { complaint: ComplaintDto }) {
  const open = complaint.openDays != null
  const facts = [
    `Received ${formatDateAu(complaint.receivedOn)}`,
    open ? `Open ${complaint.openDays === 0 ? 'since today' : plural(complaint.openDays!, 'day')}` : null,
    complaint.acknowledgedOn ? `Acknowledged ${formatDateAu(complaint.acknowledgedOn)}` : 'Not acknowledged yet',
    complaint.status === 'Closed' && complaint.closedOn ? `Closed ${formatDateAu(complaint.closedOn)}` : null,
  ].filter((f): f is string => f !== null)
  const long = open && complaint.openDays! > LONG_OPEN_DAYS
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--color-muted-foreground)]">
      <StatusBadge status={complaint.status} label={COMPLAINT_STATUS_LABELS[complaint.status]} />
      <span className={long ? 'font-medium' : undefined}>{facts.join(' · ')}</span>
    </p>
  )
}

function ComplaintForm({ complaint }: { complaint?: ComplaintDto }) {
  const navigate = useNavigate()
  const isEdit = !!complaint
  const { id: currentUserId } = usePermissions()
  const create = useCreateComplaint()
  const update = useUpdateComplaint()
  const mutation = isEdit ? update : create
  const { data: staff = [] } = useStaff({ isActive: 'true' })
  const { data: incidents = [], isLoading: incidentsLoading } = useIncidents({ pageSize: '200' })

  const initial = useMemo(() => (complaint ? valuesFrom(complaint) : blankValues('')), [complaint])
  const [values, setValues] = useState<FormValues>(initial)
  const [saved, setSaved] = useState<FormValues>(initial)
  // The version this form was loaded or last saved at: a refetch never swaps it, so a real conflict still gets the 409.
  const [version, setVersion] = useState(complaint?.updatedAt)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [createdId, setCreatedId] = useState<string | null>(null)
  const isDirty = JSON.stringify(values) !== JSON.stringify(saved)
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  const formRef = useRef<HTMLFormElement>(null)
  const refusalRef = useRef<HTMLDivElement>(null)
  const focusFirstInvalid = useRef(false)
  const focusRefusal = useRef(false)
  useEffect(() => {
    if (focusFirstInvalid.current) {
      focusFirstInvalid.current = false
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    }
  }, [errors])
  useEffect(() => {
    if (focusRefusal.current && refusal) {
      focusRefusal.current = false
      refusalRef.current?.focus()
    }
  }, [refusal])

  // Navigate once the saved snapshot has rendered: the unsaved-changes blocker still sees a dirty form in the same tick as the save.
  useEffect(() => {
    if (createdId) navigate(`/complaints/${createdId}`, { replace: true })
  }, [createdId, navigate])

  const handlerTouched = useRef(false)
  // A new complaint is handled by the signed-in user, but only once they show in the active staff list (a SuperAdmin or a leaver would not).
  useEffect(() => {
    if (isEdit || handlerTouched.current || !currentUserId || !staff.some(s => s.id === currentUserId)) return
    handlerTouched.current = true
    setValues(v => ({ ...v, handledByUserId: currentUserId }))
    setSaved(v => ({ ...v, handledByUserId: currentUserId }))
  }, [isEdit, currentUserId, staff])

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    if (key === 'handledByUserId') handlerTouched.current = true
    setValues(v => ({ ...v, [key]: value }))
    setErrors(e => (e[key] ? { ...e, [key]: undefined } : e))
  }
  const today = localIsoDate()
  const archived = !!complaint && !complaint.isActive
  const kind = values.complainantKind
  const anonymous = kind === 'Anonymous'
  const participantIsComplainant = kind === 'Participant'

  const changeKind = (next: ComplainantKind | '') => {
    setValues(v => ({
      ...v,
      complainantKind: next,
      // Anonymous keeps no name and no participant; a Participant complainant is named by the picker.
      participantId: next === 'Anonymous' ? '' : v.participantId,
      complainantName: next === 'Anonymous' || next === 'Participant' ? '' : v.complainantName,
    }))
    setErrors(e => ({ ...e, complainantKind: undefined, participantId: undefined, complainantName: undefined }))
  }
  const changeStatus = (next: ComplaintStatus) => {
    setValues(v => ({ ...v, status: next, closedOn: next === 'Closed' ? v.closedOn || today : '' }))
    setErrors(e => ({ ...e, closedOn: undefined }))
  }
  const changeCommission = (ticked: boolean) => {
    setValues(v => ({ ...v, toldAboutCommission: ticked, toldAboutCommissionOn: ticked ? v.toldAboutCommissionOn || today : '' }))
    setErrors(e => ({ ...e, toldAboutCommissionOn: undefined }))
  }

  const staffItems = useMemo(() => {
    const items = staff.map(s => ({ value: s.id, label: s.fullName }))
    // The saved handler always stays an option once they have left, so a switch away can be undone in the same edit. A pick of an inactive person is still covered too.
    const saved = complaint?.handledByUserId
    for (const id of new Set([saved, values.handledByUserId])) {
      if (!id || items.some(i => i.value === id)) continue
      items.unshift({ value: id, label: `${id === saved && complaint?.handledByName ? complaint.handledByName : 'Former staff member'} (inactive)` })
    }
    return [{ value: '', label: 'Nobody yet' }, ...items]
  }, [staff, values.handledByUserId, complaint])
  // The incident list is filtered here, not on the server (IncidentsController is not touched): with a participant chosen, only their incidents.
  // shortcut: the 200 newest incidents only, upgrade to a server-side participant filter when a tenant passes that.
  const incidentItems = useMemo(() => {
    const rows = (incidents as IncidentListDto[]).filter(i => !values.participantId || i.involvedParticipantId === values.participantId)
    const items = rows.map(i => ({ value: i.id, label: `${i.title} · ${formatDateAu(i.incidentDateTime.slice(0, 10))}` }))
    // A link already saved stays visible even if it is outside the loaded rows or the participant filter.
    if (values.incidentReportId && !items.some(i => i.value === values.incidentReportId)) {
      items.unshift({ value: values.incidentReportId, label: complaint?.incidentReportId === values.incidentReportId && complaint.incidentReportTitle ? complaint.incidentReportTitle : 'Linked incident' })
    }
    return [{ value: '', label: 'No linked incident' }, ...items]
  }, [incidents, values.participantId, values.incidentReportId, complaint])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setRefusal(null)
    const found = validate(values, isEdit, today)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      focusFirstInvalid.current = true
      return
    }
    const dto = toDto(values, isEdit, version)
    try {
      const res = isEdit
        ? await update.mutateAsync({ id: complaint!.id, data: dto })
        : await create.mutateAsync(dto)
      if (!res.success || !res.data) throw res
      setSaved(values)
      setVersion(res.data.updatedAt)
      setAnnouncement('Complaint saved.')
      if (!isEdit) setCreatedId(res.data.id)
    } catch (err) {
      const fallback = "Couldn't save the complaint. Check the details and try again."
      setRefusal(extractErrorMessage(err, apiErrorStatus(err) === 403 ? "You can't change complaints. They're for Admins and Coordinators." : fallback))
      focusRefusal.current = true
    }
  }

  const backTo = '/complaints'

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
      <AnnouncementRegion message={announcement} />
      {unsavedChangesDialog}
      <div className="flex items-start gap-2">
        <BackButton to={backTo} label="complaints" variant="icon" />
        <div className="flex-1 min-w-0"><PageHeader title={isEdit ? 'Complaint' : 'Record a complaint'} /></div>
      </div>
      {complaint && <StatusLine complaint={complaint} />}

      {archived && (
        <Callout tone="info">This complaint is archived. Restore it from the Archived list to change it.</Callout>
      )}
      {refusal && (
        <div ref={refusalRef} tabIndex={-1} className="outline-none">
          <Callout tone="danger" announce={false}>{refusal}</Callout>
        </div>
      )}

      <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-[var(--section-gap)]">
        <fieldset disabled={archived} className="contents">
          <Card title="The complaint">
            <div className={formGrid}>
              <TextField
                label="Received on" type="date" required className={span.date} max={today}
                value={values.receivedOn} onChange={e => set('receivedOn', e.target.value)} error={errors.receivedOn}
              />
              <SelectField
                label="How it came in" required className={span.short} placeholder="Choose…"
                options={CHANNEL_OPTIONS} value={values.channel} onChange={e => set('channel', e.target.value as ComplaintChannel)} error={errors.channel}
              />
              <TextAreaField
                label="What it's about" required className={span.long} rows={5}
                hint="What the person is unhappy about, in their words where you can. Up to 4,000 characters."
                value={values.summary} onChange={e => set('summary', e.target.value)} error={errors.summary}
              />
              <FormField
                label={(
                  <>
                    Linked incident (optional)
                    {values.incidentReportId && (
                      <>
                        {' '}
                        <Link to={`/incidents/${values.incidentReportId}`} className="ml-2 font-normal text-[var(--color-primary)] hover:underline">View incident</Link>
                      </>
                    )}
                  </>
                )}
                hint="If this complaint is about something already reported as an incident."
                className={span.medium}
              >
                <SearchableSelect
                  items={incidentItems} value={values.incidentReportId} onChange={v => set('incidentReportId', v)}
                  loading={incidentsLoading} placeholder="Search incidents…" emptyMessage="No incidents to link"
                />
              </FormField>
            </div>
          </Card>

          <Card title="Who made it">
            <div className={formGrid}>
              <SelectField
                label="Who made the complaint" required className={span.medium} placeholder="Choose…"
                options={KIND_OPTIONS} value={values.complainantKind} onChange={e => changeKind(e.target.value as ComplainantKind | '')}
                error={errors.complainantKind} hint={anonymous ? 'Anonymous complaints keep no name and no participant.' : undefined}
              />
              {!anonymous && kind !== '' && (
                <FormField
                  label={participantIsComplainant ? 'Participant' : "Participant it's about (optional)"}
                  required={participantIsComplainant} error={errors.participantId} className={span.medium}
                >
                  <ParticipantPicker
                    value={values.participantId} onChange={v => set('participantId', v)}
                    allowNone={!participantIsComplainant} noneLabel="No participant"
                  />
                </FormField>
              )}
              {!anonymous && !participantIsComplainant && kind !== '' && (
                <TextField
                  label="Their name (optional)" className={span.medium} maxLength={NAME_MAX + 50}
                  value={values.complainantName} onChange={e => set('complainantName', e.target.value)} error={errors.complainantName}
                />
              )}
              <p className={`${span.long} text-[13px] text-[var(--color-muted-foreground)]`}>
                Don't add phone numbers, emails or addresses here. They belong in the participant's or person's own record.
              </p>
            </div>
          </Card>

          <Card title="Handling">
            <div className={formGrid}>
              {isEdit && (
                <SelectField
                  label="Status" className={span.short} options={STATUS_OPTIONS}
                  value={values.status} onChange={e => changeStatus(e.target.value as ComplaintStatus)}
                />
              )}
              <FormField label="Handled by" className={span.medium}>
                <SearchableSelect items={staffItems} value={values.handledByUserId} onChange={v => set('handledByUserId', v)} placeholder="Search staff…" />
              </FormField>
              <TextField
                label="Acknowledged on" type="date" className={span.date} min={values.receivedOn || undefined} max={today}
                hint="The day you let the person know you'd received it."
                value={values.acknowledgedOn} onChange={e => set('acknowledgedOn', e.target.value)} error={errors.acknowledgedOn}
              />
              {isEdit && (
                <>
                  <TextAreaField
                    label="Actions taken" className={span.long} rows={4}
                    value={values.actionsTaken} onChange={e => set('actionsTaken', e.target.value)} error={errors.actionsTaken}
                  />
                  <TextAreaField
                    label="Outcome" className={span.long} rows={4}
                    value={values.outcome} onChange={e => set('outcome', e.target.value)} error={errors.outcome}
                  />
                  <TextField
                    label="Outcome told to the person on" type="date" className={span.date} min={values.receivedOn || undefined} max={today}
                    value={values.outcomeCommunicatedOn} onChange={e => set('outcomeCommunicatedOn', e.target.value)} error={errors.outcomeCommunicatedOn}
                  />
                  {values.status === 'Closed' && (
                    <TextField
                      label="Closed on" type="date" required className={span.date} min={values.receivedOn || undefined} max={today}
                      value={values.closedOn} onChange={e => set('closedOn', e.target.value)} error={errors.closedOn}
                    />
                  )}
                </>
              )}
            </div>
          </Card>

          <Card title="NDIS Commission">
            <div className={formGrid}>
              <CheckboxField
                label="We told the person they can complain to the NDIS Commission" className={span.long}
                hint="Everyone who complains must know they can also go to the NDIS Commission. This records that you told them; Bunya Support doesn't contact the NDIS Commission."
                checked={values.toldAboutCommission} onChange={e => changeCommission(e.target.checked)}
              />
              {values.toldAboutCommission && (
                <TextField
                  label="Told on" type="date" required className={span.date} min={values.receivedOn || undefined} max={today}
                  value={values.toldAboutCommissionOn} onChange={e => set('toldAboutCommissionOn', e.target.value)} error={errors.toldAboutCommissionOn}
                />
              )}
            </div>
          </Card>
        </fieldset>

        <div className="flex justify-end gap-3">
          <BackActionButton to={backTo} />
          {!archived && (
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Save complaint'}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}

export default function ComplaintFormPage() {
  const { id } = useParams()
  const pageQuery = useComplaint(id)
  const { data: complaint, isError, error, refetch } = pageQuery

  if (id && !complaint) {
    if (apiErrorStatus(error) === 403) return <Callout tone="danger">You can't see complaints. They're for Admins and Coordinators.</Callout>
    if (!isError && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="complaint" />
    return isNotFoundError(error)
      ? <PageState kind="not-found" noun="complaint" backTo="/complaints" backLabel="complaints" />
      : <PageState kind="error" noun="complaint" onRetry={() => refetch()} />
  }
  // Keyed on the id only: a refetch (window focus, a save elsewhere) must not remount the form and drop what is being typed.
  return <ComplaintForm key={complaint?.id ?? 'new'} complaint={complaint} />
}
