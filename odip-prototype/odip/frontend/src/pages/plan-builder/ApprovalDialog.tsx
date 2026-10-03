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
 * each of these is complete (it names the block, how many and from when), so the dialog shows it as it is, with no title that would say it again; an engine reason keeps its title, and how many shifts.
 */
const OWN_REASONS: Record<string, { hard: boolean; step?: PlanStepKey }> = {
  HolidayUndecided: { hard: false, step: 'review' },
  ReviewFlag: { hard: false, step: 'review' },
  HandTyped: { hard: true },
  BlockUnreadable: { hard: true },
  BlockInvalid: { hard: true, step: 'times' },
  AgreementEnded: { hard: true },
  TimeZoneMismatch: { hard: true },
  TooManyPatterns: { hard: true },
  Superseded: { hard: true },
  AlreadyApproved: { hard: true },
}

const reasonTitle = (code: string) => REASON_COPY[code as keyof typeof REASON_COPY]?.title ?? 'Needs a look'
const reasonStep = (code: string): PlanStepKey => REASON_COPY[code as keyof typeof REASON_COPY]?.step ?? OWN_REASONS[code]?.step ?? 'review'
const reasonIsHard = (code: string) => OWN_REASONS[code]?.hard ?? isRefusal(code as keyof typeof REASON_COPY)

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
  /** The revision to approve (the newest, with its blocks): its dates and block numbers are said in the dialog. */
  draft: ServiceAgreementDraftDto
  onClose: () => void
  /** The server approved it: the page has been told to read the revisions again. */
  onApproved: () => void
  /** A reason is about a block: take the person to it, at the step that fixes it. The dialog closes. */
  onGoToBlock?: (blockId: string, step: PlanStepKey) => void
}

