import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send } from 'lucide-react'
import { Button } from '@/components/Button'
import { buttonClasses } from '@/components/buttonClasses'
import { Callout } from '@/components/Callout'
import { CellText, DataTable, type Column, type SortState } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { SearchInput } from '@/components/SearchInput'
import { ToggleGroup } from '@/components/ToggleGroup'
import { TAP_TRUNCATED_LINK } from '@/components/tapArea'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { ClaimFileError, useBuildClaimFile } from '@/api/hooks/claimHub'
import type { HubLineDto } from '@/api/types'
import { plural } from '@/lib/format'
import { TONE } from '@/lib/tone'
import { formatCurrency } from '@/lib/utils'
import { AgeCell, PassMark } from './claimHubParts'
import { MAX_FILE_LINES, ROWS_PER_PAGE, deliveredText, quantityText } from './claimHubSteps'

type Filter = 'all' | 'ready' | 'blocked'

interface Props {
  lines: HubLineDto[]
  loading: boolean
  failed: boolean
  onRetry: () => void
  registrationProblem?: string
  canEditSettings: boolean
  onBuilt: (batchId: string | undefined, fileName: string, lineCount: number) => void
}

const isBlocked = (l: HubLineDto) => l.problems.some(p => p.severity === 'block')
const reasonId = (l: HubLineDto) => `claims-why-${l.lineId}`

// Where a hard check's fix lives (SHAPE §5): the participant for their NDIS number, the claim for anything on the line, nowhere for a change type.
function fixLink(l: HubLineDto, rule: string): { to: string; label: string } | null {
  if (rule === 'NdisNumber') return { to: `/participants/${l.participantId}`, label: 'Fix participant' }
  // A claim already past Ready (M3) can't have its line edited, so the link only opens it.
  if (rule === 'ClaimNotOpen') return { to: `/claims/${l.claimId}`, label: 'Open claim' }
  if (['ChangeType', 'RegistrationNumber', 'AlreadyAccepted', 'AlreadySent', 'AlreadyPending', 'HeldByAnotherClaim'].includes(rule)) return null
  return { to: `/claims/${l.claimId}`, label: 'Fix line' }
}

const SORTS: Record<string, (l: HubLineDto) => string | number> = {
  participant: l => l.participantName.toLowerCase(),
  delivered: l => l.from,
  amount: l => l.totalAmount,
  age: l => l.ageDays,
}

