import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useApprovalPreview, useApproveServiceAgreementDraft } from '@/api/hooks'
import type { ApprovalActivationDto, ApprovalReasonDto, DraftApprovalPreviewDto, OverlappingPatternDto, ServiceAgreementDraftDto } from '@/api/types'
import { BudgetWarnings } from '@/components/BudgetWarnings'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { CheckboxField } from '@/components/CheckboxField'
import { Modal } from '@/components/Modal'
import { PageState } from '@/components/PageState'
import { retryingAfterError } from '@/lib/queryPhase'
import { StatusBadge } from '@/components/StatusBadge'
import { TAP_FLOOR } from '@/components/tapArea'
import { formatServiceDate, plural } from '@/lib/format'
import { httpStatusOf } from '@/lib/httpStatus'
import { shiftWords, type ShiftGroup } from '@/lib/agreementShifts'
import { REASON_COPY, friendlyMessage, isRefusal } from '@/lib/planQuote'
import { rosterLink } from '@/lib/rosterLinks'
import { formatShiftTime } from '@/lib/utils'

/**
 * The reasons only approval has (the engine's own are in REASON_COPY), and where each is fixed: The server's sentence for
 * each of these is complete (it names the block, how many and from when), so the dialog shows it as it is, with no title that would say it again; an engine reason keeps its title, and how many shifts,
 * and gets the written advice of REASON_COPY under it. `advice` here is for the one approval-only reason whose sentence says what is wrong and not what to do.
 */
const OWN_REASONS: Record<string, { hard: boolean; advice?: string }> = {
  HolidayUndecided: { hard: false },
  ReviewFlag: { hard: false },
  HandTyped: { hard: true },
  BlockUnreadable: { hard: true },
  BlockInvalid: { hard: true },
  AgreementEnded: { hard: true },
  TimeZoneMismatch: { hard: true, advice: "Check the delivery state of this draft, or ask an Admin to check the organisation's state in Settings." },
  TooManyPatterns: { hard: true },
  Superseded: { hard: true },
  AlreadyApproved: { hard: true },
}

const reasonTitle = (code: string) => REASON_COPY[code as keyof typeof REASON_COPY]?.title ?? 'Needs a look'
const reasonIsHard = (code: string) => OWN_REASONS[code]?.hard ?? isRefusal(code as keyof typeof REASON_COPY)
const reasonAdvice = (code: string) => REASON_COPY[code as keyof typeof REASON_COPY]?.advice ?? OWN_REASONS[code]?.advice

/** The request was given up on (the approval's own time limit, see APPROVE_TIMEOUT_MS): no answer came back, which is not the same as "refused". */
const timedOut = (error: unknown) => {
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  return (code === 'ECONNABORTED' || code === 'ETIMEDOUT') && /timeout/i.test(message ?? '')
}

const TIMED_OUT_MESSAGE = 'It took too long. Close this and check the card: it may have been approved. If it was not, approve it again (approving twice is safe).'

/** Every sentence the server gave for a refusal (a list: saving and approving say all of them), or one of our own when it gave none. */
function failureMessages(error: unknown): string[] {
  if (httpStatusOf(error) === 429) return ['Too many requests just now. Wait a moment and try again.']
  const data = (error as { response?: { data?: { errors?: string[]; message?: string } } } | null)?.response?.data
  const said = data?.errors?.length ? data.errors : data?.message ? [data.message] : []
  return said.length > 0 ? [...new Set(said)] : ['The server could not approve this revision. Check your connection and try again; nothing was changed.']
}

type Failure = { timedOut: boolean; messages: string[] }

const timeRange = (pattern: Pick<OverlappingPatternDto, 'startTime' | 'endTime' | 'endsNextDay'>) => `${formatShiftTime(pattern.startTime)}–${formatShiftTime(pattern.endTime)}${pattern.endsNextDay ? ' +1' : ''}`

