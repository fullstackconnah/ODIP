import { Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AgreementApproveResult } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Modal } from '@/components/Modal'
import { StatusBadge } from '@/components/StatusBadge'
import { plural } from '@/lib/format'
import { NO_REPLY_LAST, OUTCOME_BADGE, groupResults, resultHeading } from './outcomeWords'

export type ApprovePhase = 'confirm' | 'running' | 'result'

/** `noReply`: the failed request got no answer at all, so some of its items may have been approved. */
export interface ApproveStopped { done: number; total: number; notSent: number; noReply: boolean }

interface Props {
  open: boolean
  phase: ApprovePhase
  /** Agreements that will be sent, and ticked rows with no draft (left as they are). */
  count: number
  skipped: number
  /** Running: how many answers are in. */
  progress: number
  /** Confirm: a refused request (429, 403...) in words; the dialog stays open. */
  error: string | null
  results: AgreementApproveResult[]
  stopped: ApproveStopped | null
  onConfirm: () => void
  onClose: () => void
}

/** Confirm, run and report for the bulk Approve. While requests are in flight nothing closes it (no X, Escape and the backdrop do nothing) so the person cannot lose the answers. */
export function ApproveAgreementsDialog({ open, phase, count, skipped, progress, error, results, stopped, onConfirm, onClose }: Props) {
  const running = phase === 'running'
  const listed = groupResults(results)
  const heading = resultHeading(results, stopped?.total ?? results.length)
  const title = phase === 'result' ? heading.title : `Approve ${plural(count, 'agreement')}?`
  return (
    <Modal
      open={open}
      onClose={running ? () => {} : onClose}
      closeOnBackdrop={!running}
      hideClose={running}
      title={title}
      size="md"
      footer={phase === 'confirm' ? (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onConfirm}>{`Approve ${count}`}</Button>
        </>
      ) : (
        <Button onClick={onClose} disabled={running} aria-disabled={running}>{running ? 'Approving...' : 'Done'}</Button>
      )}
    >
      {phase === 'confirm' && (
        <div className="space-y-3 text-sm text-[var(--color-muted-foreground)]">
          <p>
            Each one is checked again as it is approved, and the roster is made from it.
            {skipped > 0 && ` ${plural(skipped, 'ticked row')} ${skipped === 1 ? 'has' : 'have'} no draft and ${skipped === 1 ? 'is' : 'are'} left as ${skipped === 1 ? 'it is' : 'they are'}.`}
          </p>
          {error && <Callout tone="danger">{error}</Callout>}
        </div>
      )}
      {running && (
        <div role="status" className="flex items-start gap-3 text-sm">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[var(--color-primary)]" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">{`Approving ${plural(count, 'agreement')}...`}</p>
            <p className="text-[var(--color-muted-foreground)]">Each one is checked and approved in turn, so this can take up to a minute. Keep this page open.</p>
            {count > 25 && <p className="tabular-nums text-[var(--color-muted-foreground)]">{`Approving... ${progress} of ${count} done`}</p>}
          </div>
        </div>
      )}
      {phase === 'result' && (
        <div className="space-y-3 text-sm">
          {stopped && (
            <Callout tone="warning">
              {stopped.noReply
                ? `Stopped after ${stopped.done} of ${stopped.total}. ${NO_REPLY_LAST(stopped.notSent)} Refresh to check before trying again.`
                : `Stopped after ${stopped.done} of ${stopped.total}. The first ${stopped.done} are listed below. The other ${stopped.notSent} weren't started, so select them and try again.`}
            </Callout>
          )}
          {heading.line && <p className={heading.danger ? 'text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}>{heading.line}</p>}
          {listed.length > 0 ? (
            <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)]">
              {listed.map(r => {
                const badge = OUTCOME_BADGE[r.outcome]
                return (
                  <li key={r.draftId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                    <span className="min-w-0 break-words font-medium">{r.participantName || 'Unknown participant'}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={badge.tone} label={badge.label} />
                      {r.outcome === 'NeedsReview' && (
                        <Link className="text-[var(--color-primary)] underline underline-offset-2" to={`/participants/${r.participantId}/agreement-draft`}>Open it</Link>
                      )}
                    </span>
                    {r.reasons[0] && r.outcome !== 'Failed' && <span className="basis-full text-[var(--color-muted-foreground)]">{r.reasons[0]}</span>}
                  </li>
                )
              })}
            </ul>
          ) : (
            !stopped && <p className="text-[var(--color-muted-foreground)]">All of them were approved and the roster is made.</p>
          )}
        </div>
      )}
    </Modal>
  )
}
