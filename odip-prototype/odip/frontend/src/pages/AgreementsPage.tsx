import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarClock, FileText } from 'lucide-react'
import { useAgreements, useApproveAgreements } from '@/api/hooks'
import type { AgreementApproveResult, AgreementRow } from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { NoticesRegion } from '@/components/NoticesRegion'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { SelectField } from '@/components/SelectField'
import { StatusBadge } from '@/components/StatusBadge'
import { ToggleGroup } from '@/components/ToggleGroup'
import { useNotices } from '@/hooks/useNotices'
import { formatServiceDate } from '@/lib/planQuote'
import { plural } from '@/lib/format'
import { queryPhase } from '@/lib/queryPhase'
import { formatCurrency } from '@/lib/utils'
import { AgreementsBulkBar } from './agreements/AgreementsBulkBar'
import { ApproveAgreementsDialog, type ApprovePhase, type ApproveStopped } from './agreements/ApproveAgreementsDialog'
import { MAX_SELECTED, approveTargets, filterRows, listOptions, parseShow, statusBadge, termView, type Show } from './agreements/agreementRows'
import { NOT_AN_APPROVER_WORDS, NO_REPLY_WORDS, TOO_MANY_WORDS, summarise } from './agreements/outcomeWords'

const SHOW_OPTIONS: { key: Show; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ending', label: 'Ending soon' },
  { key: 'ended', label: 'Ended' },
  { key: 'draft', label: 'Draft waiting' },
  { key: 'new-price-list', label: 'New price list' },
]

const EMPTY_WORDS: Record<Exclude<Show, 'all'>, string> = {
  ending: 'No agreements end in the next 60 days or have ended.',
  ended: 'No agreement has ended without a newer one.',
  draft: 'No drafts are waiting for approval.',
  'new-price-list': 'Every agreement is on the newest price list.',
}

const columns: Column<AgreementRow>[] = [
  { key: 'participantName', header: 'Participant', mobile: 'primary' },
  {
    key: 'status', header: 'Status', mobile: 'status', minWidth: '9.5rem',
    render: row => { const b = statusBadge(row); return <StatusBadge tone={b.tone} label={b.label} /> },
  },
  {
    key: 'term', header: 'Term', mobile: 'meta', wrap: true,
    render: row => {
      const t = termView(row)
      return (
        <span className="block">
          <span className="block leading-4">{t.range}</span>
          {t.draftLine && <span className="block text-xs leading-[14px] text-[var(--color-muted-foreground)]">{t.draftLine}</span>}
        </span>
      )
    },
  },
  {
    key: 'total', header: 'Total', align: 'right', mobile: 'meta', className: 'tabular-nums',
    render: row => {
      const t = termView(row)
      return (
        <span className="block text-right tabular-nums">
          <span className="block leading-4">{formatCurrency(t.total)}</span>
          {t.from && <span className="block text-xs leading-[14px] text-[var(--color-muted-foreground)]">{`from ${formatServiceDate(t.from)}`}</span>}
        </span>
      )
    },
  },
  {
    key: 'priceList', header: 'Price list', mobile: 'meta', wrap: true,
    render: row => (
      <span className="block">
        <span className="block leading-4">{row.priceList?.version ?? ''}</span>
        {row.newerPriceList && <span className="block text-xs leading-[14px] text-[var(--color-info)]">{`${row.newerPriceList.version} available`}</span>}
      </span>
    ),
  },
]

/** No HTTP answer at all (timeout, network): the server may have gone on and approved some. */
const hasNoReply = (error: unknown) => !(error as { response?: unknown })?.response

const failureWords = (error: unknown) => {
  const status = (error as { response?: { status?: number } })?.response?.status
  return status === 429 ? TOO_MANY_WORDS : status === 403 ? NOT_AN_APPROVER_WORDS : hasNoReply(error) ? NO_REPLY_WORDS : 'Could not approve these. Try again.'
}

/**
 * Every participant's service agreement in one list (Agreements page, PR A): filter by what needs doing, tick the ones with a draft waiting and approve them together. The filters live in the
 * address (show, list, q) so a view can be linked; the page only filters what the one list read gave it. Each approval is re-checked by the server, in series, as the single Approve is.
 */
