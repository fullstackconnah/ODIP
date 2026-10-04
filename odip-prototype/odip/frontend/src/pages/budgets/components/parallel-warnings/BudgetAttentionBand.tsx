import { AlertTriangle, CircleCheck, RefreshCw } from 'lucide-react'
import { Button } from '@/components/Button'
import { TONE } from '@/lib/tone'
import { joinList, plural } from '@/lib/format'
import {
  BUDGET_RISK_LEVELS,
  BUDGET_RISK_STATUS,
  type BudgetAttentionAction,
  type BudgetAttentionBandView,
  type BudgetRiskLevel,
} from './viewModel'

// The quiet budget band: one line that says how many participant budgets need somebody, and the one place to go and act on them. It is deliberately NOT a dashboard
// attention tile and it is deliberately quiet: it is the same tone words, on the card, at 13px.
//
// Four states, and none of them is allowed to borrow another's clothes (DESIGN.md, "never an all-clear without the data"):
//   loading  the figures are still coming. An en dash where the count would be, never a 0 and never an all-clear.
//   failed   the figures could not be read. Said in as many words, with a Try again when the caller supplies one. A failure is NOT health.
//   ready>0  the counts, in the tones the owner named: danger if anything is over, otherwise warning.
//   ready=0  one honest no-risk sentence, and only because the counts are real zeros.
import {
  BUDGET_RISK_LABELS,
  noRiskLine,
  overNote,
} from './wording'

const TONE_FOR_LEVEL: Record<BudgetRiskLevel, string> = {
  Over: TONE.danger.solid,
  ForecastOver: TONE.warning.solid,
  Approaching: TONE.warning.solid,
}

/** One region name for all four states, so a caller (or a test, or a screen reader) finds the band wherever it is in its lifecycle. */
const REGION = 'Budgets needing attention'
/** The quiet form: the card the band sits on. A tinted band replaces the border and background with its tone. */
const BAND = 'rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)]'

/** How a figure-less band says it: an en dash where a count would be, and the words that a screen reader hears in place of the number. */
function UnknownFigure({ label }: { label: 'loading' | 'failed' }) {
  return (
    <span
      aria-busy={label === 'loading' || undefined}
      className="text-xl font-display font-bold text-[var(--color-muted-foreground)] tabular-nums"
    >
      <span aria-hidden="true">–</span>
      <span className="sr-only">{label === 'loading' ? 'Loading' : "Couldn't load"}</span>
    </span>
  )
}

/** The band's one action, as a link when the destination is a route and a button when it is a callback. Navigation stays the caller's. */
function ActionButton({ action }: { action: BudgetAttentionAction }) {
  if ('to' in action) return <Button size="sm" to={action.to}>{action.label}</Button>
  return <Button size="sm" onClick={action.onSelect}>{action.label}</Button>
}

/** "updating…", in the muted ink, when a newer answer is on its way and the last one is still shown. */
function Refreshing() {
  return (
    <span className="inline-flex items-center gap-1 text-[13px]">
      <RefreshCw className="h-3 w-3" aria-hidden="true" />
      updating…
    </span>
  )
}

export function BudgetAttentionBand({ view }: { view: BudgetAttentionBandView }) {
  const label = view.label ?? 'Budgets at risk'
  const busy = view.refreshing === true || view.loading === true

  // No data behind the sentence: neither an all-clear nor a count. The band's own words say which, so a screen-reader user is not told
  // "0" by a dash they cannot see.
  if (view.loading === true || view.failed === true) {
    const failed = view.failed === true
    return (
      <section
        aria-label={REGION}
        aria-busy={busy || undefined}
        className={BAND}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm font-semibold">{label}</p>
          <UnknownFigure label={failed ? 'failed' : 'loading'} />
          <p className="min-w-0 flex-1 text-[13px] text-[var(--color-muted-foreground)]">
            {failed
              ? view.failureMessage ?? `These figures could not be read, so nothing is being claimed about them.`
              : 'Checking the participant budgets…'}
          </p>
        </div>
      </section>
    )
  }

  const counts = view.counts
  // A caller that reached a ready state without counts has no answer. That is not zero, so it takes the failed branch's wording.
  if (!counts) {
    return (
      <section aria-label={REGION} className={BAND}>
        <p className="text-[13px] text-[var(--color-muted-foreground)]">These figures have not arrived yet, so nothing is being claimed about them.</p>
      </section>
    )
  }

  const present = BUDGET_RISK_LEVELS.filter(level => counts[level] > 0)
  const total = BUDGET_RISK_LEVELS.reduce((sum, level) => sum + (counts[level] ?? 0), 0)
  const over = (counts.Over ?? 0) > 0

  if (total === 0) {
    return (
      <section aria-label={REGION} aria-busy={busy || undefined} className={`${BAND} border-[var(--color-primary)]/30`}>
        <div className="flex flex-wrap items-center gap-2">
          <CircleCheck className="h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
          <p className="text-sm font-semibold">No participant budget needs attention.</p>
          {view.action && <ActionButton action={view.action} />}
        </div>
        <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
          {noRiskLine}
          {busy && <span className="ml-1 inline-flex items-center gap-1"><Refreshing /></span>}
        </p>
      </section>
    )
  }

  return (
    <section
      aria-label={REGION}
      aria-busy={busy || undefined}
      className={`rounded-[var(--radius-md)] border border-transparent p-[var(--card-pad)] ${over ? TONE.danger.solid : TONE.warning.solid}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xl font-display font-bold tabular-nums">{plural(total, 'participant')}</p>
        {busy && <Refreshing />}
        {view.action && <ActionButton action={view.action} />}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-2">
        {present.map(level => (
          <li key={level} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_FOR_LEVEL[level]}`}>
            {BUDGET_RISK_STATUS[level].label}: {counts[level]}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[13px]">
        {joinList(present.map(level => `${counts[level]} ${BUDGET_RISK_LABELS[level]}`))}
        {/* F-18: the band takes no icon and no chip, so its words are the only cue. The base matters as much as the two halves —
            "5 participants" alone reads as 5 of everyone. `denominator` counts participants with a RECORDED budget, so a missing
            budget is never presented as a risk. When the server has not said, the base is simply left off rather than invented. */}
        {view.denominator != null && `, of ${plural(view.denominator, 'participant')} with a recorded budget`}. A participant is counted
        once, in its worst state.
      </p>
      {over && (
        <p className="mt-1 flex items-start gap-1 text-[13px] font-medium">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{overNote}</span>
        </p>
      )}
    </section>
  )
}
