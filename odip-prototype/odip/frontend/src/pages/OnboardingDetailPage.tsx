import { useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { CheckCircle2, Circle } from 'lucide-react'
import { useBeginServices, useMakeParticipantActive, useOnboarding, useParticipant, useRecordOnboardingAgreement, useRecordOnboardingExplained } from '@/api/hooks'
import type { OnboardingChecklistItem, ParticipantOnboardingDto } from '@/api/types/inquiries'
import { BackButton } from '@/components/BackButton'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Modal } from '@/components/Modal'
import { PageHeader, PageHeaderMeta } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { localIsoDate } from '@/lib/dateOnly'
import { isNotFoundError } from '@/lib/httpStatus'
import { usePermissions } from '@/lib/permissions'
import { useIntakeCompleteNotice } from './intake/intakeComplete'
import { extractErrorMessage, formatWithTimeZone } from '@/lib/utils'
import { fieldErrors } from '@/lib/fieldErrors'
import { ACTIVE_TABLE_PATH, participantActivatedState } from './profile/participantActivated'
import { retryingAfterError } from '@/lib/queryPhase'

/**
 * The onboarding checklist of one participant (owner decisions 2026-10-13): a header (name, stage, View record), one action bar (Begin
 * services, Make active) and one list of the items the server derives from data. Every item is fixed on its own screen; the agreement record is
 * the three things recorded here (the agreement, how to complain, rights explained). Roles that cannot change the lifecycle see the list read-only.
 */