type ApprovalDialogProps = {
  open: boolean
  participantId: string
  /** The revision to approve (the newest, with its blocks): its dates and the shifts a reason is about are said in the dialog. */
  draft: ServiceAgreementDraftDto
  onClose: () => void
  /** The server approved it: the page has been told to read the revisions again. `activation` is what it did to the participant's status (null when the answer did not say). */
  onApproved: (activation: ApprovalActivationDto | null) => void
  /** The participant's first name when approving will try to move them to Active (the setting is on and they are still onboarding); the confirm step says so. */
  activatesName?: string
  /** A reason is about some shifts (named by the engine's block id): take the person to them. The dialog closes. */
  onGoToShifts?: (blockId: string) => void
  /** The server answered that a newer save has replaced this agreement (409 draft-superseded) to the preview or the approval: the page reads the agreement again. */
  onSuperseded?: () => void
}

/**
 * The confirm screen of "Mark approved". It is built from the server's preview (nothing is done until Approve is pressed): when the revision can be approved it says plainly what approval does, the
 * patterns it makes and the unfilled shifts it generates up to when (only into weeks already started on the roster), the patterns of the revision before it that end the day before this
 * one starts, what it removes and carries of the old version's shifts, and the ones it leaves, listed (with a link to them, in a new tab so the person can look and come back), the hand-made patterns that overlap (which are never changed, and
 * need a box ticked), and that an approval cannot be undone; when it cannot be approved, it lists every reason, each with the block it is about and what to do. It does not sign anything. While the
 * approval is on its way nothing closes it: the request has been sent, and Cancel would only hide a dialog the approval goes on behind. That hold ends when the request does: an answer, or the time limit
 * (APPROVE_TIMEOUT_MS), after which it says no answer came back, to check the card, and that approving again is safe.
 */