export default function AgreementsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const show = parseShow(params.get('show'))
  const list = params.get('list') ?? ''
  const q = params.get('q') ?? ''
  const setParam = (key: string, value: string) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (value && !(key === 'show' && value === 'all')) next.set(key, value)
    else next.delete(key)
    return next
  }, { replace: true })

  const query = useAgreements()
  const phase = queryPhase(query)
  const rows = useMemo(() => query.data?.rows ?? [], [query.data])
  const canApprove = query.data?.canApprove ?? false
  const shown = useMemo(() => filterRows(rows, { show, list, q }), [rows, show, list, q])
  const lists = useMemo(() => listOptions(rows), [rows])

  const [picked, setSelected] = useState<Set<string>>(new Set())
  // A filter that hides a ticked row drops it from the selection: Approve only ever acts on what is on screen.
  const selected = useMemo(() => {
    const visible = new Set(shown.map(r => r.participantId))
    return new Set([...picked].filter(id => visible.has(id)))
  }, [picked, shown])

  const { notices, notify, dismiss } = useNotices()
  const noticesRef = useRef<HTMLDivElement>(null)
  const [dialog, setDialog] = useState<{ open: boolean; phase: ApprovePhase; progress: number; error: string | null; results: AgreementApproveResult[]; stopped: ApproveStopped | null }>(
    { open: false, phase: 'confirm', progress: 0, error: null, results: [], stopped: null })
  const [count, setCount] = useState(0)
  const onProgress = useCallback((done: number) => setDialog(d => ({ ...d, progress: done })), [])
  const approve = useApproveAgreements(onProgress)

  const targets = useMemo(() => approveTargets(rows, selected), [rows, selected])
  const skipped = selected.size - targets.length

  const confirm = async () => {
    const sent = targets
    setCount(sent.length)
    setDialog(d => ({ ...d, phase: 'running', progress: 0, error: null }))
    const run = await approve.mutateAsync(sent)
    if (run.stopped && run.results.length === 0) {
      setDialog(d => ({ ...d, phase: 'confirm', error: failureWords(run.stopped!.error) }))
      return
    }
    const done = new Set(run.results.filter(r => r.outcome === 'Approved').map(r => r.participantId))
    setSelected(new Set([...selected].filter(id => !done.has(id))))
    const noReply = !!run.stopped && hasNoReply(run.stopped.error)
    const s = summarise(run.results, run.stopped?.notSent ?? 0, noReply)
    notify(s.tone, s.title, s.message)
    setDialog(d => ({
      ...d, phase: 'result', results: run.results,
      stopped: run.stopped ? { done: run.results.length, total: sent.length, notSent: run.stopped.notSent, noReply } : null,
    }))
  }
  const closeDialog = () => {
    setDialog(d => ({ ...d, open: false }))
    window.setTimeout(() => noticesRef.current?.focus(), 0)
  }

  const allShownSelected = shown.length > 0 && shown.every(r => selected.has(r.participantId))
  const filtered = show !== 'all' || !!list || !!q.trim()
  const emptyWords = show !== 'all' && !list && !q.trim() ? EMPTY_WORDS[show] : 'No agreements match. Clear the search or choose Any price list.'

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader title="Agreements" subtitle="Every participant's service agreement. Tick the ones with a draft waiting to approve them together." />

      <div ref={noticesRef} tabIndex={-1} className="outline-none empty:hidden">
        <NoticesRegion notices={notices} onDismiss={dismiss} className="empty:hidden" />
      </div>

      {phase !== 'ready' || rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            {/* One row that scrolls sideways inside its own box; the padding keeps the focus rings from being clipped. */}
            <div className="-mx-1 -my-1 min-w-0 overflow-x-auto px-1 py-1 max-sm:w-full">
              <ToggleGroup ariaLabel="Show" options={SHOW_OPTIONS} value={show} onChange={key => setParam('show', key)} className="w-max [&>button]:min-w-[var(--tap-min)] [&>button]:whitespace-nowrap" />
            </div>
            <SelectField
              label="Price list" value={list} onChange={e => setParam('list', e.target.value)} className="w-48 max-sm:w-full"
              options={[{ value: '', label: 'Any price list' }, ...lists.map(l => ({ value: l.version, label: l.version }))]}
            />
            <SearchInput value={q} onChange={value => setParam('q', value)} placeholder="Search participants..." label="Search participants" className="max-w-md flex-1 max-sm:max-w-none max-sm:basis-full" />
          </div>
          {phase === 'ready' && (
            <p className="text-sm text-[var(--color-muted-foreground)] tabular-nums">
              {filtered ? `${shown.length} of ${plural(rows.length, 'agreement')}` : plural(rows.length, 'agreement')}
            </p>
          )}
          {phase === 'ready' && (
            <AgreementsBulkBar
              selected={selected.size} approvable={targets.length} canApprove={canApprove} shown={shown.length} allShownSelected={allShownSelected}
              onToggleShown={() => setSelected(allShownSelected ? new Set() : new Set(shown.slice(0, MAX_SELECTED + 1).map(r => r.participantId)))}
              onClear={() => setSelected(new Set())}
              onApprove={() => setDialog({ open: true, phase: 'confirm', progress: 0, error: null, results: [], stopped: null })}
            />
          )}
        </div>
      ) : null}

      {phase === 'ready' && rows.length === 0 ? (
        <EmptyState
          icon={FileText} title="No agreements yet"
          description="A participant shows here once their first service agreement is saved. Write one from the participant's page."
        />
      ) : phase === 'ready' && shown.length === 0 ? (
        <EmptyState icon={CalendarClock} size="inline" title={emptyWords} />
      ) : (
        <DataTable
          data={shown} columns={columns} keyField="participantId" sortable={false}
          loading={phase === 'loading'}
          error={phase === 'error'} onRetry={() => query.refetch()}
          selectable={canApprove} selectedRows={selected} onSelectionChange={setSelected}
          onRowClick={row => navigate(`/participants/${row.participantId}/agreement-draft`)}
        />
      )}

      <ApproveAgreementsDialog
        open={dialog.open} phase={dialog.phase} count={dialog.phase === 'confirm' ? targets.length : count} skipped={skipped} progress={dialog.progress}
        error={dialog.error} results={dialog.results} stopped={dialog.stopped} onConfirm={confirm} onClose={closeDialog}
      />
    </div>
  )
}
