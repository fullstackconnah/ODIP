import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FileText, Loader2 } from 'lucide-react'
import { useCreateServiceAgreementDraft, useDownloadServiceAgreementDraftPdf, useParticipant, useServiceAgreementDrafts } from '@/api/hooks'
import type { AgreementState, CreateServiceAgreementDraftDto, DraftBlock, PlanIssue, PlanPriceZone } from '@/api/types'
import { BackButton } from '@/components/BackButton'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { formGrid, span } from '@/lib/formGrid'
import { isNotFoundError } from '@/lib/httpStatus'
import { usePermissions } from '@/lib/permissions'
import { SUPPORT_LABEL, blockProblems, normaliseBlock, stampLocation } from '@/lib/planBlocks'
import { PRICING_FIRST_YEAR, PRICING_LAST_YEAR, conflictVersionOf, describeSaveError, friendlyMessage, isPricingDate, type SaveFailure } from '@/lib/planQuote'
import { PlanBuilder } from './plan-builder/PlanBuilder'
import { RevisionCard } from './plan-builder/RevisionCard'

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

/** "Block 1", "Blocks 1 and 3", "Blocks 1, 3 and 4". */
function blocksNamed(places: readonly number[]): string {
  if (places.length === 1) return `Block ${places[0]}`
  return `Blocks ${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`
}

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

  // Dates typed over an empty plan are nothing to lose: there is nothing to save until there is a block.
  const dirty = baseline !== null && plan.length > 0 && snapshotOf(details, plan) !== baseline
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(dirty || building)
  const canonicalIdentifiers = useMemo(() => ({
    ndis: participant.data?.ndisNumber ? 'Recorded on participant' : 'Not recorded on participant',
    dob: participant.data?.dateOfBirth || 'Not recorded on participant',
  }), [participant.data])

  if (participant.isLoading || drafts.isLoading) return <PageState kind="loading" noun="service agreement draft" />
  if (participant.isError || drafts.isError) {
    return isNotFoundError(participant.error)
      ? <PageState kind="not-found" noun="participant" backTo="/participants" backLabel="participants" />
      : <PageState kind="error" noun="service agreement drafts" onRetry={() => { void participant.refetch(); void drafts.refetch() }} />
  }
  if (!participantId || !participant.data) return <PageState kind="not-found" noun="participant" backTo="/participants" backLabel="participants" />

  const edit = (patch: Partial<Details>) => { setDetails(current => ({ ...current, ...patch })); setSavedVersion(null) }
  const changePlan = (next: DraftBlock[]) => { setPlan(next); setSavedVersion(null); setProblems([]) }

  const save = () => {
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

  // Replaces the working copy with the newest revision's, once it has been read again: the details and the plan on screen are given up for it.
  const loadNewest = async () => {
    setConfirmingLoad(false)
    await drafts.refetch()
    setConflict(null)
    setFailure(null)
    setProblems([])
    setSavedVersion(null)
    setBaseline(null)
  }

  // What the last save said when it did not go through. It is drawn with the budget bar (PlanBuilder's `saveNotice`), which is docked in the overview and through every step of a block: the bar's Save
  // can be pressed from the stepper, where the save row below is not, and a Save from there that met a refusal, a conflict or a failure used to go back to "Save" without a word.
  const saveNotice = canEdit ? (
    <>
      {problems.length > 0 && (
        <Callout tone="warning" className="max-w-prose" title="Fix these before saving">
          <ul className="list-disc pl-5">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
        </Callout>
      )}
      {failure && (
        <Callout tone="error" className="max-w-prose" title={failure.title}>
          <ul className="list-disc pl-5">{failure.messages.map(message => <li key={message}>{friendlyMessage(message, plan.map(entry => entry.block))}</li>)}</ul>
        </Callout>
      )}
      {conflict !== null && (
        <Callout tone="warning" className="max-w-prose" title={`Version ${conflict} was saved by somebody else`}>
          <span className="block">It was saved after the version this plan started from, so saving this plan now would replace their work as the newest version. Load version {conflict} to see what changed, then make your changes again. Nothing on this page is lost until you do.</span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirmingLoad(true)}>Load version {conflict}</Button>
            <Button size="sm" variant="secondary" onClick={() => setConflict(null)}>Keep editing</Button>
          </span>
        </Callout>
      )}
    </>
  ) : null

  const saveRow = ({ refused }: { refused: readonly PlanIssue[] }) => canEdit ? (
    <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
      {refused.length > 0 && (() => {
        // Names the blocks by their places: what to do is on each block's own row, with the step that does it, so it is not said twice.
        const places = [...new Set(refused.map(issue => plan.findIndex(entry => entry.block.id === issue.blockId)).filter(at => at >= 0))].sort((a, b) => a - b).map(at => at + 1)
        return (
          <Callout tone="error" className="max-w-prose">
            {places.length > 0 ? `${blocksNamed(places)} cannot be priced yet, so the plan cannot be saved.` : 'This plan cannot be priced yet, so it cannot be saved.'}
          </Callout>
        )
      })()}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={create.isPending || refused.length > 0}>{create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}{create.isPending ? 'Saving draft…' : 'Save draft'}</Button>
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
      message="Loading it replaces the plan and the details on screen with that version's. What you changed here since this page opened is not kept."
      confirmLabel={`Load version ${conflict ?? ''}`}
    />
    <div className="flex items-start gap-4">
      <BackButton to={`/participants/${participantId}`} label="participant" variant="icon" history={false} className="mt-1" />
      <div className="flex-1">
        <PageHeader title="Service agreement draft" subtitle={participant.data.fullName} />
      </div>
    </div>

    <div role="note" className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning-container)] p-[var(--card-pad)] text-sm text-[var(--color-on-warning-container)] space-y-2">
      <p><strong>Draft only</strong> — not approved for signing or use. It can't be used to activate the participant, roster shifts, invoice or claim.</p>
      <p><strong>Participant identifiers come from the participant record.</strong> NDIS number: {canonicalIdentifiers.ndis}; date of birth: {canonicalIdentifiers.dob}. <Link className="underline font-medium" to={`/participants/${participantId}/profile`}>View or edit participant details</Link>. A snapshot of both is stored with this draft and printed on its PDF, which any signed-in user can open; a later change to the record does not change an existing draft.</p>
    </div>

    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] flex flex-col gap-[var(--section-gap)]">
      <h2 className="font-semibold">Draft details</h2>
      <fieldset disabled={!canEdit} className="min-w-0">
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
            <input value={details.representative} maxLength={500} onChange={e => edit({ representative: e.target.value })} />
          </FormField>
        </div>
      </fieldset>
    </section>

    {unreadableVersion !== null && (
      <Callout tone="warning" className="max-w-prose" title={`Version ${unreadableVersion} could not be opened for editing`}>
        A block in it can no longer be read, so it is not loaded here: an empty block would look like a plan nobody made. The version is kept as it was, with its lines, below. Build the plan again and save it as the next version.
      </Callout>
    )}

    <PlanBuilder
      participantId={participantId}
      state={details.state}
      zone={details.zone}
      from={details.agreementStartDate}
      to={details.agreementEndDate}
      entries={plan}
      onChange={changePlan}
      readOnly={!canEdit}
      readOnlyNote="You can read this plan; Admins and Coordinators change it."
      footer={saveRow}
      onBuildingChange={setBuilding}
      unsaved={canEdit && dirty ? { onSave: save, saving: create.isPending } : undefined}
      saveNotice={saveNotice}
      savedNote={canEdit && savedVersion !== null ? `Saved as version ${savedVersion}.` : null}
    />

    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] flex flex-col gap-[var(--section-gap)]">
      <h2 className="font-semibold">Draft versions</h2>
      {(drafts.data ?? []).length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No draft versions yet.</p> : (drafts.data ?? []).map(draft => (
        <RevisionCard key={draft.id} participantId={participantId} draft={draft} onDownload={id => download.mutate({ participantId, id })} downloading={download.isPending} />
      ))}
      {download.isError && <Callout tone="error">Could not download this draft PDF. Try again.</Callout>}
      <p className="text-xs text-[var(--color-muted-foreground)] flex gap-2"><FileText className="w-4 h-4 shrink-0" /> Draft PDFs are informational only — not signed and not billing authority.</p>
    </section>
  </div>
}
