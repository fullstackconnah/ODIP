import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import type { AxiosError } from 'axios'
import { useIncident, useStaff, useTrips, useUpdateIncident } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { BackButton } from '@/components/BackButton'
import { PageState } from '@/components/PageState'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusBadge } from '@/components/StatusBadge'
import { isNotFoundError } from '@/lib/httpStatus'
import { extractErrorMessage } from '@/lib/utils'
import { toDatetimeLocalValue } from '@/lib/incidentPrefill'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS, INCIDENT_STATUS_LABELS } from '@/api/types/enums'
import type { IncidentDetailDto } from '@/api/types/incidents'
import { retryingAfterError } from '@/lib/queryPhase'
import { IncidentReviewCard } from './incidents/IncidentReviewCard'
import { BasicsCards, ComplianceCard, DetailsCards, LinkedRecordsCard, PageFoot, RpCard, WitnessesCard, type CardEdit } from './incidents/IncidentViewCards'
import { incidentResolver, type IncidentFormData } from './incidents/incidentFormSchema'
import {
  GROUP_LABELS, INCIDENT_SERVICE_TYPES, STEP_FIELDS, buildEditValues, stepsFor, toUpdateBody, typeChangeNote,
  type GroupKey, type StepKey,
} from './incidents/incidentEditForm'
import { BasicsStep } from './incidents/steps/BasicsStep'
import { RestrictivePracticeStep } from './incidents/steps/RestrictivePracticeStep'
import { IncidentDetailsStep } from './incidents/steps/IncidentDetailsStep'
import { WitnessesStep } from './incidents/steps/WitnessesStep'
import { ComplianceStep } from './incidents/steps/ComplianceStep'

type Editing = GroupKey | 'review' | null

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const pageQuery = useIncident(id)
  const { data: incident, isLoading, isError, error, refetch } = pageQuery

  if (isLoading && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="incident" />
  if (!incident) {
    return (isError || retryingAfterError(pageQuery)) && !isNotFoundError(error)
      ? <PageState kind="error" noun="incident" onRetry={() => refetch()} />
      : <PageState kind="not-found" noun="incident" backTo="/incidents" backLabel="incidents" />
  }
  return <IncidentView incident={incident} fetching={pageQuery.isFetching} onStale={() => { void refetch() }} />
}

/** Mounted only while a part is open, so a page that is only being read needs no data router. */
function LeaveGuard({ when }: { when: boolean }) {
  return useUnsavedChangesWarning(when).dialog
}

/**
 * The whole incident, top to bottom. Admins and Coordinators (PUT /incidents/:id is Admin, Coordinator and SuperAdmin, the roles canWrite admits)
 * edit one part at a time: the part's cards are swapped in place for the wizard's own step components, fed by one form seeded from the incident
 * as it is now, with a Save of their own. Every save sends the full incident (toUpdateBody) with the `updatedAt` the part was opened on.
 */