export function ApprovalDialog({ open, participantId, draft, onClose, onApproved, activatesName, onGoToShifts, onSuperseded }: ApprovalDialogProps) {
  const preview = useApprovalPreview(participantId, draft.id, open)
  const approve = useApproveServiceAgreementDraft()
  const [acknowledged, setAcknowledged] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const supersededSeen = useRef(false)
  // A dialog that is opened again starts clean: the box is unticked and the last refusal is not there.
  const [seenOpen, setSeenOpen] = useState(open)
  if (seenOpen !== open) {
    setSeenOpen(open)
    if (!open) { setAcknowledged(false); setFailure(null) }
  }

  const data = preview.data
  // The server's reasons carry the ids of the STORED blocks, which an older save may have with gaps: they are read as stored, never regrouped (regrouping renumbers them).
  const groups = useMemo<ShiftGroup[]>(() => draft.blocks.map(entry => ({ entry, shiftIds: [] })), [draft.blocks])
  const say = (text: string) => friendlyMessage(shiftWords(text, groups), [])
  // The server says it two ways: approving answers 409 draft-superseded; the preview answers 200 with canApprove false and the reason Superseded.
  const superseded = (httpStatusOf(approve.error) === 409 && (approve.error as { response?: { data?: { code?: string } } } | null)?.response?.data?.code === 'draft-superseded')
    || !!data?.reasons.some(reason => reason.code === 'Superseded')
  // Told once: the page reads the agreement again, and a second telling would read it again.
  useEffect(() => {
    if (superseded && !supersededSeen.current) { supersededSeen.current = true; onSuperseded?.() }
    if (!superseded) supersededSeen.current = false
  }, [superseded, onSuperseded])
  const needsAcknowledgement = (data?.overlappingPatterns.length ?? 0) > 0
  const pending = approve.isPending
  // Everything that would close it (the cross, Escape, the backdrop, Cancel) is held while the approval is on its way.
  const close = () => { if (!pending) onClose() }

  const submit = () => {
    setFailure(null)
    approve.mutate({ participantId, draftId: draft.id, acknowledgeOverlaps: needsAcknowledgement && acknowledged }, {
      onSuccess: answer => onApproved(answer?.activation ?? null),
      onError: error => setFailure(timedOut(error) ? { timedOut: true, messages: [TIMED_OUT_MESSAGE] } : { timedOut: false, messages: failureMessages(error) }),
    })
  }

  const cancel = <Button variant="secondary" onClick={close} disabled={pending}>Cancel</Button>
  const blocked = !!data && !data.canApprove
  const title = blocked ? 'Not ready to approve' : 'Approve this agreement for rostering?'
  const footer = !data ? cancel : blocked ? <Button variant="secondary" onClick={close}>Close</Button> : (
    <>
      {cancel}
      <Button onClick={submit} disabled={pending || (needsAcknowledgement && !acknowledged)}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{pending ? 'Approving…' : 'Approve'}
      </Button>
    </>
  )

  return (
    <Modal open={open} onClose={close} title={title} size="lg" footer={footer} closeOnBackdrop={!pending} stickyFooter>
      <div className="flex flex-col gap-3 text-sm">
        {preview.isLoading && !retryingAfterError(preview) && <PageState kind="loading" noun="approval summary" />}
        {(preview.isError || retryingAfterError(preview)) && !data && (httpStatusOf(preview.error) === 403
          ? <Callout tone="warning">{failureMessages(preview.error)[0]}</Callout>
          : <PageState kind="error" noun="approval summary" onRetry={() => preview.refetch()} />)}
        {data && (blocked
          ? <Reasons reasons={data.reasons} say={say} groups={groups} onGoToShifts={onGoToShifts ? blockId => { onGoToShifts(blockId); onClose() } : undefined} />
          : <WhatItDoes participantId={participantId} draft={draft} preview={data} activatesName={activatesName} acknowledged={acknowledged} onAcknowledge={setAcknowledged} />)}
        {failure && (failure.timedOut
          // No answer is not a refusal: it may well have been approved, so this says to look, not that it failed. The exits are back (the request is over), and approving again is safe.
          ? <Callout tone="warning" title="No answer came back">{failure.messages[0]}</Callout>
          : (
            <Callout tone="danger" title="Not approved">
              <ul className="list-disc pl-5">{failure.messages.map(message => <li key={message}>{say(message)}</li>)}</ul>
            </Callout>
          ))}
      </div>
    </Modal>
  )
}

