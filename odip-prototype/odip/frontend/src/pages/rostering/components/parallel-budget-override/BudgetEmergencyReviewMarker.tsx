import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateTimeAu } from '@/lib/format'
import {
  OVER_BUDGET_MARKER,
  emergencyReviewBadge,
  type EmergencyReviewDetails,
} from './budgetOverrideTypes'

export type BudgetEmergencyReviewMarkerProps = {
  /** What the server knows about the shift's over-budget path. Never inferred by this component. */
  details: EmergencyReviewDetails
  className?: string
}

const LABEL = 'text-[13px] text-[var(--color-muted-foreground)]'
const VALUE = 'text-sm text-[var(--color-foreground)]'

/**
 * A row of key/value facts, or null when there is nothing to put in it. A field the server never
 * sent is an OMITTED ROW, not a dashed one: a dash says "we looked and there was nothing here",
 * and a reviewer that was never assigned is not that — it is a fact nobody has recorded yet, and
 * saying so in words is what stops a pending review reading as a finished one.
 */
function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="contents">
      <dt className={LABEL}>{label}</dt>
      <dd className={`${VALUE} whitespace-pre-wrap break-words`}>{value}</dd>
    </div>
  )
}

/** A row that exists only to say a fact is not recorded. Used for the review, never for a fact. */
function MissingRow({ label, note }: { label: string; note: string }) {
  return (
    <div className="contents">
      <dt className={LABEL}>{label}</dt>
      <dd className={`${VALUE} text-[var(--color-muted-foreground)]`}>{note}</dd>
    </div>
  )
}

/**
 * The compact marker a shift saved over budget carries on the board chip and in the slide-over,
 * with the audit facts beside it.
 *
 * What it will not do:
 *  - **it never implies an approval.** The pending state says "Admin review pending" in the warning
 *    tone, because that is exactly the state: the emergency saved at once and a review follows
 *    (owner decision, shape round 3). There is no "approved" rendering, and a shift with no
 *    reviewer says "Not reviewed yet" rather than showing an invented reviewer or an empty row.
 *  - **it never renders money or a participant's reason to a restricted viewer.** SupportWorker and
 *    ReadOnly never see money (SHAPE-BRIEF §5); a restricted render is the marker word, the review
 *    state, and nothing else — no reason text, no reviewer's name.
 *  - **it is not a link.** The board chip's own click is what opens the shift; a link nested inside
 *    a clickable chip is a keyboard trap with a small target.
 *
 * The two states are told apart by their WORDS as well as their tone (DESIGN.md: status is
 * colour-plus-text, never colour alone), and "Reviewed" appears exactly once — on the badge — so a
 * reader is never left wondering whether the row beneath it means something different.
 */
export function BudgetEmergencyReviewMarker({ details, className }: BudgetEmergencyReviewMarkerProps) {
  const restricted = !!details.restricted
  const badge = emergencyReviewBadge(details.state)
  const isEmergency = details.kind === 'emergency'
  const marker = OVER_BUDGET_MARKER[details.kind]
  const reviewed = details.state === 'reviewed'

  // A restricted viewer sees that the shift went over budget and whether the review has happened.
  // Not the reason, not who reviewed it, not when the money ran out.
  const rows = restricted
    ? null
    : [
        <DetailRow key="recorded" label="Recorded" value={details.recordedAt ? formatDateTimeAu(details.recordedAt) : null} />,
        <DetailRow key="reason" label="Reason given" value={details.reason} />,
        reviewed
          ? <DetailRow key="reviewer" label="Reviewed by" value={details.reviewedBy} />
          : <MissingRow key="reviewer" label="Reviewed by" note="Not reviewed yet" />,
        reviewed
          ? <DetailRow key="reviewedAt" label="Review completed" value={details.reviewedAt ? formatDateTimeAu(details.reviewedAt) : null} />
          : null,
        <DetailRow key="task" label="Review task" value={details.reviewTaskTitle} />,
      ].filter(Boolean)

  return (
    <div
      data-budget-marker={details.kind}
      className={`flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 ${className ?? ''}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            isEmergency
              ? 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
              : 'bg-[var(--color-secondary-container)] text-[var(--color-info)]'
          }`}
        >
          {isEmergency ? (
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          )}
          {marker}
        </span>
        <StatusBadge tone={badge.tone} label={badge.label} />
      </div>

      {rows && rows.length > 0 && <dl className="grid grid-cols-[9rem_1fr] gap-x-3">{rows}</dl>}

      {/* The one sentence that is always true of a pending emergency, whichever fields are absent.
          Without it, a marker with no reviewer reads as "nobody needed to review this". */}
      {!reviewed && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Saved straight away. An Admin still has to review it — this has not been approved.
        </p>
      )}
    </div>
  )
}
