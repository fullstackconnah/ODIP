import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { useApproveAgreements } from '@/api/hooks'
import type { AgreementApproveResult, AgreementBulkAction, AgreementBulkResult, AgreementTerm } from '@/api/types'
import { BackButton } from '@/components/BackButton'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { NoticesRegion } from '@/components/NoticesRegion'
import { StatusBadge } from '@/components/StatusBadge'
import { useNotices } from '@/hooks/useNotices'
import { formatDateRange } from '@/lib/dateRange'
import { addDays } from '@/lib/planQuote'
import { formatServiceDate } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { ApproveAgreementsDialog, type ApprovePhase } from './ApproveAgreementsDialog'
import { AgreementsBulkBar } from './AgreementsBulkBar'
import type { BulkRun } from './AgreementActionDialog'
import { MAX_SELECTED, changeWords } from './agreementRows'
import { NOT_AN_APPROVER_WORDS, NO_REPLY_LAST, NO_REPLY_WORDS, OUTCOME_BADGE, TOO_MANY_WORDS, notMovedToActive, notMovedWords, summarise } from './outcomeWords'

const HEADING: Record<AgreementBulkAction, (label: string) => string> = {
  renew: () => 'Renewal drafts',
  reprice: label => `Reprice drafts (${label})`,
  extend: label => `Extension drafts (to ${formatServiceDate(label)})`,
}

const range = (t: AgreementTerm | null) => (t ? formatDateRange(t.start, t.end) : '')
const money = (value: number | undefined) => (value === undefined ? '' : formatCurrency(value))
const moneyCell = 'tabular-nums'

const statusOf = (error: unknown) => (error as { response?: { status?: number } })?.response?.status
const noReply = (error: unknown) => { const s = statusOf(error); return s === undefined || [502, 503, 504].includes(s) }

interface Props {
  run: BulkRun
  /** Whether the person may approve: without it there is nothing to tick. */
  canApprove: boolean
  /** Back to the list, filtered to the drafts waiting. */
  onBack: () => void
}

