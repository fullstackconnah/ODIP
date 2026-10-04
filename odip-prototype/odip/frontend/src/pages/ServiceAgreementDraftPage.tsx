import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FileText, Loader2, X } from 'lucide-react'
import { useCreateServiceAgreementDraft, useDownloadServiceAgreementDraftPdf, useParticipant, useServiceAgreementDrafts } from '@/api/hooks'
import type { AgreementState, CreateServiceAgreementDraftDto, DraftBlock, PlanIssue, PlanPriceZone } from '@/api/types'
import { BackButton } from '@/components/BackButton'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FactList } from '@/components/FactList'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { formGrid, span } from '@/lib/formGrid'
import { isNotFoundError } from '@/lib/httpStatus'
import { usePermissions } from '@/lib/permissions'
import { SUPPORT_LABEL, blockProblems, normaliseBlock, stampLocation, type PlanStepKey } from '@/lib/planBlocks'
import { PRICING_FIRST_YEAR, PRICING_LAST_YEAR, conflictVersionOf, describeSaveError, formatServiceDate, friendlyMessage, isPricingDate, type SaveFailure } from '@/lib/planQuote'
import { PlanBuilder } from './plan-builder/PlanBuilder'
import { RevisionCard, type ReplacedBy } from './plan-builder/RevisionCard'

const states: AgreementState[] = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']
const ZONES: { value: PlanPriceZone; label: string }[] = [
  { value: 'National', label: 'National (most places)' },
  { value: 'Remote', label: 'Remote' },
  { value: 'VeryRemote', label: 'Very remote' },
]

type Details = {
  state: AgreementState
  zone: PlanPriceZone
  planStartDate: string
  planEndDate: string
  agreementStartDate: string
  agreementEndDate: string
  representative: string
}

const EMPTY_DETAILS: Details = { state: 'NSW', zone: 'National', planStartDate: '', planEndDate: '', agreementStartDate: '', agreementEndDate: '', representative: '' }

const snapshotOf = (details: Details, plan: readonly DraftBlock[]) => JSON.stringify({ details, plan })

/** The accessible name of the chip on a block's row that opens each step (the plan overview's own names): what "Go to block" focuses. */
const CHIP_NAME: Record<PlanStepKey, string> = {
  template: 'Edit times of block',
  times: 'Edit times of block',
  requirements: 'Edit support and requirements of block',
  travel: 'Edit travel and transport of block',
  review: 'Review prices of block',
}

/**
 * A tab or a line break pasted into a one-line box becomes the space it stands for, and any other control character (a NUL) is dropped: the server refuses a representative that has one (it is written to a
 * Postgres text column and onto the PDF), and a name that was pasted should not come back as a refusal about a character nobody can see (review N13).
 */
const withoutControlCharacters = (text: string) => text.replace(/[\t\r\n]+/g, ' ').replace(/\p{Cc}/gu, '')

/** The years the pricing engine answers for, as the bounds of every date box (a box that is left to run takes a year with six digits). */
const DATE_MIN = `${PRICING_FIRST_YEAR}-01-01`
const DATE_MAX = `${PRICING_LAST_YEAR}-12-31`

/**
 * The working copy belongs to one participant and is seeded once from that participant's newest revision, so the page is keyed by participant: a change of the route's id without a
 * remount would show, and then save, one participant's blocks under another.
 */
export default function ServiceAgreementDraftPage() {
  const { id } = useParams<{ id: string }>()
  return <DraftPage key={id} />
}

