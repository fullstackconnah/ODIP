import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, X } from 'lucide-react'
import {
  useConfirmServiceNeeds, useCreateServiceAgreementDraft, useDownloadServiceAgreementDraftPdf, useFundingPlans, useParticipant, useServiceAgreementDrafts,
} from '@/api/hooks'
import type { AgreementState, CreateServiceAgreementDraftDto } from '@/api/types'
import { BackButton } from '@/components/BackButton'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageHeader } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { WizardNavFooter, WizardShell, WizardStepHeading, WizardStepRail, type WizardStepDef } from '@/components/wizard'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { agreementIssues, type AgreementIssue } from '@/lib/agreementIssues'
import { approvalHistory } from '@/lib/agreementHistory'
import { blocksToShifts, chargeHolidaysByDefault, engineLimits, shiftIdsOfBlock, type Shift } from '@/lib/agreementShifts'
import { localIsoDate } from '@/lib/dateOnly'
import { currentPlanOf, planStatus } from '@/lib/fundingPlan'
import { isNotFoundError } from '@/lib/httpStatus'
import { usePermissions } from '@/lib/permissions'
import { SUPPORT_LABEL, normaliseBlock, stampLocation } from '@/lib/planBlocks'
import { PRICING_FIRST_YEAR, PRICING_LAST_YEAR, conflictVersionOf, describeSaveError, friendlyMessage, isPricingDate, type SaveFailure } from '@/lib/planQuote'
import { ApprovalDialog } from './agreement/ApprovalDialog'
import { STATES, planDatesOf, type Details } from '@/lib/agreementDetails'
import { AgreementStep } from './agreement/AgreementStep'
import { CheckStep } from './agreement/CheckStep'
import { RunningTotal } from './agreement/RunningTotal'
import { SaveStep } from './agreement/SaveStep'
import { useAgreementPricing } from './agreement/useAgreementPricing'
import { WeekStep } from './agreement/WeekStep'

type StepKey = 'agreement' | 'week' | 'check' | 'save'
const STEPS: WizardStepDef<Details>[] = [
  { key: 'agreement', label: 'Agreement', fields: [] },
  { key: 'week', label: 'Week', fields: [] },
  { key: 'check', label: 'Check', fields: [] },
  { key: 'save', label: 'Save', fields: [] },
]

const EMPTY_DETAILS: Details = { state: 'NSW', zone: 'National', agreementStartDate: '', agreementEndDate: '', representative: '', planOverride: null }
const snapshotOf = (details: Details, shifts: readonly Shift[]) => JSON.stringify({ details, shifts })

/** The problems with the dates, each said next to the box that has it and once more for the Check and Save steps. */
function dateProblems(details: Details, plan: { start: string; end: string }): { start?: string; end?: string; plan?: string } {
  const found: { start?: string; end?: string; plan?: string } = {}
  const real = (value: string) => isPricingDate(value)
  if (!details.agreementStartDate) found.start = 'Enter the day the agreement starts.'
  else if (!real(details.agreementStartDate)) found.start = `Use a real date, in a year from ${PRICING_FIRST_YEAR} to ${PRICING_LAST_YEAR}.`
  if (!details.agreementEndDate) found.end = 'Enter the day the agreement ends.'
  else if (!real(details.agreementEndDate)) found.end = `Use a real date, in a year from ${PRICING_FIRST_YEAR} to ${PRICING_LAST_YEAR}.`
  else if (!found.start && details.agreementEndDate < details.agreementStartDate) found.end = 'The end cannot come before the start.'
  if (!real(plan.start) || !real(plan.end) || plan.end < plan.start) found.plan = 'The NDIS plan needs a start and an end, and cannot end before it starts.'
  return found
}

/**
 * The working copy belongs to one participant and is seeded once from that participant's newest save, so the page is keyed by participant: a change of the route's id without a
 * remount would show, and then save, one participant's shifts under another.
 */
