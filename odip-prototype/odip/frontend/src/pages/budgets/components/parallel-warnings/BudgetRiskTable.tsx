import { useId } from 'react'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { CellText, DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { TONE } from '@/lib/tone'
import { writtenSpan } from '@/lib/fundingPlan'
import { BUDGET_RISK_ORDER, BUDGET_RISK_STATUS, type BudgetAttentionAction, type BudgetRiskRow, type BudgetRiskTableState } from './viewModel'
import { BudgetFigure } from './BudgetFigure'
import { NO_FIGURE, configuredZero, noBudgetHiddenLabel, unavailableFigure } from './wording'

// The Budgets list's body: one row per participant and pool for the current funding period, in the DataTable idiom, with the server's own
// status and figures and nothing of its own invented.
//
// What this component deliberately does NOT do:
//   - it does not sort by risk. The order is the server's (it holds the buckets, the "no budget recorded" tail and the search); a client sort
//     would need to know the server's ranking rule, and SHAPE-BRIEF §5 says a participant with no budget never warns.
//   - it does not add any two figures, and it does not derive a status from them. `status` is the server's word.
//   - it does not treat a null as a zero, or a zero as missing.
//   - it does not show an amount to a viewer the privacy contract withheld it from, in the cell, in `title`, in `aria`, or in any attribute.
//
// Six states are drawn apart, because they are six different facts: loading, failed, empty (there is nothing at all), a row with no budget
// recorded, a pool configured at zero, and a row whose figures are unknown or unquantifiable. A caller reaches this component with one of them.

/** A row's next action, as the table renders it: a link when the destination is a route, a button when it is a callback. */
function RowAction({ action, participantLabel }: { action: BudgetAttentionAction; participantLabel: string }) {
  const label = action.label
  // The accessible name carries WHO the action is for: a table of rows needs each link to say its own participant, not just "Open".
  const named = /open|view|go/i.test(label) ? `${label} ${participantLabel}` : label
  if ('to' in action) {
    return (
      <Button size="sm" variant="secondary" to={action.to} aria-label={named}>
        {label}
      </Button>
    )
  }
  return (
    <Button size="sm" variant="secondary" onClick={action.onSelect} aria-label={named}>
      {label}
    </Button>
  )
}

function columnsFor(): Column<BudgetRiskRow>[] {
  return [
    {
      key: 'participantLabel',
      header: 'Participant',
      minWidth: '11rem',
      maxWidth: '18rem',
      // The pinned start column is the one that says who the row is. It wraps rather than truncates: a name cut at its last syllable is
      // ambiguous, and DataTable's plain-string cap puts the full text in `title`, which a phone never shows.
      wrap: true,
      render: row => <CellText title={row.participantLabel}>{row.participantLabel}</CellText>,
    },
    {
      key: 'poolLabel',
      header: 'Pool',
      minWidth: '9rem',
      maxWidth: '14rem',
      wrap: true,
      render: row => <CellText title={row.poolLabel}>{row.poolLabel}</CellText>,
    },
    {
      key: 'period',
      header: 'Period',
      minWidth: '11rem',
      wrap: true,
      // A period is a range of two calendar days, written with the app's own range formatter: it never drops a year and never becomes "Sep" in
      // one ICU build and "Sept" in another.
      render: row => <CellText title={`${row.periodStart} to ${row.periodEnd}`}>{writtenSpan(row.periodStart, row.periodEnd)}</CellText>,
    },
    {
      key: 'status',
      header: 'Status',
      minWidth: '8rem',
      sortable: true,
      // F-15: without an explicit `sortFn`, `DataTable.defaultComparator` falls through to
      // `String(a).localeCompare(b)` and sorts the risk words ALPHABETICALLY — Approaching, ForecastOver,
      // OnTrack, Over — the exact reverse of the order the spec requires. The rank is declared once, in
      // BUDGET_RISK_ORDER, and this column is the only thing that reads it. Ties fall back to the
      // participant's name so a re-sort is stable rather than arbitrary.
      sortFn: (a, b) => {
        const rank = BUDGET_RISK_ORDER[a.status] - BUDGET_RISK_ORDER[b.status]
        return rank !== 0 ? rank : a.participantLabel.localeCompare(b.participantLabel, 'en-AU')
      },
      render: row => <StatusBadge tone={BUDGET_RISK_STATUS[row.status].tone} label={BUDGET_RISK_STATUS[row.status].label} />,
    },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      minWidth: '7.5rem',
      render: row => (
        <span className="max-md:text-left">
          <BudgetFigure
            figures={row.figures}
            amount={row.available}
            reason={row.unavailableReason ?? unavailableFigure()}
            // A configured zero is a real answer and says so, so nobody reads it as a missing figure.
            srNote={row.available === 0 && row.figures.visible ? configuredZero : undefined}
          />
        </span>
      ),
    },
    {
      key: 'used',
      header: 'Used',
      align: 'right',
      minWidth: '7.5rem',
      render: row => (
        <span className="max-md:text-left">
          <BudgetFigure figures={row.figures} amount={row.used} reason={row.unavailableReason ?? unavailableFigure()} />
        </span>
      ),
    },
    {
      key: 'bookedAhead',
      header: 'Booked ahead',
      align: 'right',
      minWidth: '8rem',
      render: row =>
        row.bookedAhead === undefined ? (
          <span className="text-[var(--color-muted-foreground)]" aria-hidden="true">{NO_FIGURE}</span>
        ) : (
          <span className="max-md:text-left">
            <BudgetFigure figures={row.figures} amount={row.bookedAhead} reason={row.unavailableReason ?? unavailableFigure()} />
          </span>
        ),
    },
    {
      key: 'forecast',
      header: 'Forecast',
      align: 'right',
      minWidth: '8rem',
      render: row => (
        <span className="max-md:text-left">
          <BudgetFigure figures={row.figures} amount={row.forecast} reason={row.unavailableReason ?? unavailableFigure()} />
          {/* The server's coarse estimate, only where there is no exact figure, and only when the server sent one. It is text, so it can
              never be read as the figure it stands in for. */}
          {row.forecast === null && row.figures.visible && row.estimate && (
            <span className="block text-xs text-[var(--color-muted-foreground)]">About {row.estimate}</span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: row => (row.action ? <RowAction action={row.action} participantLabel={row.participantLabel} /> : null),
    },
  ]
}

export function BudgetRiskTable({ state, caption }: { state: BudgetRiskTableState; caption?: string }) {
  const hiddenId = useId()

  if (state.status === 'loading') {
    // A distinct row, not an empty table and not a dash in a figure: while the request is in flight there is no answer to show.
    return (
      <div role="status" className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] text-[13px] text-[var(--color-muted-foreground)]">
        Loading the participant budgets…
      </div>
    )
  }

  if (state.status === 'failed') {
    // Never rendered as an empty list: an empty list would read as "nobody is at risk", which is the one thing a failure must not say.
    return (
      <Callout tone="danger" className="max-w-prose">
        {state.message ?? 'The participant budgets could not be read, so nothing is being claimed about them.'}
      </Callout>
    )
  }

  if (state.status === 'empty') {
    return (
      <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-[var(--card-pad)] py-6 text-center text-sm text-[var(--color-muted-foreground)]">
        No participant budgets are being tracked yet.
      </p>
    )
  }

  const hidden = state.hiddenNoBudgetCount ?? 0
  return (
    <div className="flex flex-col gap-2">
      {caption && <p className="text-[13px] text-[var(--color-muted-foreground)]">{caption}</p>}
      <DataTable
        data={state.rows}
        columns={columnsFor()}
        keyField="id"
        // F-15: sorting is opt-in twice over — `sortable` on the table AND `sortable` on the column. Without them there is no sort
        // affordance at all, and the `sortFn` below would be dead code. The Status column is the one that carries risk order.
        sortable
        emptyMessage="No participant budgets are being tracked yet."
        rowClassName={row => (row.status === 'Over' ? TONE.danger.soft : row.status === 'ForecastOver' ? TONE.warning.soft : '')}
      />
      {hidden > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-muted-foreground)]">
          <button
            type="button"
            aria-expanded={false}
            aria-controls={hiddenId}
            onClick={state.onShowNoBudget}
            className="inline-flex min-h-[var(--tap-min)] items-center gap-1 rounded-[var(--radius-sm)] px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            {noBudgetHiddenLabel(hidden)}
          </button>
          <span id={hiddenId}>
            <AlertTriangle className="h-3.5 w-3.5 align-text-bottom text-[var(--color-muted-foreground)]" aria-hidden="true" />
            {' '}A participant with no budget recorded is never warned about: there is no limit to be near.
          </span>
        </div>
      )}
    </div>
  )
}