function DraftPage() {
  const { id: participantId } = useParams<{ id: string }>()
  const participant = useParticipant(participantId)
  const drafts = useServiceAgreementDrafts(participantId)
  const create = useCreateServiceAgreementDraft()
  const download = useDownloadServiceAgreementDraftPdf()
  const { canManageParticipantLifecycle: canEdit } = usePermissions()

  // The working copy: the agreement's details and the blocks of the plan. It starts as the newest revision's (a revision is never edited: saving makes the next one) and is
  // saved as a whole. `baseline` is what it looked like when it was loaded or last saved, to know whether there is anything to lose.
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS)
  const [plan, setPlan] = useState<DraftBlock[]>([])
  const [baseline, setBaseline] = useState<string | null>(null)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [savedVersion, setSavedVersion] = useState<number | null>(null)
  // The version of the newest revision this working copy started from (0 when there was none), sent with a save: if somebody else has saved a newer one since, the server says so (409)
  // instead of making this plan the newest over their work, and `conflict` is the version they made.
  const [baseVersion, setBaseVersion] = useState(0)
  const [conflict, setConflict] = useState<number | null>(null)
  const [confirmingLoad, setConfirmingLoad] = useState(false)
  // A block is being built that has been changed and is not in the plan yet: leaving would lose it too.
  const [building, setBuilding] = useState(false)
  // A block is open in the stepper, changed or not. It is a copy of one of the plan's blocks (or a new one) and belongs to the plan it was opened from: loading another version closes it.
  const [blockOpen, setBlockOpen] = useState(false)
  // Counts the versions loaded over the working copy. The plan builder is keyed by it, so that what it holds in flight (the open block, its step, its copy) is not carried over to the plan that replaced it:
  // Save block would write that old copy over whatever block is at its place in the loaded version (review M3).
  const [loadCount, setLoadCount] = useState(0)
  // The newer version is being read to be loaded. A save pressed meanwhile would be made on the version this plan started from and meet the 409 again, for the version that has just been loaded
  // (review L5): Save is held, and so are the buttons that would answer the notice a second time.
  const [loadingNewest, setLoadingNewest] = useState(false)
  // The revision whose "Start a new revision" was pressed. A revision somebody approved for rostering is what the roster was made from, so its page is read only until somebody says they mean to change
  // it, and then only for THAT revision: when the next version is saved (and is itself approved one day) the page is locked again. Nothing is saved by pressing it; the working copy was already the newest.
  const [revisingFrom, setRevisingFrom] = useState<string | null>(null)
  // Start a new revision was pressed and the plan's heading has not been brought into view yet: that has to wait for the page to unlock (a short list of facts becomes a tall form above the plan), or the heading is
  // focused where it is about to move from.
  const headingDue = useRef(false)

  const loaded = drafts.data !== undefined
  if (loaded && baseline === null) {
    const latest = drafts.data?.[0]
    setBaseVersion(latest?.version ?? 0)
    // A revision with a block that can no longer be read is not loaded: an empty block would look like a plan nobody made, and saving over it would lose it for good.
    if (latest && latest.blocks.length > 0 && !latest.blocks.some(entry => entry.unreadable)) {
      const next: Details = {
        state: latest.state, zone: latest.blocks[0].block.location.zone, planStartDate: latest.planStartDate, planEndDate: latest.planEndDate,
        agreementStartDate: latest.agreementStartDate, agreementEndDate: latest.agreementEndDate, representative: latest.representative ?? '',
      }
      setDetails(next)
      setPlan(latest.blocks)
      setBaseline(snapshotOf(next, latest.blocks))
    } else {
      setBaseline(snapshotOf(EMPTY_DETAILS, []))
    }
  }

  const newest = drafts.data?.[0]
  const unreadableVersion = newest && newest.blocks.some(entry => entry.unreadable) ? newest.version : null
  const locked = canEdit && !!newest?.approval && revisingFrom !== newest.id

  // Dates typed over an empty plan are nothing to lose: there is nothing to save until there is a block.
  const dirty = baseline !== null && plan.length > 0 && snapshotOf(details, plan) !== baseline
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(dirty || building)

  // The block that was open went with the plan it was a copy of; focus, which was on the dialog's opener (gone with the conflict notice), goes to the plan's heading.
  useEffect(() => {
    if (loadCount > 0) document.getElementById('plan-heading')?.focus()
  }, [loadCount])

  // After Start a new revision: once the page has unlocked, the plan's heading goes to the top of the view (clear of the sticky header: it has a scroll margin) and takes focus, where the button was.
  useEffect(() => {
    if (!revisingFrom || !headingDue.current) return
    headingDue.current = false
    const heading = document.getElementById('plan-heading')
    heading?.scrollIntoView?.({ block: 'start' })
    heading?.focus({ preventScroll: true })
  }, [revisingFrom])

  const canonicalIdentifiers = useMemo(() => ({
    ndis: participant.data?.ndisNumber ? 'Recorded on participant' : 'Not recorded on participant',
    dob: participant.data?.dateOfBirth || 'Not recorded on participant',
  }), [participant.data])

  if (participant.isLoading || drafts.isLoading) return <PageState kind="loading" noun="service agreement draft" />
  // A read of the drafts that fails once the page has them (the second read of a conflict, say) does not take the plan on screen away: it is said where the person is (loadNewest), not by an error page.
  if (participant.isError || (drafts.isError && !loaded)) {
    return isNotFoundError(participant.error)
      ? <PageState kind="not-found" noun="participant" backTo="/participants" backLabel="participants" />
      : <PageState kind="error" noun="service agreement drafts" onRetry={() => { void participant.refetch(); void drafts.refetch() }} />
  }
  if (!participantId || !participant.data) return <PageState kind="not-found" noun="participant" backTo="/participants" backLabel="participants" />

  // What the last save said is about the plan and the details as they were when it was pressed: any change to either lets go of the problems it found and of the failure it met (the notice that a newer version
  // exists is not about what was typed, and stays until it is answered or closed). They ride in the dock into every step, so they must not outlast the edit that answers them (review M2).
  const edit = (patch: Partial<Details>) => { setDetails(current => ({ ...current, ...patch })); setSavedVersion(null); setProblems([]); setFailure(null) }
  const changePlan = (next: DraftBlock[]) => { setPlan(next); setSavedVersion(null); setProblems([]); setFailure(null) }

  // Closing a notice takes the button that closed it with it, and focus would fall to the top of the page: it goes back to the Save that asked the question (the bar's below xl, the save row's above it, whichever
  // can take it), else to the plan's heading.
  const closing = (clear: () => void) => () => {
    const taken = [...document.querySelectorAll<HTMLElement>('[data-plan-save]')].some(control => { control.focus(); return document.activeElement === control })
    if (!taken) document.getElementById('plan-heading')?.focus()
    clear()
  }
  const closeButton = (clear: () => void) => (
    <Button variant="ghost" size="sm" iconOnly aria-label="Close this message" onClick={closing(clear)}><X className="h-4 w-4" aria-hidden="true" /></Button>
  )

  const save = () => {
    if (create.isPending || loadingNewest) return
    setFailure(null)
    setSavedVersion(null)
    const found: string[] = []
    const dates = [details.planStartDate, details.planEndDate, details.agreementStartDate, details.agreementEndDate]
    if (dates.some(date => !date)) found.push('Enter the plan and agreement dates.')
    else if (!dates.every(isPricingDate)) found.push(`Check the dates: each needs a day, a month and a four digit year between ${PRICING_FIRST_YEAR} and ${PRICING_LAST_YEAR}.`)
    else if (details.planEndDate < details.planStartDate || details.agreementEndDate < details.agreementStartDate) found.push('An end date cannot come before its start date.')
    if (plan.length === 0) found.push('Add at least one support block.')
    plan.forEach((entry, index) => blockProblems(entry.block).forEach(problem => found.push(`Block ${index + 1}: ${problem.message}`)))
    setProblems(found)
    if (found.length > 0) return

    const blocks = plan.map(entry => ({ block: stampLocation(normaliseBlock(entry.block), details.state, details.zone), requirements: entry.requirements }))
    const data: CreateServiceAgreementDraftDto = {
      planStartDate: details.planStartDate, planEndDate: details.planEndDate, agreementStartDate: details.agreementStartDate, agreementEndDate: details.agreementEndDate,
      state: details.state, serviceTypes: [...new Set(blocks.map(entry => SUPPORT_LABEL[entry.block.supportType]))], representative: details.representative.trim() || undefined, baseVersion, blocks,
    }
    create.mutate({ participantId, data }, {
      onSuccess: saved => { setPlan(blocks); setBaseline(snapshotOf(details, blocks)); setSavedVersion(saved?.version ?? null); setBaseVersion(saved?.version ?? baseVersion); setConflict(null) },
      onError: error => {
        const newer = conflictVersionOf(error)
        if (newer === null) { setFailure(describeSaveError(error)); return }
        // Somebody else saved a newer version: nothing on screen is touched, and theirs is fetched so that it is there to load.
        setConflict(newer)
        void drafts.refetch()
      },
    })
  }

  // Replaces the working copy with the newest revision's, once it has been read again: the details and the plan on screen are given up for it, and only for the version that was named. A read that
  // failed leaves the older revision in the cache, and seeding from that would give up what is on screen for the version this plan started from (and the next save would conflict again): so it
  // only goes ahead when the read worked and its newest version is the one the conflict named. Somebody saving yet another meanwhile makes that the version to load.
  const loadNewest = async () => {
    setConfirmingLoad(false)
    setFailure(null)
    setLoadingNewest(true)
    try {
      const read = await drafts.refetch()
      const newest = read.isError ? undefined : read.data?.[0]
      if (!newest || newest.version !== conflict) {
        if (newest && conflict !== null && newest.version > conflict) {
          setConflict(newest.version)
          setFailure({ title: `Version ${conflict} is not the newest any more`, messages: [`Version ${newest.version} has been saved since. Nothing on this page was replaced: load version ${newest.version} instead.`] })
        } else {
          setFailure({ title: `Version ${conflict ?? ''} could not be loaded`, messages: ['It could not be read just now. Nothing on this page was replaced; the version is still there to load. Try again.'] })
        }
        return
      }
      setConflict(null)
      setProblems([])
      setSavedVersion(null)
      setBaseline(null)
      setLoadCount(count => count + 1)
    } finally {
      setLoadingNewest(false)
    }
  }

  // What the last save said when it did not go through. It is drawn with the budget bar (PlanBuilder's `saveNotice`), which is docked in the overview and through every step of a block: the bar's Save
  // can be pressed from the stepper, where the save row below is not, and a Save from there that met a refusal, a conflict or a failure used to go back to "Save" without a word.
  const saveNotice = canEdit ? (
    <>
      {problems.length > 0 && (
        <Callout tone="warning" className="max-w-prose" title="Fix these before saving" actions={closeButton(() => setProblems([]))}>
          <ul className="list-disc pl-5">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
        </Callout>
      )}
      {failure && (
        <Callout tone="error" className="max-w-prose" title={failure.title} actions={closeButton(() => setFailure(null))}>
          <ul className="list-disc pl-5">{failure.messages.map(message => <li key={message}>{friendlyMessage(message, plan.map(entry => entry.block))}</li>)}</ul>
        </Callout>
      )}
      {conflict !== null && (
        <Callout tone="warning" className="max-w-prose" title={`Version ${conflict} was saved by somebody else`} actions={loadingNewest ? undefined : closeButton(() => setConflict(null))}>
          <span className="block">It was saved after the version this plan started from, so saving this plan now would replace their work as the newest version. Load version {conflict} to see what changed, then make your changes again. Nothing on this page is lost until you do.</span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={loadingNewest} onClick={() => setConfirmingLoad(true)}>{loadingNewest && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{loadingNewest ? `Loading version ${conflict}…` : `Load version ${conflict}`}</Button>
            <Button size="sm" variant="secondary" disabled={loadingNewest} onClick={() => setConflict(null)}>Keep editing</Button>
          </span>
        </Callout>
      )}
    </>
  ) : null

  // Where a reason approval was refused for is on screen: the chip of the block's step that fixes it (or the plan's heading when that block is not drawn, a block being open in the stepper, say).
  // The dialog that asked is closing, and gives focus back to the button that opened it as it does: focus goes to the block once that has happened, not before it.
  const goToBlock = (blockId: string, step: PlanStepKey) => {
    const place = plan.findIndex(entry => entry.block.id === blockId) + 1
    window.setTimeout(() => {
      const chip = place > 0 ? document.querySelector<HTMLElement>(`button[aria-label="${CHIP_NAME[step]} ${place}"]`) : null
      const target = chip ?? document.getElementById('plan-heading')
      target?.scrollIntoView?.({ block: 'center' })
      target?.focus()
    }, 0)
  }

  // Start a new revision: the button is gone as soon as the page unlocks, and focus would fall to the top of the page. It goes to the plan's heading, where the button was, once the page has unlocked
  // (the effect above; nothing is saved by pressing it).
  const startRevision = () => {
    if (!newest) return
    headingDue.current = true
    setRevisingFrom(newest.id)
  }

  // A revision approved before a newer one was is replaced by the NEXT approved one: its approval ended these patterns the day before that revision starts. The roster link belongs to the live one only.
  const replacedBy = (draft: { version: number; approval?: unknown }): ReplacedBy | undefined => {
    if (!draft.approval) return undefined
    const next = (drafts.data ?? []).filter(other => other.approval && other.version > draft.version).sort((a, b) => a.version - b.version)[0]
    return next?.approval ? { version: next.version, approvedAt: next.approval.approvedAt, agreementStartDate: next.agreementStartDate } : undefined
  }

  const saveRow = ({ refused }: { refused: readonly PlanIssue[] }) => canEdit && !locked ? (
    <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button data-plan-save onClick={save} disabled={create.isPending || loadingNewest || refused.length > 0}>{create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}{create.isPending ? 'Saving draft…' : 'Save draft'}</Button>
        <p className="text-sm text-[var(--color-muted-foreground)]">{dirty ? 'You have unsaved changes. ' : ''}Every save is a new version: earlier versions never change.</p>
      </div>
    </div>
  ) : null

  return <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-6xl">
    {unsavedChangesDialog}
    <ConfirmDialog
      open={confirmingLoad}
      onCancel={() => setConfirmingLoad(false)}
      onConfirm={() => { void loadNewest() }}
      title={`Load version ${conflict ?? ''}?`}
      message={`Loading it replaces the plan and the details on screen with that version's. What you changed here since this page opened is not kept.${blockOpen ? ` The block you have open is closed${building ? ', and its changes with it' : ''}.` : ''}`}
      confirmLabel={`Load version ${conflict ?? ''}`}
    />
    <div className="flex items-start gap-4">
      <BackButton to={`/participants/${participantId}`} label="participant" variant="icon" history={false} className="mt-1" />
      <div className="flex-1">
        <PageHeader title="Service agreement draft" subtitle={participant.data.fullName} />
      </div>
    </div>

    <div role="note" className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning-container)] p-[var(--card-pad)] text-sm text-[var(--color-on-warning-container)] space-y-2">
      <p><strong>Draft only:</strong> not approved for signing or use. It can&apos;t activate the participant, invoice or claim. Approving a revision for rostering is separate: it only makes that revision&apos;s weekly patterns and unfilled shifts.</p>
      <p><strong>Participant identifiers come from the participant record.</strong> NDIS number: {canonicalIdentifiers.ndis}; date of birth: {canonicalIdentifiers.dob}. <Link className="underline font-medium" to={`/participants/${participantId}/profile`}>View or edit participant details</Link>. A snapshot of both is stored with this draft and printed on its PDF, which any signed-in user can open; a later change to the record does not change an existing draft.</p>
    </div>

    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] flex flex-col gap-[var(--section-gap)]">
      <h2 className="font-semibold">Draft details</h2>
      {/* A revision nobody may change (approved for rostering, or read by somebody who cannot edit) shows its details as facts, not as a form of greyed-out boxes that look broken. */}
      {!canEdit || locked ? (
        <FactList items={[
          { label: 'State', value: details.state },
          { label: 'Price zone', value: ZONES.find(zone => zone.value === details.zone)?.label ?? details.zone },
          { label: 'Plan', value: `${formatServiceDate(details.planStartDate)} to ${formatServiceDate(details.planEndDate)}` },
          { label: 'Agreement', value: `${formatServiceDate(details.agreementStartDate)} to ${formatServiceDate(details.agreementEndDate)}` },
          { label: 'Representative', value: details.representative },
        ]} />
      ) : (
      <fieldset className="min-w-0">
        <div className={formGrid}>
          <FormField label="State" className={span.short}>
            <select value={details.state} onChange={e => edit({ state: e.target.value as AgreementState })}>{states.map(value => <option key={value} value={value}>{value}</option>)}</select>
          </FormField>
          <FormField label="Price zone" className={span.medium} hint="Where the supports are delivered. Remote and very remote add the NDIS loading.">
            <select value={details.zone} onChange={e => edit({ zone: e.target.value as PlanPriceZone })}>{ZONES.map(zone => <option key={zone.value} value={zone.value}>{zone.label}</option>)}</select>
          </FormField>
          <FormField label="Plan start" className={span.date}>
            <input type="date" min={DATE_MIN} max={DATE_MAX} value={details.planStartDate} onChange={e => edit({ planStartDate: e.target.value })} />
          </FormField>
          <FormField label="Plan end" className={span.date}>
            <input type="date" min={DATE_MIN} max={DATE_MAX} value={details.planEndDate} onChange={e => edit({ planEndDate: e.target.value })} />
          </FormField>
          <FormField label="Agreement start" className={span.date}>
            <input type="date" min={DATE_MIN} max={DATE_MAX} value={details.agreementStartDate} onChange={e => edit({ agreementStartDate: e.target.value })} />
          </FormField>
          <FormField label="Agreement end" className={span.date}>
            <input type="date" min={DATE_MIN} max={DATE_MAX} value={details.agreementEndDate} onChange={e => edit({ agreementEndDate: e.target.value })} />
          </FormField>
          <FormField label="Representative" className={span.medium}>
            <input value={details.representative} maxLength={500} onChange={e => edit({ representative: withoutControlCharacters(e.target.value) })} />
          </FormField>
        </div>
      </fieldset>
      )}
    </section>

    {unreadableVersion !== null && (
      <Callout tone="warning" className="max-w-prose" title={`Version ${unreadableVersion} could not be opened for editing`}>
        A block in it can no longer be read, so it is not loaded here: an empty block would look like a plan nobody made. The version is kept as it was, with its lines, below. Build the plan again and save it as the next version.
      </Callout>
    )}

    <PlanBuilder
      key={loadCount}
      participantId={participantId}
      state={details.state}
      zone={details.zone}
      from={details.agreementStartDate}
      to={details.agreementEndDate}
      entries={plan}
      onChange={changePlan}
      readOnly={!canEdit || locked}
      readOnlyNote={locked ? 'Approved for rostering. Start a new revision to change.' : 'You can read this plan; Admins and Coordinators change it.'}
      // A locked plan shows what the revision was approved at, as it was saved: no live quote is asked for.
      stored={locked && newest?.pricing ? { period: newest.pricing, weekly: null, week: null } : undefined}
      readOnlyAction={locked && newest ? <Button onClick={startRevision}>Start a new revision</Button> : undefined}
      footer={saveRow}
      onBuildingChange={setBuilding}
      onOpenChange={setBlockOpen}
      unsaved={canEdit && !locked && dirty ? { onSave: save, saving: create.isPending, holding: loadingNewest } : undefined}
      saveNotice={saveNotice}
      savedNote={canEdit && savedVersion !== null ? `Saved as version ${savedVersion}.` : null}
    />

    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] flex flex-col gap-[var(--section-gap)]">
      <h2 className="font-semibold">Draft versions</h2>
      {(drafts.data ?? []).length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No draft versions yet.</p> : (drafts.data ?? []).map((draft, index) => (
        <RevisionCard key={draft.id} participantId={participantId} draft={draft} onDownload={id => download.mutate({ participantId, id })} downloading={download.isPending} isNewest={index === 0} onGoToBlock={goToBlock} replacedBy={replacedBy(draft)} />
      ))}
      {download.isError && <Callout tone="error">Could not download this draft PDF. Try again.</Callout>}
      <p className="text-xs text-[var(--color-muted-foreground)] flex gap-2"><FileText className="w-4 h-4 shrink-0" /> Draft PDFs are informational only — not signed and not billing authority.</p>
    </section>
  </div>
}