/** Everything an approval does, in the order a coordinator weighs it: what is made, what ends, what stays, what overlaps, and that it cannot be undone. */
function WhatItDoes({ participantId, draft, preview, activatesName, acknowledged, onAcknowledge }: { participantId: string; draft: ServiceAgreementDraftDto; preview: DraftApprovalPreviewDto; activatesName?: string; acknowledged: boolean; onAcknowledge: (value: boolean) => void }) {
  const start = formatServiceDate(draft.agreementStartDate)
  const patterns = plural(preview.patternsToCreate, 'weekly pattern')
  const range = `${start} to ${formatServiceDate(draft.agreementEndDate)}`
  // The shifts are made to the horizon the server gives (the organisation's setting, never a number said here); when the agreement ends before it, everything is made now and nothing is added later.
  // Start rostering (2026-10-16): the server makes shifts only in weeks already started on the roster, so later weeks get theirs when each is started.
  const keepsGoing = !!preview.horizonEnd && preview.horizonEnd < draft.agreementEndDate
  const makesShifts = preview.shiftsToCreate > 0 && !!preview.horizonEnd
  const ends = preview.patternsToEnd > 0 && preview.endsFromVersion !== undefined
    ? `Ends ${plural(preview.patternsToEnd, 'pattern')} from the agreement it replaces the day before ${start}.`
    : null
  // What approval does to the replaced revision's shifts from this one's start: removes the unfilled drafts, carries those of a support that did not change, and leaves the rest for a person.
  const old = preview.oldShiftsRemaining
  const removed = old.removed ?? 0
  const carried = old.carried ?? 0
  const kept = old.shifts ?? []
  const keptCount = old.open + old.assigned
  const oneKept = keptCount === 1
  const overlaps = preview.overlappingPatterns
  const manyOverlaps = overlaps.length > 1

  return (
    <>
      <p className="text-[var(--color-muted-foreground)]">Puts this agreement&apos;s weekly patterns on the roster. It is separate from signing: nothing is signed or sent.</p>
      {activatesName && <p className="text-[var(--color-muted-foreground)]">Approving will also move {activatesName} to Active if they&apos;re ready.</p>}
      {/* What it does, a short line for each fact: the patterns, the shifts, what ends. */}
      <div className="flex flex-col gap-1 font-medium">
        <p>{`Creates ${patterns}, ${range}.`}</p>
        {makesShifts && <p>{`Makes ${plural(preview.shiftsToCreate, 'unfilled shift')} up to ${formatServiceDate(preview.horizonEnd!)}.${keepsGoing ? ' Later weeks get theirs when each week is started on the roster.' : ''}`}</p>}
        {ends && <p>{ends}</p>}
        {removed > 0 && old.firstDate && <p>{`Removes ${plural(removed, 'unfilled shift')} of the agreement it replaces, from ${formatServiceDate(old.firstDate)} on.`}</p>}
        {carried > 0 && <p>{carried === 1 ? "Carries over 1 shift that doesn't change." : `Carries over ${carried} shifts that don't change.`}</p>}
        {/* A matched support keeps its default worker (D10): only the changed ones start without one. */}
        {(preview.changedPatterns ?? 0) > 0 && <p>{preview.changedPatterns === 1 ? 'The changed pattern starts with no default staff.' : 'The changed patterns start with no default staff.'}</p>}
        {(preview.handEditedPatterns ?? 0) > 0 && <p>{preview.handEditedPatterns === 1 ? "1 pattern edited by hand goes back to the agreement's times." : `${preview.handEditedPatterns} patterns edited by hand go back to the agreement's times.`}</p>}
      </div>
      {preview.shiftsToCreate === 0 && <p>{preview.shiftsNote ?? 'No unfilled shifts are made now. Each week gets its shifts when it is started on the roster.'}</p>}
      {/* Budget phase 3: where the shifts approval would make take a pool past its funding. Read in order with the rest of what approval does, so it does not announce itself; and never a reason to refuse. */}
      <BudgetWarnings warnings={preview.budgetWarnings} note="This is a warning only. Approving is not blocked." announce={false} />
      {keptCount > 0 && (
        <section aria-labelledby="kept-heading" className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)]">
          <h4 id="kept-heading" className="font-semibold">{`${plural(keptCount, 'shift')} of the agreement it replaces ${oneKept ? 'stays' : 'stay'} on the roster`}</h4>
          <p className="text-[var(--color-muted-foreground)]">{oneKept
            ? 'It has a worker, is published, or has a note or completion recorded, so approval leaves it as it is. Move it or cancel it.'
            : 'They have a worker, are published, or have a note or completion recorded, so approval leaves them as they are. Move or cancel each one.'}</p>
          <ul className="flex flex-col gap-1">
            {kept.map(shift => (
              <li key={shift.id} className="flex flex-wrap items-center gap-2">
                <span>{`${formatServiceDate(shift.serviceDate)} ${timeRange(shift)} · ${shift.workerName ?? 'Unfilled'}`}</span>
                <StatusBadge status={shift.status} />
              </li>
            ))}
          </ul>
          {keptCount > kept.length && <p>{`And ${keptCount - kept.length} more.`}</p>}
          {/* A new tab: the person can look at the roster and come back to approve, instead of losing the dialog and its preview. */}
          <Link className={`${TAP_FLOOR} self-start font-medium underline`} to={rosterLink(kept[0]?.serviceDate ?? old.firstDate ?? draft.agreementStartDate, participantId)} target="_blank" rel="noopener noreferrer">
            {oneKept ? 'See it on the roster' : 'See them on the roster'}<span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </section>
      )}
      {overlaps.length > 0 && (
        <section aria-labelledby="overlap-heading" className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)]">
          <h4 id="overlap-heading" className="font-semibold">{`${plural(overlaps.length, 'hand-made pattern')} ${manyOverlaps ? 'overlap' : 'overlaps'}`}</h4>
          <p className="text-[var(--color-muted-foreground)]">{manyOverlaps
            ? 'They are not ended or changed. The new patterns are made beside them, so the roster will show shifts for both until you decide.'
            : 'It is not ended or changed. The new patterns are made beside it, so the roster will show shifts for both until you decide.'}</p>
          <ul className="flex flex-col gap-1">
            {overlaps.map(pattern => (
              <li key={pattern.id} className="flex flex-col">
                <span>{pattern.dayOfWeek.slice(0, 3)} {timeRange(pattern)} · from {formatServiceDate(pattern.effectiveFrom)}{pattern.effectiveTo ? ` to ${formatServiceDate(pattern.effectiveTo)}` : ' onwards'}</span>
                {pattern.notes && <span className="text-[13px] text-[var(--color-muted-foreground)]">{pattern.notes}</span>}
              </li>
            ))}
          </ul>
          <CheckboxField label={manyOverlaps ? 'These hand-made patterns stay as they are. I have checked them.' : 'This hand-made pattern stays as it is. I have checked it.'} checked={acknowledged} onChange={event => onAcknowledge(event.target.checked)} />
        </section>
      )}
      <p>{"You can't undo an approval. To change the roster later, save a new revision and approve that."}</p>
    </>
  )
}

