import { Link } from 'react-router-dom'
import type { PlanBlock, PlanIssue, PlanNotice, PlannedLineFlags } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { StatusBadge } from '@/components/StatusBadge'
import { PLAN_STEPS } from '@/lib/planBlocks'
import { REASON_COPY, friendlyMessage, groupIssues, issueWhere, parseFlags } from '@/lib/planQuote'
import { usePermissions } from '@/lib/permissions'
import type { PlanStepKey } from '@/lib/planBlocks'

const REGISTRATION_NOTICE = 'registration-groups-not-confirmed'

const NOTICE_TITLE: Record<string, { title: string; tone: 'warning' | 'info' }> = {
  'holiday-calendar-missing': { title: 'The public holiday calendar has gaps', tone: 'warning' },
  'holiday-overrides-end': { title: 'Part-day holidays may be missing', tone: 'info' },
}

type PlanNoticesProps = {
  notices: readonly PlanNotice[]
  /**
   * `overview`: the plan at a glance, which carries the registration notice as one quiet line. `review`: one block's lines, which leaves it out: it is a standing caveat of the whole plan
   * that only an Admin can act on, and said again at every step it would outshout the figures.
   */
  scope: 'overview' | 'review'
}

/**
 * What applies to the whole plan rather than to one line, in the engine's own words: the registration groups nobody has confirmed (a quiet line, with the way to confirm them), and the
 * stretches of the agreement the holiday calendar cannot be trusted for. Never blocks anything, and never interrupts: these are standing notices, so they are not announced again each
 * time the view they are in comes back.
 */
export function PlanNotices({ notices, scope }: PlanNoticesProps) {
  const { isAdmin, isSuperAdmin } = usePermissions()
  const registration = scope === 'overview' ? notices.find(notice => notice.code === REGISTRATION_NOTICE) : undefined
  const others = notices.filter(notice => notice.code !== REGISTRATION_NOTICE)
  if (!registration && others.length === 0) return null
  const loud = others.filter(notice => (NOTICE_TITLE[notice.code]?.tone ?? 'info') === 'warning')
  const quiet = others.filter(notice => (NOTICE_TITLE[notice.code]?.tone ?? 'info') !== 'warning')
  return (
    <div className="flex flex-col gap-2">
      {registration && (
        <p className="text-sm text-[var(--color-muted-foreground)]" title={registration.message}>
          Registration groups are not confirmed.{' '}
          {isAdmin || isSuperAdmin
            ? <Link to="/settings?tab=pricing" className="whitespace-nowrap font-medium text-[var(--color-primary)] underline underline-offset-2">Confirm in Settings</Link>
            : 'Ask an Admin to confirm them.'}
        </p>
      )}
      {loud.map(notice => (
        <Callout key={notice.code} tone="warning" announce={false} className="max-w-prose" title={NOTICE_TITLE[notice.code]?.title}>
          {friendlyMessage(notice.message, [])}
        </Callout>
      ))}
      {quiet.length > 0 && (
        <details className="text-sm text-[var(--color-muted-foreground)]">
          <summary className="cursor-pointer select-none">{quiet.map(notice => (NOTICE_TITLE[notice.code]?.title ?? 'Check this before you rely on the prices')).join('; ')}</summary>
          <ul className="mt-1 flex max-w-prose flex-col gap-1">{quiet.map(notice => <li key={notice.code}>{friendlyMessage(notice.message, [])}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

type IssueListProps = {
  issues: readonly PlanIssue[]
  /** The plan's blocks, so a message can say "Block 2" and not "b2". */
  blocks: readonly PlanBlock[]
  /** Jumps to the step where an issue is fixed (the stepper's own steps; the overview opens the stepper there). */
  onFix?: (blockId: string, step: PlanStepKey) => void
}

/**
 * Each thing a person has to look at, as a plain sentence next to what to do about it. A refusal is an error (nothing is priced from the block); the rest are warnings. The same
 * thing met on many dates is one entry with the number of shifts it touches.
 */
export function IssueList({ issues, blocks, onFix }: IssueListProps) {
  if (issues.length === 0) return null
  return (
    <ul className="flex flex-col gap-2" aria-label="Things to look at">
      {groupIssues(issues).map(issue => {
        const copy = REASON_COPY[issue.reason]
        const step = copy?.step
        const where = issueWhere(issue)
        return (
          <li key={`${issue.blockId}-${issue.reason}-${issue.message}`}>
            {/* The way to the step is under the text, not in the Callout's actions slot: beside the text it takes a third of a phone's width and the message wraps to twenty lines. */}
            {/* Not announced: Review is a step a person comes back to, and an assertive role on each issue says them all again at every visit (design D7); the list is on screen where they look. */}
            <Callout tone={copy?.refusal ? 'error' : 'warning'} announce={false} className="max-w-prose" title={copy?.title ?? 'Needs a look'}>
              <span className="block">{friendlyMessage(issue.message, blocks)}{where && <span className="text-[var(--color-muted-foreground)]">{' '}({where})</span>}</span>
              {copy && <span className="mt-1 block">{copy.advice}</span>}
              {onFix && step && issue.blockId && (
                <span className="mt-2 block"><Button variant="secondary" size="sm" onClick={() => onFix(issue.blockId, step)}>Go to {PLAN_STEPS.find(candidate => candidate.key === step)?.label ?? 'the step'}</Button></span>
              )}
            </Callout>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The flags on a line, always in words: a line that needs a decision, one priced at a public holiday rate, one that rests on a reading nobody has confirmed. A line with no price is
 * "Not priced" in the warning tone, the one the Callout that explains it wears: one tone for one fact.
 */
export function FlagBadges({ flags, unpriced }: { flags: PlannedLineFlags; unpriced?: boolean }) {
  const parsed = parseFlags(flags)
  if (!parsed.review && !parsed.holidayExposure && !parsed.provisional && !unpriced) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {unpriced && <StatusBadge tone="warning" label="Not priced" />}
      {parsed.review && <StatusBadge tone="warning" label="Review" />}
      {parsed.holidayExposure && <StatusBadge tone="info" label="Holiday rate" />}
      {parsed.provisional && <StatusBadge tone="info" label="Provisional" />}
    </span>
  )
}