/** What a bulk run made, as the same table read twice: the old term beside the new one, in dates and money. Nothing is ticked at first: approving is money. */
export function AgreementsReview({ run, canApprove, onBack }: Props) {
  const { action, label, results, stopped } = run
  const made = useMemo(() => results.filter(r => r.outcome === 'Created' && r.newDraftId), [results])
  const skipped = useMemo(() => results.filter(r => r.outcome === 'Skipped'), [results])
  const failed = useMemo(() => results.filter(r => r.outcome === 'Failed' || r.outcome === 'Busy'), [results])
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { headingRef.current?.focus() }, [])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [outcomes, setOutcomes] = useState<Record<string, AgreementApproveResult['outcome']>>({})
  // Beside each outcome: why an approved one was not moved to Active (empty when it was, or the setting is off).
  const [notMoved, setNotMoved] = useState<Record<string, string>>({})
  const [dialog, setDialog] = useState<{ open: boolean; phase: ApprovePhase; progress: number; error: string | null; refused: boolean }>({ open: false, phase: 'confirm', progress: 0, error: null, refused: false })
  const [count, setCount] = useState(0)
  const { notices, notify, dismiss } = useNotices()
  const noticesRef = useRef<HTMLDivElement>(null)
  const onProgress = useCallback((done: number) => setDialog(d => ({ ...d, progress: done })), [])
  const approve = useApproveAgreements(onProgress)

  // A row can be approved while it has no findings and has not been answered, or the roster was busy (pressing Approve again retries only those).
  const open = (r: AgreementBulkResult) => !r.hasIssues && (!outcomes[r.participantId] || outcomes[r.participantId] === 'Busy')
  const ready = made.filter(r => selected.has(r.participantId) && open(r))
  const needReview = made.filter(r => selected.has(r.participantId) && !open(r) && outcomes[r.participantId] !== 'Approved').length
  const leftOut = needReview > 0 ? needReview === 1 ? '1 needs review and is left out: open it to finish.' : `${needReview} need review and are left out: open them to finish.` : undefined

  const confirm = async () => {
    const sent = ready
    setCount(sent.length)
    setDialog(d => ({ ...d, phase: 'running', progress: 0, error: null, refused: false }))
    const result = await approve.mutateAsync(sent.map(r => ({ participantId: r.participantId, draftId: r.newDraftId! })))
    if (result.stopped && result.results.length === 0) {
      const status = statusOf(result.stopped.error)
      const error = status === 429 ? TOO_MANY_WORDS : status === 403 ? NOT_AN_APPROVER_WORDS : noReply(result.stopped.error) ? NO_REPLY_WORDS : 'Could not approve these. Try again.'
      setDialog(d => ({ ...d, phase: 'confirm', error, refused: status === 403 }))
      return
    }
    const answered = Object.fromEntries(result.results.map(r => [r.participantId, r.outcome]))
    setOutcomes(o => ({ ...o, ...answered }))
    setNotMoved(m => ({ ...m, ...Object.fromEntries(result.results.map(r => [r.participantId, notMovedToActive(r) ? notMovedWords(r.activation?.reason) : ''])) }))
    // Only a busy roster keeps its tick, so the next Approve retries those; everything else answered is done with.
    setSelected(new Set([...selected].filter(id => !answered[id] || answered[id] === 'Busy')))
    const s = summarise(result.results, result.stopped?.notSent ?? 0, !!result.stopped && noReply(result.stopped.error))
    notify(s.tone, s.title, s.message)
    setDialog(d => ({ ...d, open: false }))
    window.setTimeout(() => noticesRef.current?.focus(), 0)
  }

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView?.({ block: 'start' })
  const parts: { n: number; words: string; id: string }[] = [
    { n: made.length, words: made.length === 1 ? 'draft made' : 'drafts made', id: 'bulk-made' },
    { n: skipped.length, words: 'skipped', id: 'bulk-skipped' },
    { n: failed.length, words: 'failed', id: 'bulk-failed' },
  ].filter(p => p.n > 0)

  const link = (r: AgreementBulkResult): ReactNode => (
    <Link to={`/participants/${r.participantId}/agreement-draft`} aria-label={`${r.name}, open draft`} className="font-medium text-[var(--color-primary)] hover:underline">{r.name}</Link>
  )
  const check = (r: AgreementBulkResult): ReactNode => {
    const o = outcomes[r.participantId]
    if (o) {
      const badge = OUTCOME_BADGE[o]
      return (
        <span className="flex flex-wrap items-center gap-x-2">
          <StatusBadge tone={badge.tone} label={badge.label} />
          {o === 'NeedsReview' && <Link to={`/participants/${r.participantId}/agreement-draft`} className="text-[var(--color-primary)] underline underline-offset-2">Open it</Link>}
          {notMoved[r.participantId] && <span className="basis-full text-[var(--color-muted-foreground)]">{notMoved[r.participantId]}</span>}
        </span>
      )
    }
    return r.hasIssues ? <StatusBadge tone="warning" label="Needs review" /> : null
  }
  const checkColumn: Column<AgreementBulkResult> = { key: 'check', header: Object.keys(outcomes).length ? 'Outcome' : 'Check', mobile: 'status', minWidth: '9rem', render: check }
  const participant: Column<AgreementBulkResult> = { key: 'name', header: 'Participant', mobile: 'primary', render: link }
  const col = (key: string, header: string, render: (r: AgreementBulkResult) => ReactNode, money = false): Column<AgreementBulkResult> =>
    ({ key, header, mobile: 'meta', render, wrap: !money, ...(money && { align: 'right' as const, className: moneyCell }) })
  // On a phone card the meta values run together on one line, so a date carries its column's label; desktop has the column header.
  const dated = (key: string, header: string, render: (r: AgreementBulkResult) => string) =>
    col(key, header, r => { const value = render(r); return value ? <span><span className="text-[var(--color-muted-foreground)] md:hidden">{header} </span>{value}</span> : '' })
  const change = col('change', 'Change', r => (r.before && r.after ? changeWords(r.before.total, r.after.total) : ''), true)
  const columns: Column<AgreementBulkResult>[] = action === 'reprice'
    ? [participant, dated('term', 'Term', r => range(r.before)), col('before', 'Before', r => money(r.before?.total), true), col('after', 'After', r => money(r.after?.total), true), change, checkColumn]
    : action === 'extend'
      ? [participant, dated('last', 'Last term', r => range(r.before)), col('lastTotal', 'Last total', r => money(r.before?.total), true),
        dated('added', 'Added days', r => (r.before && r.after ? formatDateRange(addDays(r.before.end, 1), r.after.end) : '')), col('addedTotal', 'Added total', r => money(r.after?.total), true), checkColumn]
      : [participant, dated('last', 'Last term', r => range(r.before)), col('lastTotal', 'Last total', r => money(r.before?.total), true),
        dated('new', 'New term', r => range(r.after)), col('newTotal', 'New total', r => money(r.after?.total), true), change, checkColumn]
  const reasonColumns = (danger: boolean): Column<AgreementBulkResult>[] => [
    { key: 'name', header: 'Participant', mobile: 'primary', render: r => <Link to={`/participants/${r.participantId}/agreement-draft`} className="font-medium text-[var(--color-primary)] hover:underline">{r.name}</Link> },
    {
      key: 'reason', header: 'Reason', mobile: 'meta', wrap: true,
      render: r => danger
        ? <span className="inline-flex items-start gap-1.5 text-[var(--color-destructive)]"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{r.reason}</span>
        : <span className="text-[var(--color-muted-foreground)]">{r.reason}</span>,
    },
  ]

  const group = (id: string, title: string, body: ReactNode) => (
    <section className="flex flex-col gap-3">
      <h3 id={id} tabIndex={-1} className="text-base font-semibold outline-none">{title}</h3>
      {body}
    </section>
  )

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div>
        <BackButton onBack={onBack} label="all agreements" variant="link" />
      </div>

      <div ref={noticesRef} tabIndex={-1} className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] empty:hidden">
        <NoticesRegion notices={notices} onDismiss={dismiss} className="empty:hidden" />
      </div>

      {stopped && (
        <Callout tone="warning" actions={<Button variant="secondary" size="sm" onClick={onBack}>Show drafts waiting</Button>}>
          {stopped.noReply
            ? `Stopped after ${stopped.done} of ${stopped.total}. ${NO_REPLY_LAST(stopped.notSent)} Check the drafts waiting before trying again.`
            : `Stopped after ${stopped.done} of ${stopped.total}. The first ${stopped.done} are listed below. The other ${stopped.notSent} weren't started, so select them and try again.`}
        </Callout>
      )}

      <div className="flex flex-col gap-1.5">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">{HEADING[action](label)}</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {parts.map((p, i) => (
            <span key={p.words}>
              {i > 0 && ' · '}
              <button type="button" className="text-[var(--color-primary)] underline underline-offset-2" onClick={() => jump(p.id)}>{`${p.n} ${p.words}`}</button>
            </span>
          ))}
          {parts.length > 0 && '. '}
          Nothing changes on the roster until you approve a draft.
        </p>
      </div>

      {made.length > 0 && group('bulk-made', `Drafts made (${made.length})`, (
        <div className="flex flex-col gap-3">
          <AgreementsBulkBar
            selected={selected.size} approvable={ready.length} canApprove={canApprove} shown={made.length}
            allShownSelected={made.every(r => selected.has(r.participantId))}
            onToggleShown={() => setSelected(made.every(r => selected.has(r.participantId)) ? new Set() : new Set(made.slice(0, MAX_SELECTED + 1).map(r => r.participantId)))}
            onClear={() => setSelected(new Set())}
            onApprove={() => setDialog({ open: true, phase: 'confirm', progress: 0, error: null, refused: false })}
            note={leftOut ? `${needReview} ${needReview === 1 ? 'needs' : 'need'} review and ${needReview === 1 ? 'is' : 'are'} left out` : undefined}
          />
          <DataTable data={made} columns={columns} keyField="participantId" sortable={false} selectable={canApprove} selectedRows={selected} onSelectionChange={setSelected} />
        </div>
      ))}
      {skipped.length > 0 && group('bulk-skipped', `Skipped (${skipped.length})`, <DataTable data={skipped} columns={reasonColumns(false)} keyField="participantId" sortable={false} />)}
      {failed.length > 0 && group('bulk-failed', `Failed (${failed.length})`, <DataTable data={failed} columns={reasonColumns(true)} keyField="participantId" sortable={false} />)}
      {results.length === 0 && <p className="text-sm text-[var(--color-muted-foreground)]">{'No drafts were made.'}</p>}

      <ApproveAgreementsDialog
        open={dialog.open} phase={dialog.phase} count={dialog.phase === 'confirm' ? ready.length : count} skipped={0} leftOut={leftOut} progress={dialog.progress}
        error={dialog.error} refused={dialog.refused} results={[]} stopped={null} onConfirm={confirm} onClose={() => setDialog(d => ({ ...d, open: false }))}
      />
    </div>
  )
}
