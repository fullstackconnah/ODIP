import { useRef } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { WizardStepDef } from '@/components/wizard'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]'

/**
 * The caregiver form's slim progress: one 44px row ("Step 2 of 8 · Key Identifiers"), a 4px fill line, and the full step list
 * behind a native <details>. WizardStepRail can't serve here: its labels are sr-only below sm. Jump rules stay in useWizard;
 * a step is a button only once visited.
 */
export function CaregiverProgress({ steps, visitedSteps, currentKey, onSelect }: {
  steps: Pick<WizardStepDef<never>, 'key' | 'label'>[]
  visitedSteps: Set<string>
  currentKey: string
  onSelect: (key: string) => void
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const current = Math.max(0, steps.findIndex((s) => s.key === currentKey))
  const select = (key: string) => {
    if (details.current) details.current.open = false
    onSelect(key)
  }
  return (
    <details ref={details} className="group mb-[var(--section-gap)]">
      <summary className={`block cursor-pointer list-none rounded-[var(--radius-sm)] [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>
        <span className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
          <span className="truncate">Step {current + 1} of {steps.length} · {steps[current]?.label}</span>
          <span className="flex shrink-0 items-center gap-1 text-[var(--color-muted-foreground)]">
            <span className="max-sm:sr-only">All steps</span>
            <ChevronDown size={16} aria-hidden="true" className="transition-transform duration-150 motion-reduce:transition-none group-open:rotate-180" />
          </span>
        </span>
        <span aria-hidden="true" className="block h-1 rounded-full bg-[var(--color-surface-container)]">
          <span className="block h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
        </span>
      </summary>
      <nav aria-label="Caregiver form steps" className="mt-2">
        <ol className="flex flex-col gap-2">
          {steps.map((step, i) => {
            const isCurrent = i === current
            return (
              <li key={step.key}>
                <button
                  type="button"
                  disabled={!visitedSteps.has(step.key)}
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => select(step.key)}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-left text-sm disabled:cursor-not-allowed disabled:text-[var(--color-muted-foreground)] ${isCurrent ? 'bg-[var(--color-accent)] font-semibold' : ''} ${FOCUS_RING}`}
                >
                  <span className="inline-flex w-4 shrink-0 justify-center">
                    {i < current ? <Check size={16} aria-hidden="true" data-testid="step-done" className="text-[var(--color-primary)]" /> : i + 1}
                  </span>
                  {step.label}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
    </details>
  )
}