export function ReadyPanel({ lines, loading, failed, onRetry, registrationProblem, canEditSettings, onBuilt }: Props) {
  const buildFile = useBuildClaimFile()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortState>({ key: 'age', direction: 'desc' })
  const [page, setPage] = useState(1)
  const [building, setBuilding] = useState(false)
  const [refusal, setRefusal] = useState<{ body: string; list: string[] } | null>(null)
  const top = useRef<HTMLDivElement>(null)

  // A claim is sent whole (PartClaim): one blocked line holds back every line on its claim.
  const blockedClaims = useMemo(() => new Set(lines.filter(isBlocked).map(l => l.claimId)), [lines])
  const linesByClaim = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const l of lines) map.set(l.claimId, [...(map.get(l.claimId) ?? []), l.lineId])
    return map
  }, [lines])
  const tickable = (l: HubLineDto) => !blockedClaims.has(l.claimId)

  const term = search.trim().toLowerCase()
  const shown = useMemo(() => {
    const by = SORTS[sort.key] ?? SORTS.age
    const dir = sort.direction === 'asc' ? 1 : -1
    return lines
      .filter(l => !term || l.participantName.toLowerCase().includes(term) || l.claimReference.toLowerCase().includes(term))
      .filter(l => filter === 'all' || (filter === 'blocked') === !tickable(l))
      .sort((a, b) => (by(a) < by(b) ? -dir : by(a) > by(b) ? dir : 0))
  }, [lines, term, filter, sort, blockedClaims]) // eslint-disable-line react-hooks/exhaustive-deps

  const readyCount = lines.filter(tickable).length
  const picked = lines.filter(l => selected.has(l.lineId) && tickable(l))
  const total = picked.reduce((sum, l) => sum + l.totalAmount, 0)
  const oldest = lines.filter(tickable).sort((a, b) => b.ageDays - a.ageDays).slice(0, MAX_FILE_LINES).map(l => l.lineId)
  const allReadySelected = readyCount > 0 && picked.length >= Math.min(readyCount, MAX_FILE_LINES)
  const ageing = lines.filter(l => l.ageDays >= 60).length

  // Ticking or unticking a line does the same to the rest of its claim.
  const changeSelection = (next: Set<string>) => {
    const out = new Set(next)
    for (const [, ids] of linesByClaim) {
      const was = ids.some(id => selected.has(id))
      const now = ids.filter(id => next.has(id)).length
      if (!was && now > 0) ids.forEach(id => out.add(id))
      if (was && now < ids.length) ids.forEach(id => out.delete(id))
    }
    setSelected(out)
  }

  const reason = registrationProblem
    ? 'Add your NDIS registration number in Settings first.'
    : picked.length === 0
      ? 'Tick the lines to put in the file.'
      : picked.length > MAX_FILE_LINES
        ? `A file holds at most 5,000 lines. Untick ${(picked.length - MAX_FILE_LINES).toLocaleString('en-AU')} to build.`
        : null

  const build = async () => {
    if (reason || building) return
    setBuilding(true)
    setRefusal(null)
    try {
      const { batchId, fileName } = await buildFile('post', '/claim-batches', { lineIds: picked.map(l => l.lineId) }, 'claims.csv', "Couldn't build the file. Check your connection and try again.")
      setSelected(new Set())
      onBuilt(batchId, fileName, picked.length)
    } catch (err) {
      const e = err as ClaimFileError
      if (e.problems?.length) {
        const failedIds = new Set(e.problems.map(p => p.lineId))
        const named = e.problems.map(p => {
          const l = lines.find(x => x.lineId === p.lineId)
          return [l?.participantName ?? p.claimReference, l?.supportNumber, p.message].filter(Boolean).join(' · ')
        })
        const more = named.length - 5
        setRefusal({ body: `${plural(e.problems.length, 'line')} didn't pass the checks. They're marked below.`, list: [...named.slice(0, 5), ...(more > 0 ? [`and ${more} more`] : [])] })
        setSelected(prev => new Set([...prev].filter(id => !failedIds.has(id))))
        onRetry()
      } else {
        setRefusal({ body: e.message, list: [] })
      }
    } finally {
      setBuilding(false)
    }
  }

  // Hours / qty needs the room Checks does (its reason and fix link are the point of the table); it shows from 2xl, and the card on a phone never had it.
  const wide = useMediaQuery('(min-width: 96rem)', false)
  const allColumns: Column<HubLineDto>[] = [
    {
      key: 'participant', header: 'Participant', pin: 'start', mobile: 'primary', sortable: true,
      render: l => <Link to={`/participants/${l.participantId}`} className={`font-medium hover:underline ${TAP_TRUNCATED_LINK}`}>{l.participantName}</Link>,
    },
    {
      key: 'claim', header: 'Claim', mobile: 'meta',
      render: l => <Link to={`/claims/${l.claimId}`} title={l.claimReference} className={`block text-[var(--color-muted-foreground)] hover:underline md:max-w-[8rem] md:truncate ${TAP_TRUNCATED_LINK}`}>{l.claimReference}</Link>,
    },
    { key: 'item', header: 'Support item', mobile: 'meta', render: l => <CellText title={l.supportName}>{l.supportNumber}</CellText> },
    { key: 'delivered', header: 'Delivered', mobile: 'meta', sortable: true, render: l => <span className="whitespace-nowrap">{deliveredText(l.from, l.to)}</span> },
    { key: 'hours', header: 'Hours / qty', align: 'right', mobile: 'hidden', render: l => quantityText(l) },
    { key: 'amount', header: 'Amount', align: 'right', mobile: 'meta', sortable: true, render: l => formatCurrency(l.totalAmount) },
    { key: 'age', header: 'Age', mobile: 'status', sortable: true, render: l => <AgeCell days={l.ageDays} band={l.ageBand} /> },
    // A passing line says nothing on a phone card (PassMark carries data-pass); a blocked one gets its reason on a full-width line, no caps label.
    { key: 'checks', header: 'Checks', className: 'max-md:basis-full max-md:before:hidden! max-md:has-[[data-pass]]:hidden', render: l => <Checks line={l} heldBack={!tickable(l)} /> },
  ]
  const columns = allColumns.filter(c => wide || c.key !== 'hours')

  if (failed && !lines.length) return <div data-testid="claims-panel-ready"><PageState kind="error" noun="claim lines" onRetry={onRetry} /></div>

  if (!loading && !lines.length) {
    return (
      <div data-testid="claims-panel-ready">
        <EmptyState
          icon={Send}
          title="Nothing to send"
          description="NDIA-managed claim lines show here once a claim is generated: from a participant's Claims tab for shifts, or a trip's Claims tab."
          action={{ label: 'Go to participants', to: '/participants' }}
          secondaryAction={{ label: 'Go to trips', to: '/trips' }}
        />
      </div>
    )
  }

  return (
    <div data-testid="claims-panel-ready" className="flex flex-col gap-3">
      {registrationProblem && (
        <Callout
          tone="warning"
          title="Add your NDIS registration number"
          actions={canEditSettings ? <Link to="/settings?tab=organisation" className={buttonClasses('secondary', 'sm')}>Open Settings</Link> : undefined}
        >
          The NDIA needs it on every line of the file. {canEditSettings ? 'Add it in Settings, under Organisation.' : 'Ask an admin to add it in Settings.'}
        </Callout>
      )}
      {ageing > 0 && (
        <Callout tone="warning" polite title={`${plural(ageing, 'line')} ${ageing === 1 ? 'is' : 'are'} 60 days old or more`}>
          From 1 December 2026 the NDIA rejects claims made more than 90 days after the support was delivered. Send the oldest first.
        </Callout>
      )}
      {refusal && (
        <Callout tone="danger" title="The file wasn't built">
          {refusal.body}
          {refusal.list.length > 0 && <ul className="mt-1 list-disc pl-5">{refusal.list.map(item => <li key={item}>{item}</li>)}</ul>}
        </Callout>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="max-md:w-full md:w-80">
          <SearchInput value={search} onChange={value => { setSearch(value); setPage(1) }} label="Search participant or claim" placeholder="Search participant or claim" className="w-full" />
        </div>
        <ToggleGroup
          ariaLabel="Show lines"
          value={filter}
          onChange={value => { setFilter(value as Filter); setPage(1) }}
          options={[
            { key: 'all', label: `All ${lines.length}` },
            { key: 'ready', label: `Ready ${readyCount}` },
            { key: 'blocked', label: `Blocked ${lines.length - readyCount}` },
          ]}
        />
      </div>
      <ReadyBulkBar
        count={picked.length}
        total={total}
        allSelected={allReadySelected}
        onToggleAll={() => setSelected(allReadySelected ? new Set() : new Set(oldest))}
        canSelectAll={readyCount > 0}
        onClear={() => setSelected(new Set())}
        reason={reason}
        building={building}
        onBuild={build}
      />
      <div ref={top} className="scroll-mt-20">
        <DataTable
          key={`${filter}|${term}`}
          data={shown.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)}
          columns={columns}
          keyField="lineId"
          loading={loading}
          emptyMessage="No lines match. Clear the search or show all lines."
          selectable
          selectCellClassName="max-md:-order-3"
          selectedRows={selected}
          onSelectionChange={changeSelection}
          selectBlockedBy={l => (tickable(l) ? undefined : reasonId(l))}
          selectAll={{ checked: allReadySelected, indeterminate: picked.length > 0 && !allReadySelected, label: 'Select all ready', onChange: on => setSelected(on ? new Set(oldest) : new Set()) }}
          sort={sort}
          onSortChange={next => setSort(next ?? { key: 'age', direction: 'desc' })}
          pagination={{ page, pageSize: ROWS_PER_PAGE, totalCount: shown.length, onPageChange: p => { setPage(p); top.current?.scrollIntoView?.({ block: 'start' }) } }}
        />
      </div>
    </div>
  )
}

