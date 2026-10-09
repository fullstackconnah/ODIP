import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronDown, ChevronRight, CornerDownRight } from 'lucide-react'
import { Button } from '@/components/Button'
import { CellText, DataTable, type Column } from '@/components/DataTable'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { TONE } from '@/lib/tone'
import { writtenDay, writtenSpan } from '@/lib/fundingPlan'
import { formatCurrency } from '@/lib/utils'
import { BUDGET_RISK_STATUS, budgetRiskRank, type BudgetAttentionAction, type BudgetRiskRow, type BudgetRiskTableState, type NoBudgetEntry } from './viewModel'
import { BudgetFigure } from './BudgetFigure'
import { NDIA_FUNDS_RAN_OUT, NOTHING_TRACKED, NO_FIGURE, ROLLED_OVER_LEGEND, UNPRICED_LEGEND, configuredZero, noBudgetHiddenLabel, noBudgetNote, rolledOverLabel, unavailableFigure, unpricedForecastLabel } from './wording'

// The Budgets list's body: one row per participant and pool for the current funding period, in the DataTable idiom, with the server's own status and figures and nothing of its own invented.
//
// What this component deliberately does NOT do:
//   - it does not sort by risk. The order is the server's (it holds the "no budget recorded" tail and the search); a client sort would need to know the server's ranking rule, and SHAPE-BRIEF §5
//     says a participant with no budget never warns. (The Status column's header does sort, on `budgetRiskRank`, when a person asks it to.)
//   - it does not add any two figures, and it does not derive a status from them. `status` is the server's word.
//   - it does not treat a null as a zero, or a zero as missing.
//   - it does not show an amount to a viewer the privacy contract withheld it from, in the cell, in `title`, in `aria`, or in any attribute.
//
// Six states are drawn apart, because they are six different facts: loading, failed, empty (there is nothing at all), a row with no budget recorded, a pool configured at zero, and a row whose
// figures are unknown. A caller reaches this component with one of them.

/** A row's next action, as the table renders it: a link when the destination is a route, a button when it is a callback. */
function RowAction({ action, participantLabel }: { action: BudgetAttentionAction; participantLabel: string }) {
  const label = action.label
  // The accessible name carries WHO the action is for: a table of rows needs each link to say its own participant, not just "Open funding tab".
  const named = `${label} for ${participantLabel}`
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

/**
 * The word for a status in its own filled tone, on a tinted row or not. The row tints are a weak wash (the step the Qualifications table uses), so a pill needs no lifting onto the card fill, and
 * Over, Forecast over and Approaching keep the colours that tell them apart.
 */
function RiskPill({ status }: { status: BudgetRiskRow['status'] }) {
  const { label, tone } = BUDGET_RISK_STATUS[status]
  return <StatusBadge tone={tone} label={label} />
}

/**
 * The Status cell: ODIP's own word; then, when the NDIA has refused a claim of this pool for want of funds, the NDIA's word in a danger pill beside it (ODIP's arithmetic can say On track while the
 * NDIA says the funds ran out, and a list that showed only the first would be silent about the case this feature exists to catch); then, in the Funding sentence's own words, how far over the
 * period already is or what is left. The server works that out and sends it: nothing here subtracts. A viewer who may not see money sees the words and no amount.
 */
function StatusCell({ row }: { row: BudgetRiskRow }) {
  const { remaining, ndiaWord } = row
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="flex flex-wrap items-center gap-1">
        <RiskPill status={row.status} />
        {ndiaWord && (
          // Two short lines, not one long one: the Status column is the one the table can least afford to widen, and Forecast must stay on screen at 1366 and 1440.
          <span title={`NDIA rejected a claim on ${writtenDay(ndiaWord.date)} (${ndiaWord.code})`} className="max-w-[6.5rem] whitespace-normal leading-tight">
            <StatusBadge tone="danger" label={NDIA_FUNDS_RAN_OUT} className="inline-block" />
          </span>
        )}
      </span>
      {row.figures.visible && remaining !== null && (
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {remaining < 0 ? <><BudgetFigure figures={row.figures} amount={-remaining} /> over</> : <><BudgetFigure figures={row.figures} amount={remaining} /> left</>}
        </span>
      )}
    </span>
  )
}

/**
 * Who the row is about. When the row has an action (here, the participant's Funding tab) the NAME is the link, named for what it does ("Open funding for Dylan Marchetti": the visible name is inside
 * its accessible name), so the row needs no column of buttons: that column, pinned to the edge by the DataTable's column rule, covered Forecast, the figure a person comes here for, at 1440px.
 * The truncation is on the link itself, not on a wrapper whose overflow would clip its focus ring.
 */