/** Every reason it cannot be approved yet, in the screen's own words, with what to do about it and the way to the shifts it is about. */
function Reasons({ reasons, say, groups, onGoToShifts }: { reasons: ApprovalReasonDto[]; say: (text: string) => string; groups: readonly ShiftGroup[]; onGoToShifts?: (blockId: string) => void }) {
  // A newer revision is not something to fix: the sentence says to approve that one instead, and the preface would say the opposite.
  const lone = reasons.length === 1 && reasons[0].code === 'Superseded'
  return (
    <>
      {!lone && <p>Nothing has been changed. Fix each item, then approve the agreement you save.</p>}
      <ul className="flex flex-col gap-3">
        {reasons.map(reason => {
          const own = OWN_REASONS[reason.code] !== undefined
          const where = !own && (reason.count ?? 0) > 1 ? ` (${plural(reason.count!, 'shift')}${reason.firstDate ? `, from ${formatServiceDate(reason.firstDate)}` : ''})` : ''
          const shown = reason.blockId ? groups.some(group => group.entry.block.id === reason.blockId) : false
          const advice = say(reasonAdvice(reason.code) ?? '') || undefined
          return (
            // On a phone the way to the block goes under the sentence, so the sentence keeps the whole width.
            <li key={`${reason.code}-${reason.blockId ?? ''}-${reason.message}`} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <StatusBadge tone={reasonIsHard(reason.code) ? 'danger' : 'warning'} label={reasonIsHard(reason.code) ? 'Fix' : 'Review'} />
                <span className="min-w-0 flex-1">
                  {own ? '' : `${say(reasonTitle(reason.code))}: `}{say(reason.message)}{where}
                  {advice && <span className="mt-0.5 block text-[13px] text-[var(--color-muted-foreground)]">{advice}</span>}
                </span>
              </div>
              {onGoToShifts && reason.blockId && shown && (
                <Button className="self-start" variant="secondary" size="sm" onClick={() => onGoToShifts(reason.blockId!)}>Show the shifts</Button>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