export default function OnboardingDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // Complete intake started from this checklist comes back here with the confirmation the Onboarding table shows.
  const completed = useIntakeCompleteNotice()
  const { canManageParticipantLifecycle, canAccessPage, canManageFunding } = usePermissions()
  const detail = useOnboarding(id)
  const { data: participant, isLoading: participantLoading } = useParticipant(id)
  const beginServices = useBeginServices()
  const makeActive = useMakeParticipantActive()
  const [confirming, setConfirming] = useState<'begin' | 'active' | null>(null)
  const [recording, setRecording] = useState<'agreement' | 'complaints' | 'rights' | null>(null)
  const d = detail.data

  if (detail.isLoading && !retryingAfterError(detail)) return <PageState kind="loading" noun="onboarding record" />
  if (!d) {
    return (detail.isError || retryingAfterError(detail)) && !isNotFoundError(detail.error)
      ? <PageState kind="error" noun="onboarding record" onRetry={() => detail.refetch()} />
      : <PageState kind="not-found" noun="onboarding record" backTo="/participants?tab=onboarding" backLabel="onboarding" />
  }

  const name = participant ? `${participant.preferredName?.trim() || participant.firstName} ${participant.lastName}`.trim() : ''
  // Services count as started only while the participant is switched on: one archived after Begin services is back to plain onboarding (Begin services again).
  const startedOn = d.servicesStartedAt && participant?.isActive ? formatWithTimeZone(d.servicesStartedAt, undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null
  const stage = participant?.isDraft === false
    ? <StatusBadge status={participant.isActive ? 'Active' : 'Archived'} size="md" />
    : <StatusBadge tone={startedOn ? 'success' : 'info'} label={startedOn ? 'Services started' : 'Onboarding'} size="md" />
  // Only a participant still in onboarding has a lifecycle step left here.
  const canAct = canManageParticipantLifecycle && participant?.isDraft === true
  const openItems = d.items.filter(item => !item.done)
  const doneCount = d.items.length - openItems.length
  const lifecycleError = beginServices.error ?? makeActive.error
  // One lifecycle step at a time. aria-disabled, not disabled, so focus can return to the button when its dialog closes.
  const pending = beginServices.isPending || makeActive.isPending

  const confirm = () => {
    const action = confirming
    setConfirming(null)
    // The callout shows the latest attempt's refusal, never an older one.
    beginServices.reset()
    makeActive.reset()
    if (action === 'begin') beginServices.mutate({ id }, {})
    // Made active: they have left the Onboarding tab, so show them on the Active tab, as the hand-off there confirms once.
    else if (action === 'active') makeActive.mutate({ id }, { onSuccess: () => navigate(ACTIVE_TABLE_PATH, { state: participantActivatedState(id, name) }) })
  }

  const openList = openItems.length > 0
    ? <ul className="mt-2 list-disc space-y-0.5 pl-5">{openItems.map(item => <li key={item.key}>{item.label}</li>)}</ul>
    : null

  return <div className="flex flex-col gap-[var(--section-gap)]">
    <div className="flex items-start gap-2">
      <BackButton to="/participants?tab=onboarding" label="onboarding" variant="icon" className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <PageHeader
          variant="detail"
          title={participantLoading ? 'Loading…' : (name || 'Participant')}
          subtitle={(
            <PageHeaderMeta>
              {stage}
              <Link to={`/participants/${id}`} className="font-medium text-[var(--color-primary)] hover:underline">View record</Link>
            </PageHeaderMeta>
          )}
          action={canAct ? (
            <div className="flex flex-wrap items-center gap-3">
              {startedOn
                ? <span className="text-sm text-[var(--color-muted-foreground)]">Services started {startedOn}</span>
                : <Button variant="secondary" aria-disabled={pending} className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed" onClick={() => { if (!pending) setConfirming('begin') }}>Begin services</Button>}
              <Button aria-disabled={pending} className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed" onClick={() => { if (!pending) setConfirming('active') }}>Make active</Button>
            </div>
          ) : undefined}
        />
      </div>
    </div>

    {completed && <Callout tone="success">Intake complete — {completed.name} is now in onboarding.</Callout>}
    {lifecycleError ? <Callout tone="error">{extractErrorMessage(lifecycleError, 'That did not go through. Please try again.')}</Callout> : null}

    <section className="bg-[var(--color-card)] rounded-md border border-[var(--color-border)]">
      <h2 id="checklist-heading" className="px-[var(--card-pad)] pt-[var(--card-pad)] pb-2 text-base font-semibold tabular-nums">{doneCount} of {d.items.length} done</h2>
      <ul aria-labelledby="checklist-heading" className="divide-y divide-[var(--color-border)]">
        {d.items.map(item => (
          <li key={item.key} className="flex flex-col gap-2 px-[var(--card-pad)] py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2.5">
              {item.done
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" aria-hidden="true" />
                : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden="true" />}
              <span className="sr-only">{item.done ? 'Done' : 'To do'}</span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{item.label}</h3>
                {item.missing ? <p className="text-[13px] text-[var(--color-muted-foreground)]">{item.missing}</p> : null}
              </div>
            </div>
            <Fix item={item} participantId={id} canEdit={canAct} canOpenDraft={canAct && canAccessPage('agreement-drafts')} canOpenFunding={canAct && canManageFunding} onRecord={() => setRecording(item.key === 'agreement' || item.key === 'complaints' ? item.key : 'rights')} />
          </li>
        ))}
      </ul>
    </section>

    <ConfirmDialog
      open={confirming === 'begin'}
      onCancel={() => setConfirming(null)}
      onConfirm={confirm}
      title={`Begin services for ${name}?`}
      confirmLabel="Begin services"
      message={<>
        <p>They can be rostered and supported from now on: the roster board, shifts, the support worker app, medications and claims. They stay in onboarding until you make them active.</p>
        {d.servicesStartedAt && participant?.isActive === false && <p className="mt-2">This brings an archived participant back onto the rostering board.</p>}
        {openList && <p className="mt-2">Still open on the checklist:</p>}
        {openList}
      </>}
    />
    <ConfirmDialog
      open={confirming === 'active'}
      onCancel={() => setConfirming(null)}
      onConfirm={confirm}
      title={`Make ${name} active?`}
      confirmLabel="Make active"
      message={<>
        <p>This finishes onboarding and moves them to Active participants.</p>
        {openList && <p className="mt-2 font-medium">{openItems.length === 1 ? '1 checklist item is still open:' : `${openItems.length} checklist items are still open:`}</p>}
        {openList}
      </>}
    />
    {recording === 'agreement' && <AgreementRecordDialog participantId={id} detail={d} onClose={() => setRecording(null)} />}
    {(recording === 'complaints' || recording === 'rights') && <ExplainedRecordDialog participantId={id} detail={d} focus={recording} onClose={() => setRecording(null)} />}
  </div>
}

/** The one fix for an item, for the roles that may open where it is fixed. */
function Fix({ item, participantId, canEdit, canOpenDraft, canOpenFunding, onRecord }: {
  item: OnboardingChecklistItem; participantId: string; canEdit: boolean; canOpenDraft: boolean; canOpenFunding: boolean; onRecord: () => void
}) {
  // An open item's fix carries the weight; a done item's stays reachable but quiet. On a phone the row stacks, so the button keeps its own width.
  const look = { variant: item.done ? 'ghost' as const : 'secondary' as const, size: 'sm' as const, className: 'self-start ml-[1.625rem] sm:ml-0 sm:self-auto' }
  if (item.key === 'profile') return canEdit ? <Button {...look} to={`/participants/${participantId}/profile?from=onboarding`}>Edit profile</Button> : null
  // The draft carries money, so only the roles the API admits to it are sent there.
  if (item.key === 'serviceNeeds') return canOpenDraft ? <Button {...look} to={`/participants/${participantId}/agreement-draft?from=onboarding`}>Open agreement draft</Button> : null
  if (item.key === 'agreement' || item.key === 'complaints' || item.key === 'rights') return canEdit ? <Button {...look} onClick={onRecord}>Record it</Button> : null
  return canOpenFunding ? <Button {...look} to={`/participants/${participantId}?tab=funding`}>Funding tab</Button> : null
}

/** "Signed on <date>" or "No written agreement: <reason>". Exactly one is sent; the server validates it and names the field that is wrong. */
function AgreementRecordDialog({ participantId, detail, onClose }: { participantId: string; detail: ParticipantOnboardingDto; onClose: () => void }) {
  const record = useRecordOnboardingAgreement(participantId)
  const [mode, setMode] = useState<'signed' | 'none'>(detail.noAgreementReason ? 'none' : 'signed')
  const [signedOn, setSignedOn] = useState(detail.agreementSignedOn ?? '')
  const [reason, setReason] = useState(detail.noAgreementReason ?? '')
  const errors = fieldErrors(record.error)
  // A "say one or the other" refusal is keyed to signedOn: show whichever message there is under the field on screen.
  const shownError = mode === 'signed' ? errors.signedOn ?? errors.noAgreementReason : errors.noAgreementReason ?? errors.signedOn
  const formError = record.error && !shownError ? extractErrorMessage(record.error, 'Could not save. Please try again.') : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    record.mutate(mode === 'signed' ? { signedOn } : { noAgreementReason: reason }, { onSuccess: onClose })
  }

  return (
    <Modal open onClose={onClose} title="Signed agreement" size="sm" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="submit" form="agreement-record" disabled={record.isPending}>Save</Button>
    </>}>
      <form id="agreement-record" onSubmit={submit} className="flex flex-col gap-[var(--field-gap-y)]">
        <ToggleGroup
          ariaLabel="Agreement"
          value={mode}
          onChange={key => setMode(key as 'signed' | 'none')}
          options={[{ key: 'signed', label: 'Signed' }, { key: 'none', label: 'No written agreement' }]}
        />
        {mode === 'signed'
          ? <TextField label="Signed on" type="date" required value={signedOn} onChange={e => setSignedOn(e.target.value)} error={shownError} />
          : <TextAreaField label="Reason there is no written agreement" required rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} error={shownError} />}
        {formError && <Callout tone="error">{formError}</Callout>}
      </form>
    </Modal>
  )
}

