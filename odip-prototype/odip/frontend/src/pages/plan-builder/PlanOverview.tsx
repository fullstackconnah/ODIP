import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle, Copy, Trash2 } from 'lucide-react'
import type { AgreementState, DraftBlock, PlanIssue, PlanPriceZone } from '@/api/types'
import type { PlanBudget } from '@/api/hooks'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, RowActions, type Column } from '@/components/DataTable'
import { TONE } from '@/lib/tone'
import { describeBlock, type PlanStepKey } from '@/lib/planBlocks'
import { NO_FIGURE, REASON_COPY, groupByReason, isRefusal } from '@/lib/planQuote'
import { plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import type { PlanTemplate } from '@/lib/planTemplates'
import { formatHours } from '@/lib/planBlocks'
import { IssueList, PlanNotices } from './PlanMessages'
import { TemplateCards } from './TemplateCards'
import { WeekStrip } from './WeekStrip'

type Row = { key: string; index: number; entry: DraftBlock; issues: PlanIssue[]; refused: boolean }

/** The step chips of a block. `name` finishes the accessible name, which leads with the verb ("Edit times of block 1"; for Review it is "Review prices of block 1", so the visible word is in it). */
const EDIT_CHIPS: { step: PlanStepKey; label: string; name: (block: number) => string }[] = [
  { step: 'times', label: 'Times', name: block => `Edit times of block ${block}` },
  { step: 'requirements', label: 'Support', name: block => `Edit support and requirements of block ${block}` },
  { step: 'travel', label: 'Travel', name: block => `Edit travel and transport of block ${block}` },
  { step: 'review', label: 'Review', name: block => `Review prices of block ${block}` },
]

type PlanOverviewProps = {
  entries: readonly DraftBlock[]
  /** The plan cannot be changed here (a revision that is not the working copy). Nothing that changes it is drawn. */
  readOnly?: boolean
  budget?: PlanBudget
  budgetStatus: 'idle' | 'loading' | 'error' | 'ready'
  /** What the plan's quote says needs a person, by block (an issue with no block is the plan's). */
  issues: readonly PlanIssue[]
  state: AgreementState
  zone: PlanPriceZone
  onStart: (template: PlanTemplate) => void
  onEdit: (index: number, step: PlanStepKey) => void
  onDuplicate: (index: number) => void
  onRemove: (index: number) => void
  /** Under the list: the save row. */
  footer?: ReactNode
}

type BlockActionsProps = {
  number: number
  /** The chip to land on when Tab arrives (the one that fixes what the row says is wrong), else the first. */
  suggested: number
  onEdit: (step: PlanStepKey) => void
  onDuplicate: () => void
  onRemove: () => void
}

/**
 * The four step chips, Duplicate and Remove of one block as ONE Tab stop: arrow keys, Home and End move between them (a toolbar), so a plan of forty blocks is forty stops and not two hundred and
 * forty with no way past them. Tab leaves for the next row, and comes back to the one last used.
 */
function BlockActions({ number, suggested, onEdit, onDuplicate, onRemove }: BlockActionsProps) {
  const toolbar = useRef<HTMLDivElement>(null)
  // The Tab stop is where the person last was in the toolbar. Until they have been in it, it follows what the block needs: a refusal arrives with the first quote, after the row is on screen, so
  // a stop that was chosen once when the row mounted would stay on the first chip (review N3).
  const [used, setUsed] = useState<number | null>(null)
  const active = used ?? suggested
  const buttons = () => [...(toolbar.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  const stop = (index: number) => (index === active ? 0 : -1)

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = buttons()
    const at = all.findIndex(button => button === document.activeElement)
    if (at < 0) return
    const next = event.key === 'ArrowRight' ? (at + 1) % all.length : event.key === 'ArrowLeft' ? (at - 1 + all.length) % all.length : event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : null
    if (next === null) return
    event.preventDefault()
    all[next].focus()
  }

  return (
    <div
      ref={toolbar}
      role="toolbar"
      aria-label={`Block ${number} actions`}
      onKeyDown={move}
      onFocus={event => { const at = buttons().findIndex(button => button === (event.target as Node)); if (at >= 0) setUsed(at) }}
      className="flex flex-wrap items-center gap-2 md:justify-end"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {EDIT_CHIPS.map((chip, index) => (
          <Button key={chip.step} variant="secondary" size="sm" tabIndex={stop(index)} aria-label={chip.name(number)} onClick={() => onEdit(chip.step)}>{chip.label}</Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" tabIndex={stop(EDIT_CHIPS.length)} aria-label={`Duplicate block ${number}`} onClick={onDuplicate}><Copy className="h-3.5 w-3.5" aria-hidden="true" />Duplicate</Button>
        <RowActions>
          <Button variant="ghost-danger" size="sm" iconOnly tabIndex={stop(EDIT_CHIPS.length + 1)} aria-label={`Remove block ${number}`} title="Remove" onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
        </RowActions>
      </div>
    </div>
  )
}

/**
 * The plan at a glance and the way into every part of it: each block as one readable line with what it costs in a week and over the agreement, the week drawn to scale above
 * them, and per block the step chips that open the stepper where you want to be, plus duplicate and remove. With no blocks the six templates are the start. A quote that is still
 * on its way leaves "..." where a figure will be, never a zero, and a block the engine refused has an en dash: nothing was priced from it, so it has no figure to show.
 */
export function PlanOverview({ entries, readOnly = false, budget, budgetStatus, issues, state, zone, onStart, onEdit, onDuplicate, onRemove, footer }: PlanOverviewProps) {
  const [removing, setRemoving] = useState<number | null>(null)
  const blocks = entries.map(entry => entry.block)

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <PlanNotices notices={budget?.period.notices ?? []} scope="overview" />
        <div>
          <h3 className="text-sm font-semibold">Start the week from a template</h3>
          <p className="mt-1 max-w-prose text-sm text-[var(--color-muted-foreground)]">
            Pick a template, set its days and times, and the agreement&apos;s lines and totals follow. Nothing is typed in by hand.
          </p>
        </div>
        {readOnly ? <p className="text-sm text-[var(--color-muted-foreground)]">This draft has no blocks.</p> : <TemplateCards mode="start" onChoose={onStart} state={state} zone={zone} />}
      </div>
    )
  }

  const rows: Row[] = entries.map((entry, index) => {
    const own = groupByReason(issues.filter(issue => issue.blockId === entry.block.id))
    return { key: entry.block.id, index, entry, issues: own, refused: own.some(issue => isRefusal(issue.reason)) }
  })
  const planLevel = issues.filter(issue => !blocks.some(block => block.id === issue.blockId))
  // A price is never $0.00, so a block that comes to nothing has had nothing priced from it (every line short of its item): its figure is an en dash, as a refused block's is, and not a "0 h · $0.00" that
  // reads as a price (review N6, as the budget bar does).
  const priced = <T extends { amount: number }>(total: T | undefined): T | undefined => (total && total.amount > 0 ? total : undefined)
  const weeklyOf = (id: string) => priced(budget?.weekly?.totals.byBlock.find(total => total.blockId === id))
  const periodOf = (id: string) => priced(budget?.period.totals.byBlock.find(total => total.blockId === id))
  const pending = budgetStatus === 'loading'
  // Somebody who can only read the plan cannot ask the pricing engine anything: with no figures to show, the columns for them are left out and the saved versions below carry the prices.
  const showFigures = !readOnly || !!budget
  const figure = (text: string | null, row: Row) => text ?? (pending && !row.refused ? '…' : NO_FIGURE)

  const allColumns: Column<Row>[] = [
    {
      key: 'block', header: 'Block', wrap: true, minWidth: '14rem',
      render: row => {
        const { block, requirements } = row.entry
        const asks = [requirements.workerGender === 'Female' ? 'Female worker' : requirements.workerGender === 'Male' ? 'Male worker' : null, requirements.driver ? 'Driver' : null, ...requirements.skills.map(skill => (skill === 'FirstAid' ? 'First aid' : skill === 'MedicationCompetent' ? 'Medication competent' : 'Manual handling'))].filter(Boolean)
        return (
          <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
            <span className="text-sm font-medium"><span className="tabular-nums text-[var(--color-muted-foreground)]">{row.index + 1}.</span> {describeBlock(block)}</span>
            {asks.length > 0 && <span className="text-[13px] text-[var(--color-muted-foreground)]">Asks for {asks.join(', ').toLowerCase().replace(/^./, c => c.toUpperCase())}</span>}
            {row.issues.map(issue => {
              const refusal = isRefusal(issue.reason)
              const copy = REASON_COPY[issue.reason]
              const chip = refusal && !readOnly ? EDIT_CHIPS.find(candidate => candidate.step === copy?.step) : undefined
              return (
                <span key={`${issue.reason}-${issue.message}`} className="flex flex-col items-start gap-0.5">
                  <span className={`inline-flex items-start gap-1 text-[13px] ${refusal ? TONE.danger.ink : TONE.warning.ink}`}>
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {copy?.title ?? 'Needs a look'}{issue.count > 1 ? `, ${plural(issue.count, 'shift')}` : ''}
                  </span>
                  {/* A refused block is the one thing here that stops a save, so the way out is on the row: what to do, and the step that does it. */}
                  {refusal && copy && <span className="max-w-prose text-[13px] text-[var(--color-muted-foreground)]">{copy.advice}</span>}
                  {chip && <Button variant="secondary" size="sm" aria-label={`Open ${chip.label} for block ${row.index + 1}`} onClick={() => onEdit(row.index, chip.step)}>Open {chip.label}</Button>}
                </span>
              )
            })}
          </div>
        )
      },
    },
    {
      key: 'weekly', header: 'An ordinary week', align: 'right', minWidth: '7rem',
      render: row => {
        const weekly = row.refused ? undefined : weeklyOf(row.entry.block.id)
        return <span className="tabular-nums">{weekly ? `${formatHours(weekly.supportHours)} h · ${formatCurrency(weekly.amount)}` : figure(null, row)}</span>
      },
    },
    {
      key: 'period', header: 'The agreement', align: 'right', minWidth: '6rem',
      render: row => {
        const period = row.refused ? undefined : periodOf(row.entry.block.id)
        return <span className="tabular-nums">{period ? formatCurrency(period.amount) : figure(null, row)}</span>
      },
    },
    {
      key: 'actions', header: '', minWidth: readOnly ? undefined : '13rem', className: readOnly ? undefined : 'xl:min-w-[28rem]',
      render: row => {
        if (readOnly) return null
        const refusal = row.issues.find(issue => isRefusal(issue.reason))
        const fixedAt = refusal ? REASON_COPY[refusal.reason]?.step : undefined
        return (
          <BlockActions
            number={row.index + 1}
            suggested={Math.max(0, EDIT_CHIPS.findIndex(chip => chip.step === fixedAt))}
            onEdit={step => onEdit(row.index, step)}
            onDuplicate={() => onDuplicate(row.index)}
            onRemove={() => setRemoving(row.index)}
          />
        )
      },
    },
  ]
  const columns = allColumns.filter(column => (column.key === 'weekly' || column.key === 'period' ? showFigures : column.key === 'actions' ? !readOnly : true))

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PlanNotices notices={budget?.period.notices ?? []} scope="overview" />
      {planLevel.length > 0 && <IssueList issues={planLevel} blocks={blocks} />}
      <WeekStrip blocks={blocks} />
      <DataTable data={rows} keyField="key" columns={columns} emptyMessage="No blocks yet." />
      {footer}
      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={() => { if (removing !== null) onRemove(removing); setRemoving(null) }}
        title={removing === null ? 'Remove this block?' : `Remove block ${removing + 1}?`}
        message={removing === null ? '' : <>{describeBlock(entries[removing].block)}. This changes the plan on screen; nothing is lost from a saved version.</>}
        confirmLabel="Remove block"
        variant="danger"
      />
    </div>
  )
}