/** The Checks cell: a quiet "Ready", or the first hard-check failure in danger ink with its fix. The disabled box is described by it. */
function Checks({ line, heldBack }: { line: HubLineDto; heldBack: boolean }) {
  const blocks = line.problems.filter(p => p.severity === 'block')
  const warn = line.problems.find(p => p.severity === 'warn')
  if (!heldBack) return <PassMark warning={warn?.message} />
  if (!blocks.length) {
    return (
      <span id={reasonId(line)} className="block text-[var(--color-muted-foreground)] md:max-w-[14rem] md:truncate" title={`Another line on ${line.claimReference} needs fixing first. A claim is sent whole.`}>
        Another line on {line.claimReference} needs fixing first. A claim is sent whole.
      </span>
    )
  }
  const fix = fixLink(line, blocks[0].rule)
  const all = blocks.map(p => p.message).join('. ')
  return (
    <span className="inline-flex items-center md:max-w-[14rem] gap-2 max-md:flex-wrap" title={all}>
      <span id={reasonId(line)} className={`truncate max-md:whitespace-normal ${TONE.danger.ink}`}>
        {blocks[0].message}
        {blocks.length > 1 && <span className="md:hidden">. {blocks.slice(1).map(p => p.message).join('. ')}</span>}
      </span>
      {blocks.length > 1 && <span className="shrink-0 text-[var(--color-muted-foreground)] max-md:hidden">+{blocks.length - 1} more</span>}
      {fix && <Link to={fix.to} className={`shrink-0 font-medium text-[var(--color-primary)] hover:underline ${TAP_TRUNCATED_LINK}`}>{fix.label}</Link>}
    </span>
  )
}