function ParticipantCell({ row }: { row: BudgetRiskRow }) {
  const { action } = row
  if (!action) return <CellText title={row.participantLabel} className="md:max-w-[16rem]">{row.participantLabel}</CellText>
  const named = `${action.label} for ${row.participantLabel}`
  const look = 'block font-medium text-[var(--color-primary)] hover:underline md:max-w-[16rem] md:truncate'
  if ('to' in action) return <Link to={action.to} aria-label={named} title={named} className={look}>{row.participantLabel}</Link>
  return <button type="button" onClick={action.onSelect} aria-label={named} title={named} className={`${look} text-left`}>{row.participantLabel}</button>
}

/**
 * The mark beside a forecast that leaves shifts out (the shift claim cannot price a sleepover, a passive night or a group shift yet, so each is $0 in every figure). An icon named in words for a screen
 * reader and a pointer; the line under the table says what it is for everybody else. It is the server's own count for the period, never worked out here.
 */
function UnpricedMark({ count }: { count: number }) {
  const words = unpricedForecastLabel(count)
  return (
    <span role="img" aria-label={words} title={words} className={`mr-1 inline-flex align-middle ${TONE.warning.ink}`}>
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  )
}

/**
 * The mark beside Available when part of it was rolled over from earlier periods (the server's figure), which the Funding tab labels "not confirmed": somebody else may have used it. An icon named in
 * words for a screen reader and a pointer, with the amount in the name; the line under the table says what it is for everybody else. It replaced a note under every such figure, which made those
 * rows two to three lines taller than the row token. Only ever drawn for a viewer who may see the figure, so it can say the amount.
 */
function RolledOverMark({ amount }: { amount: number }) {
  const words = rolledOverLabel(formatCurrency(amount))
  return (
    <span role="img" aria-label={words} title={words} className="mr-1 inline-flex align-middle text-[var(--color-muted-foreground)]">
      <CornerDownRight className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  )
}