/** The two dates, each optional; the server replaces both, so a blank field clears that item. The client checks match the server's (not in the future, not before 1990). */
const EXPLAINED_MIN = '1990-01-01'

function ExplainedRecordDialog({ participantId, detail, focus, onClose }: { participantId: string; detail: ParticipantOnboardingDto; focus: 'complaints' | 'rights'; onClose: () => void }) {
  // Opened from a row, focus goes to that row's own date, not the first field.
  const complaintsRef = useRef<HTMLInputElement>(null)
  const rightsRef = useRef<HTMLInputElement>(null)
  const record = useRecordOnboardingExplained(participantId)
  const [complaints, setComplaints] = useState(detail.complaintsExplainedOn ?? '')
  const [rights, setRights] = useState(detail.rightsExplainedOn ?? '')
  const today = localIsoDate()
  // shortcut: the browser's today stands in for the provider's; the server re-checks with the provider's own zone.
  const dateError = (v: string) => v > today ? 'The date cannot be in the future.' : v && v < EXPLAINED_MIN ? 'Check the date: it is before 1990.' : undefined
  const errors = fieldErrors(record.error)
  const complaintsError = dateError(complaints) ?? errors.complaintsExplainedOn
  const rightsError = dateError(rights) ?? errors.rightsExplainedOn
  const formError = record.error && !errors.complaintsExplainedOn && !errors.rightsExplainedOn ? extractErrorMessage(record.error, 'Could not save. Please try again.') : null
  const canSave = (complaints !== '' || rights !== '') && !dateError(complaints) && !dateError(rights) && !record.isPending

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    record.mutate({ complaintsExplainedOn: complaints || null, rightsExplainedOn: rights || null }, { onSuccess: onClose })
  }

  return (
    <Modal open onClose={onClose} title="Complaints and rights" size="sm" initialFocusRef={focus === 'complaints' ? complaintsRef : rightsRef} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="submit" form="explained-record" disabled={!canSave}>Save</Button>
    </>}>
      <form id="explained-record" onSubmit={submit} className="flex flex-col gap-[var(--field-gap-y)]">
        <TextField ref={complaintsRef} label="Told how to make a complaint on" type="date" min={EXPLAINED_MIN} max={today} value={complaints} onChange={e => setComplaints(e.target.value)} error={complaintsError} />
        <TextField ref={rightsRef} label="Rights explained on" type="date" min={EXPLAINED_MIN} max={today} value={rights} onChange={e => setRights(e.target.value)} error={rightsError} />
        {formError && <Callout tone="error">{formError}</Callout>}
      </form>
    </Modal>
  )
}