/**
 * The confirm screen of "Mark approved". It is built from the server's preview (nothing is done until Approve is pressed): when the revision can be approved it says plainly what approval does, the
 * patterns it makes and the open shifts it generates up to when, the patterns of the revision before it that end the day before this one starts, the old version's shifts that stay on the roster (with a
 * link to them), and the hand-made patterns that overlap (which are never changed, and need a box ticked); when it cannot, it lists every reason, each with the block it is about. It does not sign anything.
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

  const submit = () => {
    setFailure(null)
    approve.mutate({ participantId, draftId: draft.id, acknowledgeOverlaps: needsAcknowledgement && acknowledged }, {
      onSuccess: () => onApproved(),
      onError: error => setFailure(failureMessages(error)),
    })
  }

  const cancel = <Button variant="secondary" onClick={onClose}>Cancel</Button>
  const blocked = !!data && !data.canApprove
  const title = blocked ? 'Not ready to approve' : 'Approve for rostering?'
  const footer = !data ? cancel : blocked ? <Button variant="secondary" onClick={onClose}>Close</Button> : (
    <>
      {cancel}
      <Button onClick={submit} disabled={approve.isPending || (needsAcknowledgement && !acknowledged)}>
        {approve.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{approve.isPending ? 'Approving…' : 'Approve'}
      </Button>
    </>
  )

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" footer={footer}>
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
            <ul className="list-disc pl-5">{failure.map(message => <li key={message}>{message}</li>)}</ul>
          </Callout>
        )}
      </div>
    </Modal>
  )
}

/** Everything an approval does, in the order a coordinator weighs it: what is made, what ends, what stays, and what overlaps. */
function WhatItDoes({ participantId, draft, preview, acknowledged, onAcknowledge }: { participantId: string; draft: ServiceAgreementDraftDto; preview: DraftApprovalPreviewDto; acknowledged: boolean; onAcknowledge: (value: boolean) => void }) {
  const start = formatServiceDate(draft.agreementStartDate)
  const makes = preview.shiftsToCreate > 0 && preview.horizonEnd
    ? `Creates ${plural(preview.patternsToCreate, 'weekly pattern')} and the open shifts up to ${formatServiceDate(preview.horizonEnd)}.`
    : `Creates ${plural(preview.patternsToCreate, 'weekly pattern')}.`
  const ends = preview.patternsToEnd > 0 && preview.endsFromVersion !== undefined
    ? ` Ends ${plural(preview.patternsToEnd, 'pattern')} from version ${preview.endsFromVersion} the day before ${start}.`
    : ''
  const old = preview.oldShiftsRemaining
  const oldCount = old.open + old.assigned

  return (
    <>
      <p className="text-[var(--color-muted-foreground)]">Approving makes this revision&apos;s weekly patterns on the roster. It is separate from signing: nothing is signed or sent.</p>
      <p className="font-medium">{`${makes}${ends}`}</p>
      {preview.shiftsToCreate === 0 && (preview.shiftsNote
        ? <p>{preview.shiftsNote}</p>
        : <p>No open shifts yet: they are made each day as the dates come within eight weeks.</p>)}
      {oldCount > 0 && old.firstDate && (
        <p>
          {old.open} open and {old.assigned} assigned {oldCount === 1 ? 'shift' : 'shifts'}{old.fromVersion !== undefined ? ` from version ${old.fromVersion}` : ''} on or after {start} stay on the roster.{' '}
          <Link className="font-medium underline" to={rosterLink(old.firstDate, participantId)}>Review them</Link>.
        </p>
      )}
      {preview.overlappingPatterns.length > 0 && (
        <section aria-labelledby="overlap-heading" className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)]">
          <h4 id="overlap-heading" className="font-semibold">{`${plural(preview.overlappingPatterns.length, 'hand-made pattern')} ${preview.overlappingPatterns.length === 1 ? 'overlaps' : 'overlap'}`}</h4>
          <p className="text-[var(--color-muted-foreground)]">They are not ended or changed. The new patterns are made beside them, so the roster will ask for both until you decide.</p>
          <ul className="flex flex-col gap-1">
            {preview.overlappingPatterns.map(pattern => (
              <li key={pattern.id} className="flex flex-col">
                <span>{pattern.dayOfWeek.slice(0, 3)} {timeRange(pattern)} · from {formatServiceDate(pattern.effectiveFrom)}{pattern.effectiveTo ? ` to ${formatServiceDate(pattern.effectiveTo)}` : ' onwards'}</span>
                {pattern.notes && <span className="text-[13px] text-[var(--color-muted-foreground)]">{pattern.notes}</span>}
              </li>
            ))}
          </ul>
          <CheckboxField label="These hand-made patterns stay as they are. I have checked them." checked={acknowledged} onChange={event => onAcknowledge(event.target.checked)} />
        </section>
      )}
    </>
  )
}

/** Every reason it cannot be approved yet, in the screen's own block numbers, with the way to the block it is about. */
function Reasons({ reasons, blocks, onGoToBlock }: { reasons: ApprovalReasonDto[]; blocks: readonly PlanBlock[]; onGoToBlock?: (blockId: string, step: PlanStepKey) => void }) {
  return (
    <>
      <p>Fix these, save a new revision and approve that one. Nothing has been changed.</p>
      <ul className="flex flex-col gap-2">
        {reasons.map(reason => {
          const own = OWN_REASONS[reason.code] !== undefined
          const where = !own && (reason.count ?? 0) > 1 ? ` (${plural(reason.count!, 'shift')}${reason.firstDate ? `, from ${formatServiceDate(reason.firstDate)}` : ''})` : ''
          const place = reason.blockId ? blocks.findIndex(block => block.id === reason.blockId) + 1 : 0
          return (
            <li key={`${reason.code}-${reason.blockId ?? ''}-${reason.message}`} className="flex flex-wrap items-start gap-2">
              <StatusBadge tone={reasonIsHard(reason.code) ? 'danger' : 'warning'} label={reasonIsHard(reason.code) ? 'Fix' : 'Review'} />
              <span className="min-w-0 flex-1">{own ? '' : `${reasonTitle(reason.code)}: `}{friendlyMessage(reason.message, blocks)}{where}</span>
              {onGoToBlock && reason.blockId && place > 0 && (
                <Button variant="secondary" size="sm" onClick={() => onGoToBlock(reason.blockId!, reasonStep(reason.code))}>Go to block {place}</Button>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