interface BarProps {
  count: number
  total: number
  allSelected: boolean
  canSelectAll: boolean
  onToggleAll: () => void
  onClear: () => void
  reason: string | null
  building: boolean
  onBuild: () => void
}

/** The bar above the Ready table (AgreementsBulkBar's shape): what's ticked, Clear and Build. Below xl it sticks under the app header so Build stays in reach. */
function ReadyBulkBar({ count, total, allSelected, canSelectAll, onToggleAll, onClear, reason, building, onBuild }: BarProps) {
  const narrow = useIsBelowMd()
  const status = count > MAX_FILE_LINES
    ? `${count.toLocaleString('en-AU')} lines selected`
    : count === MAX_FILE_LINES
      ? '5,000 lines selected (the oldest; a file’s limit)'
      : count > 0 ? `${plural(count, 'line')} selected · ${formatCurrency(total)}` : ''
  return (
    <div className="max-xl:sticky max-xl:top-[calc(3rem+var(--safe-top))] max-xl:z-20 max-xl:shadow-[var(--shadow-hairline)] flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 max-md:flex-nowrap max-md:gap-x-3" role="region" aria-label="Selection">
      {narrow && (
        <label className="inline-flex min-h-[var(--tap-min)] shrink-0 items-center gap-2 text-sm">
          <input type="checkbox" className="rounded border-[var(--color-border)] cursor-pointer" checked={allSelected} onChange={onToggleAll} disabled={!canSelectAll} />
          Select all ready
        </label>
      )}
      {!narrow && (
        <>
          <span className="text-[13px] tabular-nums text-[var(--color-muted-foreground)] empty:hidden" aria-live="polite">{status}</span>
          <Button variant="ghost" size="sm" onClick={onClear} className={count > 0 ? '' : 'invisible'}>Clear</Button>
        </>
      )}
      <div className="ml-auto flex items-center gap-3">
        {!narrow && reason && <span id="claims-build-reason" className="text-[13px] text-[var(--color-muted-foreground)]" aria-live="polite">{reason}</span>}
        <Button
          data-testid="claims-build"
          variant="primary"
          size="md"
          aria-disabled={!!reason || building}
          aria-describedby={reason ? 'claims-build-reason' : undefined}
          onClick={onBuild}
          title={narrow && reason ? reason : undefined}
          className="aria-disabled:opacity-60 aria-disabled:cursor-default"
        >
          {building ? 'Building…' : `Build file (${plural(count, 'line')})`}
        </Button>
        {narrow && reason && <span id="claims-build-reason" className="sr-only" aria-live="polite">{reason}</span>}
      </div>
    </div>
  )
}