export default function ServiceAgreementDraftPage() {
  const { id } = useParams<{ id: string }>()
  return <DraftPage key={id} />
}

function DraftPage() {
  const { id: participantId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const fromOnboarding = useSearchParams()[0].get('from') === 'onboarding'
  const participant = useParticipant(participantId)
  const drafts = useServiceAgreementDrafts(participantId)
  const create = useCreateServiceAgreementDraft()
  const download = useDownloadServiceAgreementDraftPdf()
  const { canManageParticipantLifecycle: canEdit, isSuperAdmin, isAdmin, isCoordinator } = usePermissions()
  const plans = useFundingPlans(participantId, canEdit)
  const today = useMemo(() => localIsoDate(), [])
  const confirmNeeds = useConfirmServiceNeeds(participantId)

  // The working copy: the agreement's details and its shifts. It starts as the newest save's (a save is never edited: saving again replaces it) and is saved as a whole. `baseline` is what it
  // looked like when it was loaded or last saved, to know whether there is anything to lose.
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [step, setStep] = useState<StepKey>('agreement')
  const [visited, setVisited] = useState<Set<string>>(() => new Set(['agreement']))
  const [attempted, setAttempted] = useState(false)
  const [weekEmpty, setWeekEmpty] = useState(false)
  const [baseline, setBaseline] = useState<string | null>(null)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [saved, setSaved] = useState(false)
  // The version of the newest save this working copy started from (0 when there was none), sent with a save: if somebody else has saved since, the server says so (409) instead of
  // replacing their work, and `conflict` is the version they made.
  const [baseVersion, setBaseVersion] = useState(0)
  const [conflict, setConflict] = useState<number | null>(null)
  const [confirmingLoad, setConfirmingLoad] = useState(false)
  const [loadingNewest, setLoadingNewest] = useState(false)
  const [approving, setApproving] = useState(false)
  // The save whose "Start a new revision" was pressed: an approved agreement is what the roster was made from, so it is read only until somebody says they mean to change it.
  const [revisingFrom, setRevisingFrom] = useState<string | null>(null)

  const recorded = useMemo(() => {
    const plan = plans.data ? currentPlanOf(plans.data.plans ?? [], today) : undefined
    return plan && planStatus(plan, today) !== 'Ended' ? { start: plan.planStart, end: plan.planEnd } : null
  }, [plans.data, today])

  const loaded = drafts.data !== undefined && (!canEdit || !plans.isLoading)
  const newest = drafts.data?.[0]
  // What is on screen is the save this working copy was loaded from or last saved as, not whatever has been read since: the PDF, the approval and the onboarding confirmation are of that one.
  const onScreen = drafts.data?.find(entry => entry.version === baseVersion)
  const behind = !!newest && !!onScreen && newest.id !== onScreen.id
  if (loaded && baseline === null && participant.data) {
    setBaseVersion(newest?.version ?? 0)
    // A save with a block that can no longer be read is not loaded: an empty shift would look like a schedule nobody made, and saving over it would lose it for good.
    if (newest && newest.blocks.length > 0 && !newest.blocks.some(entry => entry.unreadable)) {
      const loadedPlan = { start: newest.planStartDate, end: newest.planEndDate }
      const derived = recorded ?? { start: newest.agreementStartDate, end: newest.agreementEndDate }
      const next: Details = {
        state: newest.state, zone: newest.blocks[0].block.location.zone, agreementStartDate: newest.agreementStartDate, agreementEndDate: newest.agreementEndDate,
        representative: newest.representative ?? '', planOverride: loadedPlan.start === derived.start && loadedPlan.end === derived.end ? null : loadedPlan,
      }
      const storedShifts = blocksToShifts(newest.blocks)
      const loadedShifts = chargeHolidaysByDefault(storedShifts)
      setDetails(next)
      setShifts(loadedShifts)
      // The baseline is what was SAVED: a save with undecided holidays reads as charged on screen, and that is a change nobody has saved.
      setBaseline(snapshotOf(next, storedShifts))
      setVisited(new Set(STEPS.map(entry => entry.key)))
    } else {
      const fromParticipant = participant.data.addressState as AgreementState | null
      const start: Details = { ...EMPTY_DETAILS, state: fromParticipant && STATES.includes(fromParticipant) ? fromParticipant : EMPTY_DETAILS.state, agreementStartDate: recorded?.start ?? '', agreementEndDate: recorded?.end ?? '' }
      setDetails(start)
      setBaseline(snapshotOf(start, []))
    }
  }

  const unreadableVersion = newest && newest.blocks.some(entry => entry.unreadable) ? newest.version : null
  const locked = canEdit && !!newest?.approval && revisingFrom !== newest.id
  const readOnly = !canEdit || locked
  const plan = planDatesOf(details, recorded)
  const dates = dateProblems(details, plan)
  const dirty = baseline !== null && (shifts.length > 0 || !!newest) && snapshotOf(details, shifts) !== baseline
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(dirty)
  const limits = useMemo(() => engineLimits(shifts), [shifts])

  const pricing = useAgreementPricing({
    participantId: participantId ?? '', shifts, state: details.state, zone: details.zone, from: details.agreementStartDate, to: details.agreementEndDate,
    canQuote: canEdit, stored: newest?.pricing ? { period: newest.pricing, weekly: null, week: null } : undefined,
  })
  const issues = useMemo<AgreementIssue[]>(() => {
    const list: AgreementIssue[] = []
    const dateText = [dates.start, dates.end, dates.plan].filter((text): text is string => !!text)
    if (dateText.length > 0) list.push({ key: 'dates', tone: 'fix', title: dateText.join(' '), shiftIds: [], step: 'agreement' })
    if (shifts.length === 0) list.push({ key: 'no-shifts', tone: 'fix', title: 'Add at least one shift to the week.', shiftIds: [], step: 'week' })
    return [...list, ...agreementIssues({ shifts, groups: pricing.groups, quoteIssues: pricing.issues, limits, to: details.agreementEndDate, settings: pricing.settings })]
  }, [dates.start, dates.end, dates.plan, shifts, pricing.groups, pricing.issues, pricing.settings, limits, details.agreementEndDate])
  const blocking = issues.filter(issue => issue.tone === 'fix')
  const flagged = useMemo(() => new Set(issues.filter(issue => issue.step === 'week').flatMap(issue => issue.shiftIds)), [issues])

  const canonicalIdentifiers = {
    ndis: participant.data?.ndisNumber ? 'Recorded on participant' : 'Not recorded on participant',
    dob: participant.data?.dateOfBirth || 'Not recorded on participant',
  }

  if (participant.isLoading || drafts.isLoading || (canEdit && plans.isLoading && !plans.isError)) return <PageState kind="loading" noun="service agreement" />
  // A read of the saves that fails once the page has them (the second read of a conflict, say) does not take the schedule on screen away: it is said where the person is, not by an error page.
  if (participant.isError || (drafts.isError && drafts.data === undefined)) {
    return isNotFoundError(participant.error)
      ? <PageState kind="not-found" noun="participant" backTo="/participants" backLabel="participants" />
      : <PageState kind="error" noun="service agreement" onRetry={() => { void participant.refetch(); void drafts.refetch() }} />
  }
  if (!participantId || !participant.data) return <PageState kind="not-found" noun="participant" backTo="/participants" backLabel="participants" />

  // What the last save said is about the schedule and the details as they were when it was pressed: any change lets go of the failure it met (the notice that a newer save exists is not
  // about what was typed, and stays until it is answered or closed).
  const edit = (patch: Partial<Details>) => { setDetails(current => ({ ...current, ...patch })); setSaved(false); setFailure(null) }
  const changeShifts = (next: Shift[]) => { setShifts(next); setSaved(false); setFailure(null); setWeekEmpty(false) }

  const go = (key: string, keepSelection = false) => {
    if (!keepSelection) setSelected([])
    setStep(key as StepKey)
    setVisited(current => new Set(current).add(key))
  }
  const next = () => {
    if (step === 'agreement') {
      setAttempted(true)
      if (dates.start || dates.end || dates.plan) return
      go('week')
    } else if (step === 'week') {
      if (shifts.length === 0) { setWeekEmpty(true); return }
      go('check')
    } else if (step === 'check') go('save')
  }
  const back = () => go(STEPS[Math.max(0, STEPS.findIndex(entry => entry.key === step) - 1)].key)
  const fix = (issue: AgreementIssue) => {
    if (issue.step === 'agreement') { go('agreement'); setAttempted(true); return }
    go('week', true)
    setSelected(issue.shiftIds)
  }
  const selectShiftsOf = (blockIds: string[]) => {
    go('week', true)
    setSelected(pricing.groups.filter(group => blockIds.includes(group.entry.block.id)).flatMap(group => group.shiftIds))
  }

  const save = () => {
    if (create.isPending || loadingNewest || readOnly || blocking.length > 0) return
    setFailure(null)
    setSaved(false)
    const blocks = pricing.groups.map(group => ({ block: stampLocation(normaliseBlock(group.entry.block), details.state, details.zone), requirements: group.entry.requirements }))
    const data: CreateServiceAgreementDraftDto = {
      planStartDate: plan.start, planEndDate: plan.end, agreementStartDate: details.agreementStartDate, agreementEndDate: details.agreementEndDate,
      state: details.state, serviceTypes: [...new Set(blocks.map(entry => SUPPORT_LABEL[entry.block.supportType]))], representative: details.representative.trim() || undefined, baseVersion, blocks,
    }
    create.mutate({ participantId, data }, {
      onSuccess: result => { setBaseline(snapshotOf(details, shifts)); setSaved(true); setBaseVersion(result?.version ?? baseVersion); setConflict(null) },
      onError: error => {
        const newer = conflictVersionOf(error)
        if (newer === null) { setFailure(describeSaveError(error)); return }
        // Somebody else saved a newer one: nothing on screen is touched, and theirs is read so that it is there to load.
        setConflict(newer)
        void drafts.refetch()
      },
    })
  }

  // The approval or its preview was refused because a newer save has replaced this agreement: read the agreement again, and if there is a newer one, offer it.
  const superseded = () => {
    void drafts.refetch().then(read => {
      const latest = read.isError ? undefined : read.data?.[0]
      if (latest && latest.version > baseVersion) { setApproving(false); setConflict(latest.version) }
    })
  }

  // Replaces the working copy with the newest save's, once it has been read again: the details and the shifts on screen are given up for it, and only for the save that was named. A read that
  // failed leaves the older one in the cache, and seeding from that would give up what is on screen for the agreement this one started from (and the next save would conflict again).
  const loadNewest = async () => {
    setConfirmingLoad(false)
    setFailure(null)
    setLoadingNewest(true)
    try {
      const read = await drafts.refetch()
      const latest = read.isError ? undefined : read.data?.[0]
      if (!latest || latest.version !== conflict) {
        if (latest && conflict !== null && latest.version > conflict) {
          setConflict(latest.version)
          setFailure({ title: 'Somebody has saved again', messages: ['Nothing on this page was replaced. Load the newest agreement instead.'] })
        } else {
          setFailure({ title: 'Their agreement could not be loaded', messages: ['It could not be read just now. Nothing on this page was replaced; it is still there to load. Try again.'] })
        }
        return
      }
      setConflict(null)
      setSaved(false)
      setBaseline(null)
      setSelected([])
    } finally {
      setLoadingNewest(false)
    }
  }

  const closeButton = (clear: () => void) => (
    <Button variant="ghost" size="sm" iconOnly aria-label="Close this message" onClick={clear}><X className="h-4 w-4" aria-hidden="true" /></Button>
  )
  const notices = canEdit ? (
    <>
      {failure && (
        <Callout tone="error" className="max-w-prose" title={failure.title} actions={closeButton(() => setFailure(null))}>
          <ul className="list-disc pl-5">{failure.messages.map(message => <li key={message}>{friendlyMessage(message, [])}</li>)}</ul>
        </Callout>
      )}
      {conflict !== null && (
        <Callout tone="warning" className="max-w-prose" title="Somebody else saved this agreement" actions={loadingNewest ? undefined : closeButton(() => setConflict(null))}>
          <span className="block">They saved after you opened it, so saving now would replace their work. Load theirs to see what changed, then make your changes again. Nothing here has been lost yet.</span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={loadingNewest} onClick={() => setConfirmingLoad(true)}>{loadingNewest && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{loadingNewest ? 'Loading…' : 'Load their agreement'}</Button>
            <Button size="sm" variant="secondary" disabled={loadingNewest} onClick={() => setConflict(null)}>Keep editing</Button>
          </span>
        </Callout>
      )}
    </>
  ) : null

  // Approval: the newest save, built from shifts, not yet approved, for the roles the organisation lets approve. A SuperAdmin acting for an organisation always may.
  const approverRoles = pricing.settings?.approverRoles
  const mayApprove = isSuperAdmin || !approverRoles || (isAdmin && approverRoles.includes('Admin')) || (isCoordinator && approverRoles.includes('Coordinator'))
  const approvable = canEdit && !!onScreen && onScreen.blocks.length > 0 && !onScreen.approval && unreadableVersion === null
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (step !== 'save') next()
    else if (readOnly) navigate(`/participants/${participantId}`)
    else save()
  }
  const stepIndex = STEPS.findIndex(entry => entry.key === step)
  const current = STEPS[stepIndex]
  const total = <RunningTotal status={pricing.status} answer={pricing.answer} refreshing={pricing.refreshing} error={pricing.error} onRetry={pricing.retry} budgetView={pricing.budgetView} leftOut={pricing.leftOut} />

  return <div className="flex max-w-6xl flex-col gap-[var(--section-gap)] animate-fade-in">
    {unsavedChangesDialog}
    <ConfirmDialog
      open={confirmingLoad}
      onCancel={() => setConfirmingLoad(false)}
      onConfirm={() => { void loadNewest() }}
      title="Load their agreement?"
      message="Loading it replaces the details and the shifts on screen with theirs. What you changed here since this page opened is not kept."
      confirmLabel="Load their agreement"
    />
    {approvable && onScreen && mayApprove && (
      <ApprovalDialog
        open={approving}
        participantId={participantId}
        draft={onScreen}
        onClose={() => setApproving(false)}
        onApproved={() => setApproving(false)}
        onGoToShifts={blockId => { go('week', true); setSelected(shiftIdsOfBlock(onScreen.blocks, blockId)) }}
        onSuperseded={superseded}
      />
    )}
    <div className="flex items-start gap-4">
      <BackButton to={fromOnboarding ? `/onboarding/${participantId}` : `/participants/${participantId}`} label={fromOnboarding ? 'onboarding' : 'participant'} variant="icon" history={false} className="mt-1" />
      <div className="flex-1"><PageHeader title="Service agreement" subtitle={participant.data.fullName} /></div>
    </div>

    {locked && newest && (
      <Callout tone="info" className="max-w-prose" title="Approved for rostering" actions={<Button onClick={() => { setRevisingFrom(newest.id); go('week') }}>Start a new revision</Button>}>
        This agreement is read only: the roster was made from it. A new revision changes nothing until you save it.
      </Callout>
    )}
    {!canEdit && <Callout tone="info" className="max-w-prose">You can read this agreement; Admins and Coordinators change it.</Callout>}
    {unreadableVersion !== null && (
      <Callout tone="warning" className="max-w-prose" title="The saved agreement could not be opened for editing">
        Part of it can no longer be read, so it is not loaded here: an empty shift would look like a schedule nobody made. It is kept as it was. Build the week again and save it.
      </Callout>
    )}

    <form onSubmit={submit} noValidate aria-label="Service agreement">
      <WizardShell
        railLabel="Agreement steps"
        rail={<WizardStepRail steps={STEPS} visitedSteps={visited} currentKey={step} onSelect={go} orientation="auto" ariaLabel="Agreement steps" filled />}
      >
        <WizardStepHeading stepKey={step} label={current.label} />
        <div className="mt-2">
          {step === 'agreement' && (
            <div className="flex flex-col gap-[var(--section-gap)]">
              <Callout tone="info" announce={false} className="max-w-prose">
                <p><strong>Draft only:</strong> not approved for signing or use. It can&apos;t activate the participant, invoice or claim. Approving a revision for rostering is separate: it only makes that revision&apos;s weekly patterns and unfilled shifts.</p>
                <p className="mt-2"><strong>Participant identifiers come from the participant record.</strong> NDIS number: {canonicalIdentifiers.ndis}; date of birth: {canonicalIdentifiers.dob}. <Link className="underline font-medium" to={`/participants/${participantId}/profile`}>View or edit participant details</Link>. A snapshot of both is stored with this draft and printed on its PDF, which Admins and Coordinators can open; a later change to the record does not change an existing draft.</p>
              </Callout>
              <AgreementStep
                details={details} onEdit={edit} recorded={recorded} plan={plan} readOnly={readOnly} fundingTab={`/participants/${participantId}?tab=funding`}
                errors={attempted ? { start: dates.start, end: dates.end } : {}}
              />
            </div>
          )}
          {step === 'week' && (
            <div className="flex flex-col gap-[var(--section-gap)]">
              <WeekStep
                shifts={shifts} onChange={changeShifts} selected={selected} onSelect={setSelected} state={details.state} zone={details.zone} settings={pricing.settings}
                flagged={flagged} from={details.agreementStartDate} to={details.agreementEndDate} readOnly={readOnly} limits={limits}
              />
              {weekEmpty && <Callout tone="warning" className="max-w-prose">Add at least one shift to go on.</Callout>}
            </div>
          )}
          {step === 'check' && (
            <CheckStep
              pricing={pricing} issues={issues} readOnly={readOnly} onFix={fix} onChangeHolidays={selectShiftsOf}
              anySkipped={shifts.some(shift => shift.block.onPublicHoliday === 'Skip')}
            />
          )}
          {step === 'save' && (
            <SaveStep
              readOnly={!canEdit} locked={locked} hasSaved={!!onScreen} dirty={dirty} notices={notices} saved={saved ? 'Saved.' : null} blocking={blocking} onGoToCheck={() => go('check')}
              history={approvalHistory(drafts.data ?? [])}
              onDownload={() => { if (onScreen) download.mutate({ participantId, id: onScreen.id }) }}
              downloading={download.isPending} downloadFailed={download.isError}
              approval={approvable ? { mayApprove, approverRoles, notReady: onScreen?.pricing?.needsReview === true, onOpen: () => setApproving(true) } : undefined}
              onboarding={fromOnboarding && canEdit && !behind ? { onConfirm: () => confirmNeeds.mutate(), pending: confirmNeeds.isPending, done: confirmNeeds.isSuccess, failed: confirmNeeds.isError } : undefined}
            />
          )}
        </div>
        <WizardNavFooter
          showBack={stepIndex > 0}
          onBack={back}
          onNext={next}
          isReviewStep={step === 'save'}
          secondaryActions={[]}
          cancelTo={fromOnboarding ? `/onboarding/${participantId}` : `/participants/${participantId}`}
          submitLabel={readOnly ? 'Close' : 'Save agreement'}
          isSubmitting={create.isPending || loadingNewest}
          summary={total}
        />
      </WizardShell>
    </form>
  </div>
}
