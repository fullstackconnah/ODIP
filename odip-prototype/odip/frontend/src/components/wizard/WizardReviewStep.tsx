import type { ReactNode } from 'react'
import { Card } from '@/components/Card'
import type { ReviewGroup, ReviewRow, WizardStepDef } from './types'

/** Today's `<dl>`/`dt`/`dd` row layout, extracted verbatim — a consumer happy with this doesn't
 * need to reimplement it; one that isn't can override via `renderRow`. */
function defaultRenderRow(row: ReviewRow) {
  return (
    <div key={row.label} className="flex justify-between gap-4">
      <dt className="text-[var(--color-muted-foreground)]">{row.label}</dt>
      <dd className="font-medium text-right min-w-0 break-words">{row.value}</dd>
    </div>
  )
}

export type WizardReviewStepProps<V> = {
  groups: ReviewGroup[]
  steps: WizardStepDef<V>[]
  onEdit: (stepKey: string) => void
  /** Overrides only the per-row rendering — the shell still owns the surrounding card/grid/
   * Edit-link chrome, it does not impose `<dl>` semantics on a consumer that wants something
   * else. */
  renderRow?: (row: ReviewRow) => ReactNode
}

/**
 * CORE-01 — extracted verbatim (markup/classes unchanged) from `the retired single-step wizard`'s
 * pre-shell inline Review step: one Card per group, an "Edit" button jumping back to that
 * group's owning step, and a row renderer (default or caller-supplied).
 */
export function WizardReviewStep<V>({ groups, steps, onEdit, renderRow = defaultRenderRow }: WizardReviewStepProps<V>) {
  return (
    <div className="grid md:grid-cols-2 gap-[var(--section-gap)]">
      {groups.map((group) => {
        const label = steps.find((s) => s.key === group.stepKey)?.label ?? group.stepKey
        return (
          <Card
            key={group.stepKey}
            title={label}
            action={
              <button
                type="button"
                onClick={() => onEdit(group.stepKey)}
                aria-label={`Edit ${label}`}
                className="min-h-[var(--control-h)] px-2 -mr-2 text-sm font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-[var(--radius-sm)]"
              >
                Edit
              </button>
            }
            className="space-y-2"
          >
            <dl className="space-y-2 text-sm">
              {group.rows.map((row) => renderRow(row))}
            </dl>
          </Card>
        )
      })}
    </div>
  )
}
