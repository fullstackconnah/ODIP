import { useMemo, useState } from 'react'
import type { UseWizardOptions, UseWizardResult, WizardStepDef } from './types'

// The shell owns a review pseudo-step that never appears in the consumer's `steps` array (see
// CORE-01's "Review step" design note) — reserved key, exported so consumers building their own
// step-rail list (which DOES need a visible "Review" pill) can reference the same string rather
// than re-inventing one that might drift out of sync with the hook's internal sentinel.
export const REVIEW_STEP_KEY = 'review'

/**
 * CORE-01 — the wizard shell's step-machinery hook. See
 * docs/specs/odip-updates-2026-09/SPEC-00-foundations.md (repo root, outside this worktree) for
 * the full design. Summary of the load-bearing decisions:
 *
 * - Internal state is a step KEY (`currentStepKey`), never a bare index — `stepIndex`/
 *   `currentStep` are derived every render via `steps.findIndex`.
 * - If the current key vanishes from `steps` (a computed list reshuffled underneath it), the hook
 *   clamps to `steps[min(lastKnownIndex, steps.length - 1)]` synchronously during render — no
 *   effect, no flash of a wrong step.
 * - `visitedSteps` is a `Set<string>` keyed by step key (plus the reserved `REVIEW_STEP_KEY`) —
 *   a stale or reappearing key is harmless by construction.
 * - `validate` may be async; `handleNext` awaits it and exposes `isAdvancing` while pending.
 */
export function useWizard<V>(options: UseWizardOptions<V>): UseWizardResult<V> {
  const { steps, initialVisited, validate, getValues, setError, clearErrors, onValidationFailed } = options

  const [currentStepKey, setCurrentStepKey] = useState<string>(() => steps[0]?.key ?? REVIEW_STEP_KEY)
  const [visitedSteps, setVisitedSteps] = useState<Set<string>>(() => {
    if (initialVisited === 'all') return new Set<string>([...steps.map((s) => s.key), REVIEW_STEP_KEY])
    return new Set<string>(steps[0] ? [steps[0].key] : [])
  })
  const [isAdvancing, setIsAdvancing] = useState(false)

  // "Storing information from previous renders" (react.dev's own recipe for this) — tracks the
  // `steps` array's identity and the last index `currentStepKey` was known to occupy in it, using
  // state (not a ref: a ref must never be read/written during render) so the comparison below and
  // its corrective setState calls are plain render-phase logic, not an effect. When `steps`'
  // identity changes and the current key has vanished from it, the clamp lands "wherever now
  // occupies roughly the same position" rather than bouncing back to step 0 — computed and
  // committed before this render paints, so there's no flash of the vanished step's content.
  const [prevSteps, setPrevSteps] = useState(steps)
  const [lastKnownIndex, setLastKnownIndex] = useState(0)

  const isReviewStep = currentStepKey === REVIEW_STEP_KEY

  let effectiveKey = currentStepKey
  let idx = isReviewStep ? -1 : steps.findIndex((s) => s.key === effectiveKey)

  if (steps !== prevSteps) {
    setPrevSteps(steps)
    if (!isReviewStep && idx === -1 && steps.length > 0) {
      const clampedIdx = Math.min(lastKnownIndex, steps.length - 1)
      effectiveKey = steps[clampedIdx].key
      idx = clampedIdx
      setCurrentStepKey(effectiveKey)
    }
  }
  if (idx !== -1 && idx !== lastKnownIndex) setLastKnownIndex(idx)

  const currentStep: WizardStepDef<V> = isReviewStep
    ? steps[Math.max(0, steps.length - 1)]
    : steps[idx]
  const stepIndex = isReviewStep ? Math.max(0, steps.length - 1) : idx

  const fieldToStepKey = useMemo(() => {
    const map: Record<string, string> = {}
    steps.forEach((step) => {
      step.fields.forEach((f) => {
        map[f as string] = step.key
      })
    })
    return map
  }, [steps])

  const goToStep = (key: string) => {
    if (!visitedSteps.has(key)) return
    setCurrentStepKey(key)
  }

  const handleBack = () => {
    if (isReviewStep) {
      if (steps.length > 0) setCurrentStepKey(steps[steps.length - 1].key)
      return
    }
    const prevIdx = Math.max(0, idx - 1)
    const prevStep = steps[prevIdx]
    if (prevStep) setCurrentStepKey(prevStep.key)
  }

  const handleNext = async () => {
    if (isReviewStep) return
    const step = currentStep
    if (!step) return
    clearErrors(step.fields as readonly string[])
    setIsAdvancing(true)
    try {
      const result = await validate(step, getValues())
      if (result && result.length > 0) {
        let firstPath: string | undefined
        for (const err of result) {
          if (firstPath === undefined) firstPath = err.path
          setError(err.path, { type: err.code, message: err.message })
        }
        if (firstPath !== undefined) onValidationFailed?.(firstPath)
        return
      }
      const nextKey = idx + 1 < steps.length ? steps[idx + 1].key : REVIEW_STEP_KEY
      setVisitedSteps((prev) => {
        const next = new Set(prev)
        next.add(nextKey)
        return next
      })
      setCurrentStepKey(nextKey)
    } finally {
      setIsAdvancing(false)
    }
  }

  const handleInvalidSubmit = (formErrors: Record<string, unknown>) => {
    const firstField = Object.keys(formErrors)[0]
    if (firstField === undefined) return
    const targetKey = fieldToStepKey[firstField]
    if (targetKey === undefined) return
    setVisitedSteps((prev) => {
      const next = new Set(prev)
      next.add(targetKey)
      return next
    })
    setCurrentStepKey(targetKey)
    onValidationFailed?.(firstField)
  }

  return {
    stepIndex,
    currentStep,
    isReviewStep,
    visitedSteps,
    isAdvancing,
    goToStep,
    handleBack,
    handleNext,
    handleInvalidSubmit,
  }
}
