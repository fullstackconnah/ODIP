import type { PlanBlock, PlanIssue, PlanNotice, PlannedLineFlags } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { StatusBadge } from '@/components/StatusBadge'
import { PLAN_STEPS } from '@/lib/planBlocks'
import { REASON_COPY, formatServiceDate, friendlyMessage, parseFlags } from '@/lib/planQuote'
import { plural } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import type { PlanStepKey } from '@/lib/planBlocks'

const NOTICE_TITLE: Record<string, { title: string; tone: 'warning' | 'info' }> = {
  'registration-groups-not-confirmed': { title: 'Registration groups are not confirmed', tone: 'warning' },
  'holiday-calendar-missing': { title: 'The public holiday calendar has gaps', tone: 'warning' },
  'holiday-overrides-end': { title: 'Part-day holidays may be missing', tone: 'info' },
}

/**
 * What applies to the whole plan rather than to one line, in the engine's own words: the registration groups nobody has confirmed (with the way to confirm them), and the
 * stretches of the agreement the holiday calendar cannot be trusted for. Never blocks anything.
 */
export function PlanNotices({ notices }: { notices: readonly PlanNotice[] }) {
  const { isAdmin, isSuperAdmin } = usePermissions()
  if (notices.length === 0) return null
  const loud = notices.filter(notice => (NOTICE_TITLE[notice.code]?.tone ?? 'info') === 'warning')
  const quiet = notices.filter(notice => (NOTICE_TITLE[notice.code]?.tone ?? 'info') !== 'warning')
  return (
    <div className="flex flex-col gap-2">
      {loud.map(notice => {
        const copy = NOTICE_TITLE[notice.code]
        const confirm = notice.code === 'registration-groups-not-confirmed'
        return (
          <Callout key={notice.code} tone="warning" title={copy.title}>
            {notice.message}
            {confirm && !(isAdmin || isSuperAdmin) && <> An Admin can confirm them in Settings, under Plan pricing.</>}
            {confirm && (isAdmin || isSuperAdmin) && <span className="mt-2 block"><Button variant="secondary" size="sm" to="/settings?tab=pricing">Confirm in Settings</Button></span>}
          </Callout>
        )
      })}
      {quiet.length > 0 && (
        <details className="text-sm text-[var(--color-muted-foreground)]">
          <summary className="cursor-pointer select-none">{quiet.map(notice => (NOTICE_TITLE[notice.code]?.title ?? 'Check this before you rely on the prices')).join('; ')}</summary>
          <ul className="mt-1 flex flex-col gap-1">{quiet.map(notice => <li key={notice.code}>{notice.message}</li>)}</ul>
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

/** Each thing a person has to look at, as a plain sentence next to what to do about it. A refusal is an error (nothing is priced from the block); the rest are warnings. */
export function IssueList({ issues, blocks, onFix }: IssueListProps) {
  if (issues.length === 0) return null
  return (
    <ul className="flex flex-col gap-2" aria-label="Things to look at">
      {issues.map(issue => {
        const copy = REASON_COPY[issue.reason]
        const step = copy?.step
        const where = issue.count > 1 ? `${plural(issue.count, 'shift')}${issue.firstDate ? `, the first on ${formatServiceDate(issue.firstDate)}` : ''}` : issue.firstDate ? formatServiceDate(issue.firstDate) : ''
        return (
          <li key={`${issue.blockId}-${issue.reason}-${issue.message}`}>
            <Callout tone={copy?.refusal ? 'error' : 'warning'} title={copy?.title ?? 'Needs a look'}
              actions={onFix && step && issue.blockId ? <Button variant="secondary" size="sm" onClick={() => onFix(issue.blockId, step)}>Go to {PLAN_STEPS.find(candidate => candidate.key === step)?.label ?? 'the step'}</Button> : undefined}>
              <span className="block">{friendlyMessage(issue.message, blocks)}{where && <span className="text-[var(--color-muted-foreground)]">{' '}({where})</span>}</span>
              {copy && <span className="mt-1 block">{copy.advice}</span>}
            </Callout>
          </li>
        )
      })}
    </ul>
  )
}

/** The flags on a line, always in words: a line that needs a decision, one priced at a public holiday rate, one that rests on a reading nobody has confirmed. */
export function FlagBadges({ flags, unpriced }: { flags: PlannedLineFlags; unpriced?: boolean }) {
  const parsed = parseFlags(flags)
  if (!parsed.review && !parsed.holidayExposure && !parsed.provisional && !unpriced) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {unpriced && <StatusBadge tone="danger" label="Not priced" />}
      {parsed.review && <StatusBadge tone="warning" label="Review" />}
      {parsed.holidayExposure && <StatusBadge tone="info" label="Holiday rate" />}
      {parsed.provisional && <StatusBadge tone="info" label="Provisional" />}
    </span>
  )
}
