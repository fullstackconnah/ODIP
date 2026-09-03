import type { ReactNode } from 'react'

export type CompactGridRowProps = {
  /**
   * Visible row label, rendered as plain text to the left of `control` on a single line — NOT a
   * `<label htmlFor>` association. This row's whole point is putting the label and control on
   * one line instead of `FormField`'s stacked label-above-control layout, so the control itself
   * must carry its own accessible name (e.g. `ToggleGroup`'s `ariaLabel` prop) — `label` here is
   * decorative text only. Kept as a plain `string` (not `ReactNode`) so it can double as this
   * row's `aria-label`.
   */
  label: string
  /**
   * The row's compact control, rendered on the right of the line — pass a control with its own
   * accessible name already wired (e.g. a `YesNoToggleField`/`AdlLevelToggleField` in `hideLabel`
   * mode), not one that expects a sibling `<label>` to name it.
   */
  control: ReactNode
  /**
   * Extra detail revealed under the row once some caller-owned condition is met (e.g. the row's
   * Yes/No answered "Yes", or an ADL level chosen) — indented, undivided by its own border.
   * Presence (non-nullish) of this prop IS the row's expanded state: this component doesn't add
   * an independent click-to-expand affordance of its own. The row's own `control` (already
   * keyboard-operable — e.g. `ToggleGroup`'s roving-tabindex radiogroup) is what actually drives
   * expansion; `aria-expanded` here just exposes the resulting state to assistive tech, the same
   * way a disclosure region's state is exposed once its trigger has been operated.
   */
  expanded?: ReactNode
}

/**
 * PF-7/PF-8 — shared row-per-line-with-optional-expand pattern. Replaces the
 * `p-3 rounded-lg border` per-row block used across Consent & Terms, the Health Conditions grid,
 * and the two ADL grids: one `label + control` line, with `expanded` content indented below when
 * present, separated from the next row by a bottom border instead of each row being its own
 * bordered card. Collapses roughly 3-4x the vertical space these fixed-row grids used to take
 * when few/no rows have an answer yet (the common fresh-intake state).
 */
export function CompactGridRow(props: CompactGridRowProps) {
  const { label, control, expanded } = props
  // Plain destructuring can't tell "expanded={undefined}" (a row that CAN expand but is
  // currently collapsed — every real caller in ParticipantCreatePage.tsx always passes this,
  // via `cond ? (...) : undefined`) apart from the prop being omitted entirely (a row with no
  // expand capability at all). `'expanded' in props` can: JSX only adds the key to the props
  // object when the attribute is written at the call site, even if its value is `undefined`.
  // Only a row that can genuinely expand gets `aria-expanded` at all — a row that never can
  // must not be announced as a disclosure with nothing behind it.
  const canExpand = 'expanded' in props
  const isExpanded = canExpand && expanded != null
  return (
    <div
      role="group"
      aria-label={label}
      {...(canExpand ? { 'aria-expanded': isExpanded } : {})}
      className="border-b border-[var(--color-border)] last:border-b-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
        <span className="text-sm font-medium text-[var(--color-foreground)]">{label}</span>
        {control}
      </div>
      {isExpanded && (
        <div className="pl-4 pb-3 -mt-1 space-y-3">
          {expanded}
        </div>
      )}
    </div>
  )
}
