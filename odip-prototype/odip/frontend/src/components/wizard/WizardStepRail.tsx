import { Check } from 'lucide-react'
import type { WizardStepDef } from './types'

export type WizardStepRailOrientation = 'auto' | 'vertical' | 'horizontal'

export type WizardStepRailProps<V> = {
  steps: WizardStepDef<V>[]
  visitedSteps: Set<string>
  currentKey: string
  onSelect: (key: string) => void
  /**
   * Layout orientation. Default 'auto' = horizontal scrolling pill row below `lg` and a
   * vertical stacked list at `lg` and up (Tailwind responsive variants only — no matchMedia,
   * no JS, no duplicated markup). 'vertical' forces the vertical list at every width,
   * 'horizontal' forces the pill row at every width. The rail's `<nav>` is rendered exactly
   * once; only its class names flip.
   */
  orientation?: WizardStepRailOrientation
}

/**
 * CORE-01 — extracted verbatim (markup/classes/aria-current/keyboard behaviour unchanged) from
 * `the retired single-step wizard`'s pre-shell inline step-pill nav rail. Generic over `V` purely so a
 * consumer can pass its own `WizardStepDef<ParticipantFormData>[]`/etc. directly — the component
 * never reads step field values, only `key`/`label`.
 *
 * In the `auto`/`horizontal` mode the rail is a horizontally-scrolling pill row (the
 * `[contain:inline-size]` + `overflow-x-auto` are what stops the rail's contents from forcing
 * the wizard body past the viewport at 375/390px — see IntakeWizardPage.test.tsx's
 * narrowFocusModes assertion for why this matters). In the `vertical` mode the rail is a
 * stacked list with full-width buttons; the horizontal connector span between pills is
 * replaced by a vertical connector line behind the list-item markers (drawn via a single
 * absolutely-positioned, non-scrolling parent, so it never extends `document.scrollWidth`).
 */
export function WizardStepRail<V>({
  steps,
  visitedSteps,
  currentKey,
  onSelect,
  orientation = 'auto',
}: WizardStepRailProps<V>) {
  const currentIndex = steps.findIndex((s) => s.key === currentKey)
  const stepNumber = currentIndex + 1

  // `auto` collapses to a viewport-driven pair of variants: horizontal below lg, vertical from
  // lg up. The two `force` values collapse every breakpoint into one orientation.
  const isVerticalAtLg = orientation !== 'horizontal'
  const forceVertical = orientation === 'vertical'
  const forceHorizontal = orientation === 'horizontal'

  const navClasses = forceVertical
    ? 'relative w-full min-w-0 max-w-full'
    : forceHorizontal
      ? 'relative w-full min-w-0 max-w-full [contain:inline-size] overflow-x-auto overscroll-x-contain touch-pan-x'
      : [
          'relative w-full min-w-0 max-w-full',
          // Horizontal pill row below lg (mobile/tablet).
          '[contain:inline-size] overflow-x-auto overscroll-x-contain touch-pan-x',
          // Vertical list from lg up — drop the horizontal-overflow affordance since the
          // buttons stack and the content column (not the rail) is what can overflow.
          'lg:overflow-visible lg:[contain:inline-size]',
        ].join(' ')

  const listClasses = forceVertical
    ? 'flex flex-col gap-2 w-full'
    : forceHorizontal
      ? 'flex w-max min-w-full items-center gap-2 pb-2 md:gap-4'
      : [
          'flex w-max min-w-full items-center gap-2 pb-2 md:gap-4',
          'lg:flex-col lg:w-full lg:min-w-0 lg:items-stretch lg:gap-1 lg:pb-0',
        ].join(' ')

  const itemClasses = forceVertical
    ? 'flex items-stretch w-full'
    : forceHorizontal
      ? 'flex items-center gap-2 md:gap-4'
      : [
          'flex items-center gap-2 md:gap-4',
          'lg:flex-col lg:items-stretch lg:w-full lg:gap-0',
        ].join(' ')

  const buttonClasses = (isCurrent: boolean, isCompleted: boolean, isClickable: boolean) =>
    [
      'flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
      // In vertical mode the button should be full-width, text-left, and use a square-ish radius
      // so it reads as a list item rather than a pill. The lg: vertical variant applies the same
      // shape without locking the mobile/tablet horizontal mode.
      forceVertical || isVerticalAtLg
        ? 'lg:w-full lg:justify-start lg:rounded-lg lg:text-left'
        : '',
      {
        'bg-[var(--color-primary)] text-white': isCurrent,
        'bg-[var(--color-primary)]/10 text-[var(--color-primary)]': isCompleted && !isCurrent,
        'bg-[var(--color-accent)] text-[var(--color-muted-foreground)]': !isCurrent && !isCompleted,
      },
      !isClickable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
    ]
      .filter(Boolean)
      .join(' ')

  const renderConnector = (idx: number) => {
    if (idx >= steps.length - 1) return null
    if (forceHorizontal) {
      // Mobile/tablet horizontal pill row keeps the original horizontal line.
      return <span className="w-4 md:w-8 h-px bg-[var(--color-border)]" aria-hidden="true" />
    }
    if (forceVertical) {
      // Vertical line continuing down from the marker circle to the next step's marker.
      return <span aria-hidden="true" className="mx-auto my-0.5 block w-px flex-1 min-h-[12px] bg-[var(--color-border)]" />
    }
    // auto: horizontal connector below lg, vertical connector from lg up.
    return (
      <>
        <span className="w-4 md:w-8 h-px bg-[var(--color-border)] lg:hidden" aria-hidden="true" />
        <span aria-hidden="true" className="mx-auto my-0.5 hidden lg:block w-px flex-1 min-h-[12px] bg-[var(--color-border)]" />
      </>
    )
  }

  return (
    <nav
      aria-label="Intake wizard steps"
      className={navClasses}
    >
      <p className="mb-2 text-sm font-medium text-[var(--color-muted-foreground)]">
        Step {stepNumber > 0 ? stepNumber : 1} of {steps.length}
      </p>
      <ol className={listClasses}>
        {steps.map((step, idx) => {
          const isCurrent = step.key === currentKey
          const isCompleted = currentIndex !== -1 && idx < currentIndex
          const isClickable = visitedSteps.has(step.key)
          return (
            <li key={step.key} className={itemClasses}>
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                disabled={!isClickable}
                onClick={() => onSelect(step.key)}
                className={buttonClasses(isCurrent, isCompleted, isClickable)}
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
                    stays available to assistive tech at every width, in every orientation. */}
                <span className="sr-only sm:not-sr-only sm:inline">{step.label}</span>
              </button>
              {renderConnector(idx)}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
