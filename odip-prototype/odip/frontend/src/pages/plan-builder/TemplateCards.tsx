import { Check } from 'lucide-react'
import type { AgreementState, PlanPriceZone } from '@/api/types'
import { describeBlock } from '@/lib/planBlocks'
import { PLAN_TEMPLATES, type PlanTemplate } from '@/lib/planTemplates'

type TemplateCardsProps = {
  /** `radio`: the Template step (choosing fills the block in, and Next moves on). `start`: the empty plan (a card starts a block on its template at once). */
  mode: 'radio' | 'start'
  selectedKey?: string | null
  onChoose: (template: PlanTemplate) => void
  state: AgreementState
  zone: PlanPriceZone
  /** Names the group of radios; the legend says what is being chosen. */
  legend?: string
}

const CARD = 'flex h-full min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border p-[var(--card-pad)] text-left transition-colors'
const IDLE = 'border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)]'
const SELECTED = 'border-[var(--color-primary)] bg-[var(--color-primary-fixed)]/40'

/**
 * The six places a block can start from. Each card names the template, says in a sentence what it is for, and shows the block it fills in as the same one readable line the
 * plan uses, so the choice is made on what it will look like. The cards are radios in the Template step (arrow keys move the choice) and plain buttons when they start a plan.
 */
export function TemplateCards({ mode, selectedKey = null, onChoose, state, zone, legend = 'Start from a template' }: TemplateCardsProps) {
  const cards = PLAN_TEMPLATES.map(template => {
    const line = describeBlock(template.build('template', state, zone).block)
    const selected = selectedKey === template.key
    const body = (
      <>
        <span className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-[var(--color-foreground)]">{template.title}</span>
          {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />}
        </span>
        <span className="text-[13px] text-[var(--color-muted-foreground)]">{template.summary}</span>
        <span className="mt-auto pt-1 text-[13px] tabular-nums text-[var(--color-foreground)]">{template.key === 'blank' ? 'No days or times yet' : line}</span>
      </>
    )
    return mode === 'start' ? (
      <li key={template.key} className="min-w-0">
        <button type="button" onClick={() => onChoose(template)} className={`${CARD} ${IDLE} w-full min-h-[var(--tap-min)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]`}>{body}</button>
      </li>
    ) : (
      <li key={template.key} className="min-w-0">
        <label className={`${CARD} ${selected ? SELECTED : IDLE} cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-ring)]`}>
          <input type="radio" name="plan-template" value={template.key} checked={selected} onChange={() => onChoose(template)} className="sr-only" />
          {body}
        </label>
      </li>
    )
  })

  const list = <ul className="grid grid-cols-1 gap-[var(--field-gap-x)] sm:grid-cols-2 xl:grid-cols-3">{cards}</ul>
  return mode === 'start' ? list : (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[13px] font-medium text-[var(--color-muted-foreground)]">{legend}</legend>
      {list}
    </fieldset>
  )
}
