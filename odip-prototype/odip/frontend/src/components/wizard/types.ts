// CORE-01 — reusable wizard shell. See
// docs/specs/odip-updates-2026-09/SPEC-00-foundations.md (repo root, outside this worktree) for
// the full design rationale. This file holds only the generic types the shell and its consumers
// share — no participant/incident/intake-specific knowledge belongs here.

/** One step in a wizard's data-collecting flow. Never includes a "review" entry — the shell owns
 * the review pseudo-step internally (see `REVIEW_STEP_KEY` in `useWizard.ts`). */
export type WizardStepDef<V> = {
  key: string
  label: string
  fields: readonly (keyof V)[]
}

/** One field error, keyed by the exact dot/array RHF path (e.g. "riskEntries.0.description"). */
export type WizardFieldError = { path: string; message: string; code?: string }

/**
 * Step-scoped validation, supplied by the consumer — the shell never hard-codes Zod (or anything
 * else). Returning `null`/`[]` means the step is valid and Next may advance.
 *
 * May be async and may itself perform a network call (e.g. a per-step PATCH-on-Next) — the shell
 * awaits it before advancing and exposes `isAdvancing` while it's in flight. A synchronous
 * validator (e.g. `schema.safeParse`) already satisfies this signature with no wrapping —
 * `Promise.resolve(result)` awaits transparently.
 */
export type WizardValidate<V> = (
  step: WizardStepDef<V>,
  values: V,
) => WizardFieldError[] | null | Promise<WizardFieldError[] | null>

export type WizardSecondaryAction = {
  key: string
  label: string
  onClick: () => void | Promise<void>
  disabled?: boolean
}

export type ReviewRow = { label: string; value: string }
export type ReviewGroup = { stepKey: string; rows: ReviewRow[] }
/** Builds every group's rows in one pass over the current values — not one call per step — since
 * a consumer's row logic (e.g. summarising a healthConditions array) often reads more than one
 * step's fields to produce a single group's display rows. */
export type ReviewBuilder<V> = (values: V, steps: WizardStepDef<V>[]) => ReviewGroup[]

export type UseWizardOptions<V> = {
  /** Caller-computed, may change shape (length, order, membership) between renders — see
   * useWizard.ts's "computed step list" handling. Does NOT include the review step. */
  steps: WizardStepDef<V>[]
  /** Decoupled from edit/create — the caller decides. Seeds `visitedSteps` with either every
   * step's key (plus the review pseudo-step) or just the first step's key. Read once, on mount. */
  initialVisited: 'all' | 'linear'
  validate: WizardValidate<V>
  getValues: () => V
  setError: (path: string, err: { type?: string; message: string }) => void
  clearErrors: (paths: readonly string[]) => void
  /** Called with the first invalid field's path after a blocked Next/Submit, so the consumer's
   * existing focus-management keeps working unchanged. */
  onValidationFailed?: (firstPath: string) => void
}

export type UseWizardResult<V> = {
  stepIndex: number                 // position of currentStep within `steps` (never the review step)
  currentStep: WizardStepDef<V>
  isReviewStep: boolean
  visitedSteps: Set<string>         // KEYED BY STEP KEY, never by index — see useWizard.ts
  isAdvancing: boolean              // true while an async validate() is in flight
  goToStep: (key: string) => void   // no-ops if key isn't in visitedSteps
  handleBack: () => void
  handleNext: () => Promise<void>
  /** Mirrors a resolver's invalid-submit handler: given RHF's FieldErrors object (or any object
   * keyed by field name), jumps to whichever step owns the first error field and reports it via
   * onValidationFailed. */
  handleInvalidSubmit: (formErrors: Record<string, unknown>) => void
}
