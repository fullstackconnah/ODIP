import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useBudgetList } from '@/api/hooks'
import type { BudgetListRow } from '@/api/types'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { ToggleGroup } from '@/components/ToggleGroup'
import { writtenDay } from '@/lib/fundingPlan'
import { plural } from '@/lib/format'
import { queryPhase } from '@/lib/queryPhase'
import { usePermissions } from '@/lib/permissions'
import { BudgetRiskTable, NoBudgetTail } from './budgets/components/BudgetRiskTable'
import type { BudgetFigureVisibility, BudgetRiskTableState } from './budgets/components/viewModel'
import { budgetRiskRow, noBudgetEntry } from './budgets/budgetRows'

// The Budgets list (budget phase 2b): every participant's pools for the funding period running now, riskiest first - where the dashboard's "Budgets at risk" tile goes. The server works out every
// figure and the order (the ledger's own, GET api/v1/funding/budgets); this page filters what it was given by status and by a participant's name, and hands it to the table. It adds nothing up and
// ranks nothing. A participant with no budget in force is kept at the end behind a count, never warned about.

const STATUS_FILTERS = ['all', 'Over', 'ForecastOver', 'Approaching', 'OnTrack'] as const
type StatusFilter = typeof STATUS_FILTERS[number]
const isStatusFilter = (value: string | null): value is StatusFilter => !!value && (STATUS_FILTERS as readonly string[]).includes(value)

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  Over: 'Over',
  ForecastOver: 'Forecast over',
  Approaching: 'Approaching',
  OnTrack: 'On track',
}

const SEEN_BY_STAFF_ONLY: BudgetFigureVisibility = { visible: false, reason: 'Budget figures are for coordinators and administrators.' }

export default function BudgetsPage() {
  const { canManageFunding } = usePermissions()
  const budgets = useBudgetList(canManageFunding)
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')

  // The status filter lives in the URL (?status=Over), so a filtered list can be shared and the browser's back button undoes it. Anything that is not a status is "All".
  const requested = params.get('status')
  const status: StatusFilter = isStatusFilter(requested) ? requested : 'all'
  const setStatus = (next: string) => {
    const copy = new URLSearchParams(params)
    if (next === 'all') copy.delete('status')
    else copy.set('status', next)
    setParams(copy, { replace: true })
  }

  const phase = queryPhase(budgets)
  const data = budgets.data
  const figures: BudgetFigureVisibility = canManageFunding ? { visible: true } : SEEN_BY_STAFF_ONLY

  const needle = search.trim().toLowerCase()
  const matchesName = (name: string) => needle === '' || name.toLowerCase().includes(needle)
  const rows = data?.rows ?? []
  // How many rows each filter holds, for the filter's own label: a count of the rows the server sent that the search leaves, not a figure of any kind. (Counting past the search promised rows it had
  // taken away: "Over (1)" with a name typed that no over row has, and then "No budgets match these filters".)
  const found = rows.filter(row => matchesName(row.participantName))
  const counts: Record<StatusFilter, number> = { all: found.length, Over: 0, ForecastOver: 0, Approaching: 0, OnTrack: 0 }
  for (const row of found) if (row.status in counts) counts[row.status as StatusFilter] += 1

  // Nobody has a budget in force (the commonest state at first): there is nothing to filter or rank, so the filters and the caption about risk order are not drawn, and the people who need a budget
  // recorded, the only useful thing on the page, are open.
  const nothingTracked = !!data && rows.length === 0
  const activeStatus: StatusFilter = nothingTracked ? 'all' : status
  const shown: BudgetListRow[] = found.filter(row => activeStatus === 'all' || row.status === activeStatus)
  // A participant with no budget has no status, so only "All" can show them; the search narrows them like everyone else.
  const noBudget = activeStatus === 'all' ? (data?.noBudget ?? []).filter(entry => matchesName(entry.participantName)).map(noBudgetEntry) : []
  const clearFilters = () => { setSearch(''); setStatus('all') }

  const nothingAtAll = nothingTracked && (data?.noBudget?.length ?? 0) === 0
  // There are budgets, and the filters leave none of them: that is not "nothing is tracked", so it says what happened and offers the way back. (The participants with no budget are still kept below it.)
  const matchesNothing = rows.length > 0 && shown.length === 0

  let state: BudgetRiskTableState
  if (phase === 'loading') state = { status: 'loading' }
  else if (phase === 'error') state = { status: 'failed', onRetry: () => { void budgets.refetch() } }
  else if (nothingAtAll) state = { status: 'empty' }
  else state = { status: 'ready', rows: shown.map(row => budgetRiskRow(row, figures)), noBudget }

  const people = new Set(rows.map(row => row.participantId)).size
  const subtitle = data && rows.length > 0
    ? `${plural(rows.length, 'pool')} across ${plural(people, 'participant')}, as of ${writtenDay(data.asOf)}`
    : data ? `As of ${writtenDay(data.asOf)}` : undefined

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader title="Budgets" subtitle={subtitle}>
        {/* Undrawn while there is no list to filter: loading, failed, or nobody with a budget. */}
        {!!data && rows.length > 0 && (
          <>
            <ToggleGroup
              ariaLabel="Filter budgets by status"
              options={STATUS_FILTERS.map(key => ({ key, label: `${STATUS_LABEL[key]} (${counts[key]})` }))}
              value={status}
              onChange={setStatus}
              // Five words with counts do not fit one row at 390px: they wrap onto a second row whole, rather than squeezing into boxes that cut them (each label stays on one line).
              className="flex-wrap [&>button]:whitespace-nowrap"
            />
            <SearchInput value={search} onChange={setSearch} placeholder="Search participants..." label="Search participants" />
          </>
        )}
      </PageHeader>

      {matchesNothing ? (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-[var(--card-pad)] py-6 text-sm text-[var(--color-muted-foreground)]" role="status">
            <p>No budgets match these filters.</p>
            <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
          </div>
          <NoBudgetTail entries={noBudget} />
        </>
      ) : (
        <BudgetRiskTable state={state} caption={phase === 'ready' && rows.length > 0 ? 'Riskiest first. A participant appears once for every pool of their plan, for the funding period running now.' : undefined} />
      )}
    </div>
  )
}
