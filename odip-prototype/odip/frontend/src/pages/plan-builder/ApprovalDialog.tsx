import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useApprovalPreview, useApproveServiceAgreementDraft } from '@/api/hooks'
import type { ApprovalReasonDto, DraftApprovalPreviewDto, OverlappingPatternDto, PlanBlock, ServiceAgreementDraftDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { CheckboxField } from '@/components/CheckboxField'
import { Modal } from '@/components/Modal'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { plural } from '@/lib/format'
import { httpStatusOf } from '@/lib/httpStatus'
import type { PlanStepKey } from '@/lib/planBlocks'
import { REASON_COPY, formatServiceDate, friendlyMessage, isRefusal } from '@/lib/planQuote'
import { rosterLink } from '@/lib/rosterLinks'
import { formatShiftTime } from '@/lib/utils'

/**
 * The reasons only approval has (the engine's own are in REASON_COPY), and where each is fixed: `step` is the block step that fixes it, none when it is about the whole revision. The server's sentence for
 * each of these is complete (it names the block, how many and from when), so the dialog shows it as it is, with no title that would say it again; an engine reason keeps its title, and how many shifts,
 * and gets the written advice of REASON_COPY under it. `advice` here is for the one approval-only reason whose sentence says what is wrong and not what to do.
 */
const OWN_REASONS: Record<string, { hard: boolean; step?: PlanStepKey; advice?: string }> = {
  HolidayUndecided: { hard: false, step: 'review' },
  ReviewFlag: { hard: false, step: 'review' },
  HandTyped: { hard: true },
  BlockUnreadable: { hard: true },
  BlockInvalid: { hard: true, step: 'times' },
  AgreementEnded: { hard: true },
  TimeZoneMismatch: { hard: true, advice: "Check the delivery state of this draft, or ask an Admin to check the organisation's state in Settings." },
  TooManyPatterns: { hard: true },
  Superseded: { hard: true },
  AlreadyApproved: { hard: true },
}

const reasonTitle = (code: string) => REASON_COPY[code as keyof typeof REASON_COPY]?.title ?? 'Needs a look'
const reasonStep = (code: string): PlanStepKey => REASON_COPY[code as keyof typeof REASON_COPY]?.step ?? OWN_REASONS[code]?.step ?? 'review'
const reasonIsHard = (code: string) => OWN_REASONS[code]?.hard ?? isRefusal(code as keyof typeof REASON_COPY)
const reasonAdvice = (code: string) => REASON_COPY[code as keyof typeof REASON_COPY]?.advice ?? OWN_REASONS[code]?.advice

/** Every sentence the server gave for a refusal (a list: saving and approving say all of them), or one of our own when it gave none. */
function failureMessages(error: unknown): string[] {
  if (httpStatusOf(error) === 429) return ['Too many requests just now. Wait a moment and try again.']
  const data = (error as { response?: { data?: { errors?: string[]; message?: string } } } | null)?.response?.data
  const said = data?.errors?.length ? data.errors : data?.message ? [data.message] : []
  return said.length > 0 ? [...new Set(said)] : ['The server could not approve this revision. Check your connection and try again; nothing was changed.']
}

const timeRange = (pattern: OverlappingPatternDto) => `${formatShiftTime(pattern.startTime)}–${formatShiftTime(pattern.endTime)}${pattern.endsNextDay ? ' +1' : ''}`

type ApprovalDialogProps = {
  open: boolean
  participantId: string
  /** The revision to approve (the newest, with its blocks): its version, dates and block numbers are said in the dialog. */
  draft: ServiceAgreementDraftDto
  onClose: () => void
  /** The server approved it: the page has been told to read the revisions again. */
  onApproved: () => void
  /** A reason is about a block: take the person to it, at the step that fixes it. The dialog closes. */
  onGoToBlock?: (blockId: string, step: PlanStepKey) => void
}

/**
 * The confirm screen of "Mark approved". It is built from the server's preview (nothing is done until Approve is pressed): when the revision can be approved it says plainly what approval does, the
 * patterns it makes and the unfilled shifts it generates up to when (and that more are added each day until the agreement ends), the patterns of the revision before it that end the day before this
 * one starts, the old version's shifts that stay on the roster (with a link to them, in a new tab so the person can look and come back), the hand-made patterns that overlap (which are never changed, and
 * need a box ticked), and that an approval cannot be undone; when it cannot be approved, it lists every reason, each with the block it is about and what to do. It does not sign anything. While the
 * approval is on its way nothing closes it: the request has been sent, and Cancel would only hide a dialog the approval goes on behind.
 */
export function ApprovalDialog({ open, participantId, draft, onClose, onApproved, onGoToBlock }: ApprovalDialogProps) {
  const preview = useApprovalPreview(participantId, draft.id, open)
  const approve = useApproveServiceAgreementDraft()
  const [acknowledged, setAcknowledged] = useState(false)
  const [failure, setFailure] = useState<string[] | null>(null)
  // A dialog that is opened again starts clean: the box is unticked and the last refusal is not there.
  const [seenOpen, setSeenOpen] = useState(open)
  if (seenOpen !== open) {
    setSeenOpen(open)
    if (!open) { setAcknowledged(false); setFailure(null) }
  }

  const data = preview.data
  const blocks = draft.blocks.map(entry => entry.block)
  const needsAcknowledgement = (data?.overlappingPatterns.length ?? 0) > 0
  const pending = approve.isPending
  // Everything that would close it (the cross, Escape, the backdrop, Cancel) is held while the approval is on its way.
  const close = () => { if (!pending) onClose() }

  const submit = () => {
    setFailure(null)
    approve.mutate({ participantId, draftId: draft.id, acknowledgeOverlaps: needsAcknowledgement && acknowledged }, {
      onSuccess: () => onApproved(),
      onError: error => setFailure(failureMessages(error)),
    })
  }

  const cancel = <Button variant="secondary" onClick={close} disabled={pending}>Cancel</Button>
  const blocked = !!data && !data.canApprove
  const title = blocked ? 'Not ready to approve' : `Approve version ${draft.version} for rostering?`
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
        {preview.isLoading && <PageState kind="loading" noun="approval summary" />}
        {preview.isError && !data && (httpStatusOf(preview.error) === 403
          ? <Callout tone="warning">{failureMessages(preview.error)[0]}</Callout>
          : <PageState kind="error" noun="approval summary" onRetry={() => { void preview.refetch() }} />)}
        {data && (blocked
          ? <Reasons reasons={data.reasons} blocks={blocks} onGoToBlock={onGoToBlock ? (blockId, step) => { onGoToBlock(blockId, step); onClose() } : undefined} />
          : <WhatItDoes participantId={participantId} draft={draft} preview={data} acknowledged={acknowledged} onAcknowledge={setAcknowledged} />)}
        {failure && (
          <Callout tone="danger" title="Not approved">
            <ul className="list-disc pl-5">{failure.map(message => <li key={message}>{friendlyMessage(message, blocks)}</li>)}</ul>
          </Callout>
        )}
      </div>
    </Modal>
  )
}