function IncidentView({ incident, fetching, onStale }: { incident: IncidentDetailDto; fetching: boolean; onStale: () => void }) {
  // IC7: Admin writes the review, Coordinator reads it, nobody else gets the section (the server strips the fields too).
  const { canWrite, canReadIncidentReview, canWriteIncidentReview } = usePermissions()
  const form = useForm<IncidentFormData>({ resolver: incidentResolver, defaultValues: buildEditValues(incident) })
  const [editing, setEditing] = useState<Editing>(null)
  // The incident as the open part was seeded from: its updatedAt is the save's stale-form token, so a retry after a 409 fails again until reopened.
  const [seed, setSeed] = useState(incident)
  const [saving, setSaving] = useState(false)
  const [reviewDirty, setReviewDirty] = useState(false)
  const [switchTo, setSwitchTo] = useState<{ target: Editing; card: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const openerCard = useRef('')
  const focusBack = useRef('')

  const type = useWatch({ control: form.control, name: 'incidentType' })
  const participant = useWatch({ control: form.control, name: 'involvedParticipantId' })
  const dirty = editing === 'review' ? reviewDirty : editing !== null && form.formState.isDirty
  const busy = saving || fetching
  const steps: StepKey[] = editing && editing !== 'review' ? stepsFor(editing, seed, { incidentType: type, involvedParticipantId: participant }) : []

  const begin = (target: Editing, card: string) => {
    openerCard.current = card
    if (target && target !== 'review') {
      setSeed(incident)
      form.reset(buildEditValues(incident))
    }
    setEditing(target)
  }
  // Another part is already open: with changes it asks first, without it just swaps.
  const request = (target: Editing, card: string) => {
    if (editing && dirty) setSwitchTo({ target, card })
    else begin(target, card)
  }
  const close = (saved: boolean) => {
    if (saved && editing && editing !== 'review') {
      const label = GROUP_LABELS[editing]
      setAnnouncement(`${label.charAt(0).toUpperCase()}${label.slice(1)} saved.`)
    }
    focusBack.current = openerCard.current
    setEditing(null)
  }

  // Focus goes back to the Edit that opened the part, once it is enabled again (it stays disabled until the refetch lands).
  useEffect(() => {
    if (editing !== null || busy || !focusBack.current) return
    document.querySelector<HTMLElement>(`[data-edit-card="${focusBack.current}"]`)?.focus()
    focusBack.current = ''
  }, [editing, busy])

  const edit: CardEdit = { canEdit: canWrite, busy: busy || editing === 'review', onEdit: (group, card) => request(group, card) }
  const region = editing && editing !== 'review' && (
    <IncidentEditRegion key={editing} incident={incident} seed={seed} group={editing} steps={steps} form={form} onClose={close} onSavingChange={setSaving} onStale={onStale} />
  )
  // The steps are in page order and contiguous, so the region takes the first one's place and the rest drop out.
  const slot = (key: StepKey, view: ReactNode) => (!steps.includes(key) ? view : key === steps[0] ? region : null)

  const switchLabel = editing === 'review' ? 'the review' : editing ? GROUP_LABELS[editing] : ''

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {editing && <LeaveGuard when={dirty} />}
      <p role="status" className="sr-only">{announcement}</p>
      <ConfirmDialog
        open={switchTo !== null}
        title="Discard your changes?"
        message={`Your changes to ${switchLabel} haven't been saved.`}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => { if (switchTo) begin(switchTo.target, switchTo.card); setSwitchTo(null) }}
        onCancel={() => setSwitchTo(null)}
      />

      <div className="flex items-start gap-2">
        <BackButton to="/incidents" label="incidents" variant="icon" className="mt-1" />
        <div className="flex-1 min-w-0">
          <PageHeader
            title={incident.title}
            subtitle={
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={incident.severity} label={INCIDENT_SEVERITY_LABELS[incident.severity]} />
                <StatusBadge status={incident.status} label={INCIDENT_STATUS_LABELS[incident.status]} />
                <span>
                  {INCIDENT_TYPE_LABELS[incident.incidentType] ?? incident.incidentType}
                  {incident.involvedParticipantName ? ` · ${incident.involvedParticipantName}` : ''}
                </span>
              </div>
            }
          />
        </div>
      </div>

      {slot('details', <DetailsCards incident={incident} edit={edit} />)}
      {slot('basics', <BasicsCards incident={incident} edit={edit} />)}
      {slot('rp', incident.incidentType === 'RestrictivePracticeUse' && <RpCard incident={incident} edit={edit} />)}
      {slot('witnesses', <WitnessesCard incident={incident} edit={edit} />)}
      {slot('compliance', <ComplianceCard incident={incident} edit={edit} />)}

      {canReadIncidentReview && (
        <IncidentReviewCard
          incident={incident}
          canEdit={canWriteIncidentReview && !busy}
          editing={editing === 'review'}
          onEditingChange={(open) => (open ? request('review', 'Review') : setEditing(null))}
          onDirtyChange={setReviewDirty}
        />
      )}

      <LinkedRecordsCard incident={incident} />
      <PageFoot incident={incident} />
    </div>
  )
}

function saveErrorMessage(err: unknown, label: string): string {
  if ((err as AxiosError)?.response?.status === 403) return "You don't have permission to change this incident."
  return extractErrorMessage(err, `Couldn't save ${label}. Try again.`)
}