// The columns' narrowest widths are chosen so the table fits the page's content box at 1366px and 1440px (1092 and 1166px, with the sidebar open), so Forecast is on screen at rest, measured in a
// browser. A table wider than its box (1280px) still scrolls sideways with the first column pinned (DataTable's column rule), which is why these are not the DataTable's usual 8rem.
function columnsFor(): Column<BudgetRiskRow>[] {
  return [
    {
      key: 'participantLabel',
      header: 'Participant',
      minWidth: '10rem',
      // The pinned start column is the one that says who the row is.
      render: row => <ParticipantCell row={row} />,
    },
    {
      key: 'poolLabel',
      header: 'Pool',
      minWidth: '8rem',
      // A stated pool is named for its category ("Increased Social and Community Participation"): cut at a cap that grows with the room, with the full name in `title`.
      render: row => <CellText title={row.poolLabel} className="md:max-w-[12rem] 2xl:max-w-[18rem]">{row.poolLabel}</CellText>,
    },
    {
      key: 'period',
      header: 'Period',
      minWidth: '10rem',
      wrap: true,
      // A period is a range of two calendar days, written with the app's own range formatter: it never drops a year and never becomes "Sep" in one ICU build and "Sept" in another.
      // Wraps at its dash (the dates keep their words together) so a plan-year period is two short lines and not one 11rem one.
      render: row => <span title={`${row.periodStart} to ${row.periodEnd}`} className="block md:max-w-[7rem]">{writtenSpan(row.periodStart, row.periodEnd)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      minWidth: '7rem',
      sortable: true,
      // F-15: without an explicit `sortFn`, `DataTable.defaultComparator` falls through to `String(a).localeCompare(b)` and sorts the risk words ALPHABETICALLY - Approaching, ForecastOver,
      // OnTrack, Over - the exact reverse of the order the spec requires. The rank is declared once, in `budgetRiskRank` (the server's own: a pool the NDIA has refused sits straight after Over), and
      // this column is the only thing that reads it. Ties fall back to the participant's name so a re-sort is stable rather than arbitrary.
      sortFn: (a, b) => {
        const rank = budgetRiskRank(a) - budgetRiskRank(b)
        return rank !== 0 ? rank : a.participantLabel.localeCompare(b.participantLabel, 'en-AU')
      },
      render: row => <StatusCell row={row} />,
    },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      minWidth: '6.5rem',
      render: row => (
        <span className="max-md:text-left">
          {/* Available includes money rolled over from earlier periods, which the Funding tab labels "not confirmed" (somebody else may have used it): a row that is on track by it says so, by a mark. The mark
              is BEFORE the figure: in a right-aligned money column a mark after it pushes the digits left of an unmarked row's, and the column no longer lines up on the decimal point. */}
          {row.figures.visible && row.carried !== null && row.carried > 0 && <RolledOverMark amount={row.carried} />}
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
      minWidth: '6.5rem',
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
      minWidth: '6.5rem',
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
      minWidth: '6.5rem',
      render: row => (
        <span className="max-md:text-left">
          {/* Before the figure, for the same reason as the roll-forward mark: the digits keep the column's right edge. */}
          {row.figures.visible && (row.unpricedShifts ?? 0) > 0 && <UnpricedMark count={row.unpricedShifts as number} />}
          <BudgetFigure figures={row.figures} amount={row.forecast} reason={row.unavailableReason ?? unavailableFigure()} />
        </span>
      ),
    },
  ]
}

/**
 * The NDIS-funded participants with no budget in force, kept off the list behind a count: a disclosure (a button that says what it holds, whether it is open, and what it controls), then each
 * participant with the way to record a budget. ODIP cannot warn about a budget it does not hold, and the list says so inside the opened list, where the people it is about are. It is open from the
 * start on a page where nobody has a budget yet, because they are then the only useful thing on it.
 */
export function NoBudgetTail({ entries, defaultOpen = false }: { entries: NoBudgetEntry[]; defaultOpen?: boolean }) {
  const listId = useId()
  const [open, setOpen] = useState(defaultOpen)
  if (entries.length === 0) return null

  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="flex flex-col gap-2 text-[13px] text-[var(--color-muted-foreground)]">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen(current => !current)}
          className="inline-flex min-h-[var(--tap-min)] items-center gap-1 rounded-[var(--radius-sm)] px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          <Chevron className="h-3.5 w-3.5" aria-hidden="true" />
          {noBudgetHiddenLabel(entries.length)}
        </button>
      </div>
      <div id={listId} hidden={!open} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)]">
        <p className="border-b border-[var(--color-border)] px-[var(--card-pad)] py-2">{noBudgetNote}</p>
        <ul className="divide-y divide-[var(--color-border)]">
          {entries.map(entry => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-[var(--card-pad)] py-2">
              <span className="min-w-0 text-sm font-medium text-[var(--color-foreground)]">{entry.participantLabel}</span>
              <span className="flex flex-wrap items-center gap-2">
                <span>{entry.reason}</span>
                {entry.action && <RowAction action={entry.action} participantLabel={entry.participantLabel} />}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** What the page says when no budget is being tracked for anybody, and what to do about it. */
function NothingTracked() {
  return (
    <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-[var(--card-pad)] py-6 text-center text-sm text-[var(--color-muted-foreground)]">
      {NOTHING_TRACKED}
    </p>
  )
}

export function BudgetRiskTable({ state, caption }: { state: BudgetRiskTableState; caption?: string }) {
  // The page-level states are the app's own (PageState), as on every record page and the Funding tab. A failure is never drawn as an empty list: that would read as "nobody is at risk".
  if (state.status === 'loading') return <PageState kind="loading" noun="budget list" />
  if (state.status === 'failed') return <PageState kind="error" noun="budget list" onRetry={state.onRetry} />
  if (state.status === 'empty') return <NothingTracked />

  // Nothing is tracked, but some people have no budget recorded: they are the only useful thing on the page, so they are open from the start.
  if (state.rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <NothingTracked />
        <NoBudgetTail entries={state.noBudget ?? []} defaultOpen />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {caption && <p className="text-[13px] text-[var(--color-muted-foreground)]">{caption}</p>}
      <DataTable
        data={state.rows}
        columns={columnsFor()}
        keyField="id"
        // F-15: sorting is opt-in twice over - `sortable` on the table AND `sortable` on the column. Without them there is no sort affordance at all, and the `sortFn` above would be dead
        // code. The Status column is the one that carries risk order.
        sortable
        emptyMessage={NOTHING_TRACKED}
        // The same weak wash for both, as the Qualifications table tints overdue and due soon: a stronger tint on the milder status ranked severity backwards, and the pill carries the status.
        rowClassName={row => (row.status === 'Over' ? 'bg-[var(--color-error-container)]/10' : row.status === 'ForecastOver' ? 'bg-[var(--color-warning-container)]/10' : '')}
      />
      {state.rows.some(row => row.figures.visible && (row.unpricedShifts ?? 0) > 0) && (
        <p className="flex items-start gap-1 text-[13px] text-[var(--color-muted-foreground)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{UNPRICED_LEGEND}</span>
        </p>
      )}
      {state.rows.some(row => row.figures.visible && row.carried !== null && row.carried > 0) && (
        <p className="flex items-start gap-1 text-[13px] text-[var(--color-muted-foreground)]">
          <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{ROLLED_OVER_LEGEND}</span>
        </p>
      )}
      <NoBudgetTail entries={state.noBudget ?? []} />
    </div>
  )
}
