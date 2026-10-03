import { useState, type ReactNode } from 'react'
import { AlertTriangle, Copy, Trash2 } from 'lucide-react'
import type { AgreementState, DraftBlock, PlanIssue, PlanPriceZone } from '@/api/types'
import type { PlanBudget } from '@/api/hooks'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, RowActions, type Column } from '@/components/DataTable'
import { TONE } from '@/lib/tone'
import { describeBlock, type PlanStepKey } from '@/lib/planBlocks'
import { REASON_COPY, isRefusal } from '@/lib/planQuote'
import { plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import type { PlanTemplate } from '@/lib/planTemplates'
import { formatHours } from '@/lib/planBlocks'
import { IssueList, PlanNotices } from './PlanMessages'
import { TemplateCards } from './TemplateCards'
import { WeekStrip } from './WeekStrip'

type Row = { key: string; index: number; entry: DraftBlock; issues: PlanIssue[] }

const EDIT_CHIPS: { step: PlanStepKey; label: string; name: string }[] = [
  { step: 'times', label: 'Times', name: 'times' },
  { step: 'requirements', label: 'Support', name: 'support and requirements' },
  { step: 'travel', label: 'Travel', name: 'travel and transport' },
  { step: 'review', label: 'Review', name: 'prices' },
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

/**
 * The plan at a glance and the way into every part of it: each block as one readable line with what it costs in a week and over the agreement, the week drawn to scale above
 * them, and per block the step chips that open the stepper where you want to be, plus duplicate and remove. With no blocks the six templates are the start. A quote that is still
 * on its way leaves "..." where a figure will be, never a zero.
 */
export function PlanOverview({ entries, readOnly = false, budget, budgetStatus, issues, state, zone, onStart, onEdit, onDuplicate, onRemove, footer }: PlanOverviewProps) {
  const [removing, setRemoving] = useState<number | null>(null)
  const blocks = entries.map(entry => entry.block)

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <PlanNotices notices={budget?.period.notices ?? []} />
        <div>
          <h3 className="text-sm font-semibold">Start the week from a template</h3>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
            A participant&apos;s week is built from support blocks. Pick a template, set its days and times, and the agreement&apos;s lines and totals follow, priced from the NDIS catalogue. Nothing is typed in by hand.
          </p>
        </div>
        {readOnly ? <p className="text-sm text-[var(--color-muted-foreground)]">This draft has no blocks.</p> : <TemplateCards mode="start" onChoose={onStart} state={state} zone={zone} />}
      </div>
    )
  }

  const rows: Row[] = entries.map((entry, index) => ({ key: entry.block.id, index, entry, issues: issues.filter(issue => issue.blockId === entry.block.id) }))
  const planLevel = issues.filter(issue => !blocks.some(block => block.id === issue.blockId))
  const weeklyOf = (id: string) => budget?.weekly?.totals.byBlock.find(total => total.blockId === id)
  const periodOf = (id: string) => budget?.period.totals.byBlock.find(total => total.blockId === id)
  const pending = budgetStatus === 'loading' || (budgetStatus === 'idle')
  const figure = (text: string | null) => text ?? (pending ? '…' : '—')

  const columns: Column<Row>[] = [
    {
      key: 'block', header: 'Block', wrap: true, minWidth: '20rem',
      render: row => {
        const { block, requirements } = row.entry
        const asks = [requirements.workerGender === 'Female' ? 'Female worker' : requirements.workerGender === 'Male' ? 'Male worker' : null, requirements.driver ? 'Driver' : null, ...requirements.skills.map(skill => (skill === 'FirstAid' ? 'First aid' : skill === 'MedicationCompetent' ? 'Medication competent' : 'Manual handling'))].filter(Boolean)
        return (
          <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
            <span className="text-sm font-medium"><span className="tabular-nums text-[var(--color-muted-foreground)]">{row.index + 1}.</span> {describeBlock(block)}</span>
            {asks.length > 0 && <span className="text-[13px] text-[var(--color-muted-foreground)]">Asks for {asks.join(', ').toLowerCase().replace(/^./, c => c.toUpperCase())}</span>}
            {row.issues.map(issue => (
              <span key={`${issue.reason}-${issue.message}`} className={`inline-flex items-start gap-1 text-[13px] ${isRefusal(issue.reason) ? TONE.danger.ink : TONE.warning.ink}`}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {REASON_COPY[issue.reason]?.title ?? 'Needs a look'}{issue.count > 1 ? `, ${plural(issue.count, 'shift')}` : ''}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      key: 'weekly', header: 'An ordinary week', align: 'right', minWidth: '9rem',
      render: row => {
        const weekly = weeklyOf(row.entry.block.id)
        return <span className="tabular-nums">{weekly ? `${formatHours(weekly.supportHours)} h · ${formatCurrency(weekly.amount)}` : figure(null)}</span>
      },
    },
    {
      key: 'period', header: 'The agreement', align: 'right', minWidth: '7rem',
      render: row => {
        const period = periodOf(row.entry.block.id)
        return <span className="tabular-nums">{period ? formatCurrency(period.amount) : figure(null)}</span>
      },
    },
    {
      key: 'actions', header: '', minWidth: readOnly ? undefined : '27rem',
      render: row => readOnly ? null : (
        <div className="flex items-center justify-end gap-2">
          <div role="group" aria-label={`Edit block ${row.index + 1}`} className="flex items-center gap-1.5">
            {EDIT_CHIPS.map(chip => (
              <Button key={chip.step} variant="secondary" size="sm" aria-label={`Edit ${chip.name} of block ${row.index + 1}`} onClick={() => onEdit(row.index, chip.step)}>{chip.label}</Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" aria-label={`Duplicate block ${row.index + 1}`} onClick={() => onDuplicate(row.index)}><Copy className="h-3.5 w-3.5" aria-hidden="true" />Duplicate</Button>
          <RowActions>
            <Button variant="ghost-danger" size="sm" iconOnly aria-label={`Remove block ${row.index + 1}`} title="Remove" onClick={() => setRemoving(row.index)}><Trash2 className="h-4 w-4" /></Button>
          </RowActions>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PlanNotices notices={budget?.period.notices ?? []} />
      {planLevel.length > 0 && <IssueList issues={planLevel} blocks={blocks} />}
      <WeekStrip blocks={blocks} className="max-w-3xl" />
      <DataTable data={rows} keyField="key" columns={columns} emptyMessage="No blocks yet." className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]" />
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