/** The open part: its step components, the error line and the Save row, in place of its view cards. */
function IncidentEditRegion({ incident, seed, group, steps, form, onClose, onSavingChange, onStale }: {
  incident: IncidentDetailDto
  seed: IncidentDetailDto
  group: GroupKey
  steps: StepKey[]
  form: UseFormReturn<IncidentFormData>
  onClose: (saved: boolean) => void
  onSavingChange: (saving: boolean) => void
  onStale: () => void
}) {
  const update = useUpdateIncident()
  const { data: staff = [] } = useStaff()
  const { data: trips = [] } = useTrips()
  const regionRef = useRef<HTMLFormElement>(null)
  const { control, register, setValue, getValues, formState: { errors } } = form
  const w = useWatch({ control }) as Partial<IncidentFormData>

  useEffect(() => {
    regionRef.current?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select, button')?.focus()
    regionRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  useEffect(() => { onSavingChange(update.isPending); return () => onSavingChange(false) }, [update.isPending, onSavingChange])

  const save = async () => {
    const fields = [...new Set(steps.flatMap((s) => STEP_FIELDS[s]))]
    if (!(await form.trigger(fields, { shouldFocus: true }))) return
    try {
      const res = await update.mutateAsync({ id: seed.id, data: toUpdateBody(seed, getValues(), group) })
      if (res.success) onClose(true)
    } catch (err) {
      // Someone else saved first: fetch their version so reopening shows it. The form keeps what was typed.
      if ((err as AxiosError)?.response?.status === 409) onStale()
    }
  }

  return (
    <form
      ref={regionRef}
      data-editing
      data-group={group}
      noValidate
      onSubmit={(e) => { e.preventDefault(); void save() }}
      className="flex flex-col gap-[var(--section-gap)]"
    >
      {steps.map((s) => {
        switch (s) {
          case 'details':
            return (
              <IncidentDetailsStep
                key={s} register={register} control={control} setValue={setValue} errors={errors}
                incidentType={w.incidentType} wereEmergencyServicesCalled={w.wereEmergencyServicesCalled} emergencyServices={w.emergencyServices}
              />
            )
          case 'basics':
            return (
              <BasicsStep
                key={s} register={register} errors={errors} setValue={setValue}
                serviceType={w.serviceType} incidentType={w.incidentType} severity={w.severity} tripInstanceId={w.tripInstanceId}
                involvedParticipantId={w.involvedParticipantId} reportedByStaffId={w.reportedByStaffId} involvedStaffId={w.involvedStaffId}
                trips={trips} staff={staff} incidentServiceTypes={INCIDENT_SERVICE_TYPES}
                typeNote={typeChangeNote(seed, { incidentType: w.incidentType })}
              />
            )
          case 'rp':
            return (
              <RestrictivePracticeStep
                key={s} getValues={getValues} setValue={setValue} errors={errors}
                involvedParticipantId={w.involvedParticipantId} restrictivePracticeType={w.restrictivePracticeType} restrictivePracticeId={w.restrictivePracticeId}
                unapprovedRestrictivePracticeDetails={w.unapprovedRestrictivePracticeDetails} usedWithoutAuthorisation={w.usedWithoutAuthorisation}
                rpUseVaried={w.rpUseVaried} description={w.description} incidentDateTime={w.incidentDateTime} isEdit existingIncident={seed}
              />
            )
          case 'witnesses':
            return (
              <WitnessesStep
                key={s} control={control} errors={errors} reportedByStaffId={w.reportedByStaffId} staff={staff}
                existingWitnesses={seed.witnesses} isEdit addedHint="Will be asked to approve after you save" confirmRemoveAnswered
              />
            )
          case 'compliance':
            return (
              <ComplianceStep
                key={s} register={register} setValue={setValue} errors={errors} status={w.status}
                awareAtMax={toDatetimeLocalValue(new Date().toISOString(), incident.timeZoneId)} severity={w.severity} incidentType={w.incidentType}
                isRestrictivePracticeAuthorised={seed.isRestrictivePracticeAuthorised} restrictivePracticeUseVaried={seed.restrictivePracticeUseVaried}
                reportableClass={w.reportableClass} commissionFinalReportRequested={w.commissionFinalReportRequested}
                familyNotified={w.familyNotified} supportCoordinatorNotified={w.supportCoordinatorNotified}
              />
            )
        }
      })}

      {update.isError && <Callout tone="error">{saveErrorMessage(update.error, GROUP_LABELS[group])}</Callout>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" size="md" onClick={() => onClose(false)} disabled={update.isPending} className="w-full sm:w-auto">Cancel</Button>
        <Button type="submit" size="md" disabled={update.isPending} className="w-full sm:w-auto">{update.isPending ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )
}
