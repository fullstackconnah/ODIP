import { Check } from 'lucide-react'
import type { WizardStepDef } from './types'

export type WizardStepRailProps<V> = {
  steps: WizardStepDef<V>[]
  visitedSteps: Set<string>
  currentKey: string
  onSelect: (key: string) => void
}

/**
 * CORE-01 — extracted verbatim (markup/classes/aria-current/keyboard behaviour unchanged) from
 * `the retired single-step wizard`'s pre-shell inline step-pill nav rail. Generic over `V` purely so a
 * consumer can pass its own `WizardStepDef<ParticipantFormData>[]`/etc. directly — the component
 * never reads step field values, only `key`/`label`.
 */
export function WizardStepRail<V>({ steps, visitedSteps, currentKey, onSelect }: WizardStepRailProps<V>) {
  const currentIndex = steps.findIndex((s) => s.key === currentKey)
  return (
    <nav aria-label="Intake wizard steps" className="overflow-x-auto">
      <ol className="flex items-center gap-2 md:gap-4 min-w-max pb-2">
        {steps.map((step, idx) => {
          const isCurrent = step.key === currentKey
          const isCompleted = currentIndex !== -1 && idx < currentIndex
          const isClickable = visitedSteps.has(step.key)
          return (
            <li key={step.key} className="flex items-center gap-2 md:gap-4">
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                disabled={!isClickable}
                onClick={() => onSelect(step.key)}
                className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
                  isCurrent
                    ? 'bg-[var(--color-primary)] text-white'
                    : isCompleted
                    ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                    : 'bg-[var(--color-accent)] text-[var(--color-muted-foreground)]'
                } ${!isClickable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <span
                  className={`flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0 ${
                    isCurrent ? 'bg-white/20' : isCompleted ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-border)]'
                  }`}
                >
                  {isCompleted ? <Check className="w-3 h-3" /> : idx + 1}
                </span>
                {/* Visually hidden below sm rather than removed from the DOM (a plain `hidden`
                    utility would strip it from the accessible name too, leaving screen reader
                    users with only a bare digit like "2" for the button) — the full step label
                    stays available to assistive tech at every width. */}
                <span className="sr-only sm:not-sr-only sm:inline">{step.label}</span>
              </button>
              {idx < steps.length - 1 && (
                <span className="w-4 md:w-8 h-px bg-[var(--color-border)]" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