/** Everything an approval does, in the order a coordinator weighs it: what is made, what ends, what stays, what overlaps, and that it cannot be undone. */
function WhatItDoes({ participantId, draft, preview, acknowledged, onAcknowledge }: { participantId: string; draft: ServiceAgreementDraftDto; preview: DraftApprovalPreviewDto; acknowledged: boolean; onAcknowledge: (value: boolean) => void }) {
  const start = formatServiceDate(draft.agreementStartDate)
  const patterns = plural(preview.patternsToCreate, 'weekly pattern')
  const range = `${start} to ${formatServiceDate(draft.agreementEndDate)}`
  // The shifts are made to the horizon the server gives (the organisation's setting, never a number said here); when the agreement ends before it, everything is made now and nothing is added later.
  const keepsGoing = !!preview.horizonEnd && preview.horizonEnd < draft.agreementEndDate
  const makes = preview.shiftsToCreate > 0 && preview.horizonEnd
    ? `Creates ${patterns}, ${range}, and ${plural(preview.shiftsToCreate, 'unfilled shift')} up to ${formatServiceDate(preview.horizonEnd)}.${keepsGoing ? ' After that, unfilled shifts are added each day until the agreement ends.' : ''}`
    : `Creates ${patterns}, ${range}.`
  const ends = preview.patternsToEnd > 0 && preview.endsFromVersion !== undefined
    ? ` Ends ${plural(preview.patternsToEnd, 'pattern')} from version ${preview.endsFromVersion} the day before ${start}.`
    : ''
  const old = preview.oldShiftsRemaining
  const oldCount = old.open + old.assigned
  const oneOld = oldCount === 1
  const overlaps = preview.overlappingPatterns
  const manyOverlaps = overlaps.length > 1

  return (
    <>
      <p className="text-[var(--color-muted-foreground)]">Puts this version&apos;s weekly patterns on the roster. It is separate from signing: nothing is signed or sent.</p>
      <p className="font-medium">{`${makes}${ends}`}</p>
      {preview.shiftsToCreate === 0 && (preview.shiftsNote
        ? <p>{preview.shiftsNote}</p>
        : <p>{"No unfilled shifts yet. They are added each day as the agreement's dates come near."}</p>)}
      {oldCount > 0 && old.firstDate && (
        <p>
          {old.open} unfilled and {old.assigned} assigned {oneOld ? 'shift' : 'shifts'}{old.fromVersion !== undefined ? ` from version ${old.fromVersion}` : ''}, from {formatServiceDate(old.firstDate)} on, {oneOld ? 'stays' : 'stay'} on the roster. The new version&apos;s unfilled shifts will sit beside {oneOld ? 'it' : 'them'} at the same times.{' '}
          {/* A new tab: the person can look at the roster and come back to approve, instead of losing the dialog and its preview. */}
          <Link className="font-medium underline" to={rosterLink(old.firstDate, participantId)} target="_blank" rel="noopener noreferrer">
            {oneOld ? 'See it on the roster' : 'See them on the roster'}<span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </p>
      )}
      {overlaps.length > 0 && (
        <section aria-labelledby="overlap-heading" className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)]">
          <h4 id="overlap-heading" className="font-semibold">{`${plural(overlaps.length, 'hand-made pattern')} ${manyOverlaps ? 'overlap' : 'overlaps'}`}</h4>
          <p className="text-[var(--color-muted-foreground)]">{manyOverlaps
            ? 'They are not ended or changed. The new patterns are made beside them, so the roster will ask for both until you decide.'
            : 'It is not ended or changed. The new patterns are made beside it, so the roster will ask for both until you decide.'}</p>
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

/** Every reason it cannot be approved yet, in the screen's own block numbers, with what to do about it and the way to the block it is about. */
function Reasons({ reasons, blocks, onGoToBlock }: { reasons: ApprovalReasonDto[]; blocks: readonly PlanBlock[]; onGoToBlock?: (blockId: string, step: PlanStepKey) => void }) {
  // A newer revision is not something to fix: the sentence says to approve that one instead, and the preface would say the opposite.
  const lone = reasons.length === 1 && reasons[0].code === 'Superseded'
  return (
    <>
      {!lone && <p>Nothing has been changed. Fix each item, then approve the version you save.</p>}
      <ul className="flex flex-col gap-3">
        {reasons.map(reason => {
          const own = OWN_REASONS[reason.code] !== undefined
          const where = !own && (reason.count ?? 0) > 1 ? ` (${plural(reason.count!, 'shift')}${reason.firstDate ? `, from ${formatServiceDate(reason.firstDate)}` : ''})` : ''
          const place = reason.blockId ? blocks.findIndex(block => block.id === reason.blockId) + 1 : 0
          const advice = reasonAdvice(reason.code)
          return (
            // On a phone the way to the block goes under the sentence, so the sentence keeps the whole width.
            <li key={`${reason.code}-${reason.blockId ?? ''}-${reason.message}`} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <StatusBadge tone={reasonIsHard(reason.code) ? 'danger' : 'warning'} label={reasonIsHard(reason.code) ? 'Fix' : 'Review'} />
                <span className="min-w-0 flex-1">
                  {own ? '' : `${reasonTitle(reason.code)}: `}{friendlyMessage(reason.message, blocks)}{where}
                  {advice && <span className="mt-0.5 block text-[13px] text-[var(--color-muted-foreground)]">{advice}</span>}
                </span>
              </div>
              {onGoToBlock && reason.blockId && place > 0 && (
                <Button className="self-start" variant="secondary" size="sm" onClick={() => onGoToBlock(reason.blockId!, reasonStep(reason.code))}>Go to block {place}</Button>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
