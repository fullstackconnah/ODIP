import { useEffect, useRef } from 'react'
import type { UseFormSetValue } from 'react-hook-form'

/**
 * VALUE DERIVATION (DIAG-02 and later): a field whose VALUE should default off another field's
 * value. {@link FieldDerivationDef} + {@link useDeriveFieldValues} cover this case, e.g. DIAG-02's rule: "an Epilepsy diagnosis pre-selects the epilepsy-management
 * HIDPA option by default."
 *
 *   const HIDPA_DERIVATIONS: FieldDerivationDef<ParticipantFormData>[] = [
 *     {
 *       when: v => v.primaryDiagnosis === 'Epilepsy' || !!v.otherDiagnoses?.includes('Epilepsy'),
 *       apply: (v, setValue) => {
 *         const current = v.hidpaSupportCategories ?? []
 *         if (!current.includes('EpilepsyManagement')) {
 *           setValue('hidpaSupportCategories', [...current, 'EpilepsyManagement'], { shouldDirty: true })
 *         }
 *       },
 *     },
 *   ]
 *   useDeriveFieldValues(watchedValues, HIDPA_DERIVATIONS, setValue, existing)
 *
 * SEMANTICS — a default, not a lock:
 *   - TRANSITION-ONLY FIRING: `apply` runs only on the false -> true transition of `when`, never
 *     on every render/keystroke while `when` stays true. Concretely: selecting Epilepsy pre-ticks
 *     Epilepsy Management once; the user can then untick it and keep typing/editing the rest of
 *     the form without it silently re-forcing back on. A later false -> true transition (untick
 *     the epilepsy diagnosis, then re-select it) re-fires `apply` and re-defaults it — each new
 *     transition is a fresh "default", which is the intended, documented behaviour, not a bug.
 *   - USER OVERRIDE SURVIVES: because `apply` only fires on the transition edge, a user who
 *     unticks the derived value while `when` remains true is never overridden — the engine does
 *     not "correct" the field back on subsequent renders. This is one-directional by design: the
 *     engine only ever defaults the derived value ON (via `apply`), never forces it back OFF —
 *     so REMOVING the source condition entirely (e.g. deleting the Epilepsy diagnosis outright,
 *     not just switching it away and back to re-trigger the default) still never silently clears
 *     an already-set derived value either. A flagged high-intensity support need is never dropped
 *     without an explicit, separate user action.
 *   - EDIT-MODE SAFE (the `resetKey` param): loading an existing record's data via `reset()`
 *     looks, to the hook, identical to a user causing the same value change — both take `when`
 *     from false to true. Left unguarded, opening an edit page for an Epilepsy participant whose
 *     saved HIDPA selection had EpilepsyManagement deliberately unticked would silently re-tick it
 *     on every page load, turning the "default" into a lock via the back door. Passing a stable
 *     value that changes exactly once when the real data lands (the wizard passes `existing`, the
 *     fetched record — undefined before the query resolves, then a stable object reference after)
 *     re-baselines the hook's internal "previous state" the moment that identity changes, without
 *     firing `apply` for that transition. A CREATE session (existing stays undefined throughout)
 *     baselines once on mount and then derives live off every real user edit after that.
 *   - GENERIC: neither type takes any diagnosis/HIDPA-specific knowledge — `when`/`apply` are
 *     plain functions over `Partial<V>`, so this is a reusable capability for any future
 *     "field B should default off field A" rule, not a one-off built for DIAG-02.
 */

/** A predicate over the current (possibly partial, mid-entry) form values. */
export type ConditionPredicate<V> = (values: Partial<V>) => boolean

/**
 * One value-derivation rule: default a field's value off a *different* field's value. See the
 * module doc's VALUE DERIVATION section for the full semantics (transition-only firing, user-override survival, the `resetKey` re-baseline
 * story) — this type is deliberately generic, taking no knowledge of what `V` or the derived field
 * actually are.
 */
export interface FieldDerivationDef<V extends Record<string, unknown>> {
  /** True in the "derive" state (e.g. an Epilepsy diagnosis is selected). `apply` fires exactly once per false -> true transition of this predicate — never on every render while it stays true. */
  when: ConditionPredicate<V>
  /** Applies the derived value(s) via `setValue`. Called only on the false -> true transition — read the current value from `values` first if the update should be additive (e.g. append to an existing multi-select) rather than a flat overwrite. */
  apply: (values: Partial<V>, setValue: UseFormSetValue<V>) => void
}

/**
 * Fires each def's `apply` exactly once per false -> true transition of its `when` predicate —
 * see the module doc's VALUE DERIVATION section for the full semantics this implements (default
 * not lock, transition-only, edit-mode-safe via `resetKey`).
 *
 * @param resetKey Identity re-baselines the hook's internal "previous when-state" without firing
 * `apply`, the same way a fresh mount does — pass the value that changes exactly once when
 * externally-loaded data lands (e.g. the fetched record in an edit-mode wizard: `undefined` before
 * the query resolves, then a stable object reference after `reset()` applies it). Omit it (or pass
 * a value that never changes, e.g. `undefined`) for a pure create-flow form, where every `when`
 * transition is a genuine user edit worth deriving from.
 */
export function useDeriveFieldValues<V extends Record<string, unknown>>(
  values: Partial<V>,
  defs: readonly FieldDerivationDef<V>[],
  setValue: UseFormSetValue<V>,
  resetKey?: unknown,
): void {
  // null (not an empty array) is the "no baseline yet" sentinel — distinguishes "never run" from
  // "ran once and every def's when was false", which a plain array can't since both look like
  // "all false" to the comparison below.
  const prevWhenRef = useRef<boolean[] | null>(null)
  const prevResetKeyRef = useRef<unknown>(resetKey)

  useEffect(() => {
    const currentWhen = defs.map((def) => def.when(values))
    // A fresh baseline — either the very first run, or resetKey's identity just changed (external
    // data just landed) — updates the tracked state without treating it as a transition worth
    // deriving from. See the module doc's EDIT-MODE SAFE bullet for why this matters.
    const isFreshBaseline = prevWhenRef.current === null || prevResetKeyRef.current !== resetKey

    if (!isFreshBaseline) {
      const prevWhen = prevWhenRef.current!
      defs.forEach((def, i) => {
        if (!prevWhen[i] && currentWhen[i]) def.apply(values, setValue)
      })
    }

    prevWhenRef.current = currentWhen
    prevResetKeyRef.current = resetKey
    // Deliberately runs on every render where `values` has a new identity (useWatch — watching
    // the whole form — already returns a new object on every relevant keystroke, so this is the
    // correct "check every value change" granularity, same spirit as the hiddenFieldsKey-keyed
    // effects above but without a synthesised key since we need every value, not just a hidden-set
    // membership check). `defs`/`setValue` are stable-enough call-site values (defs is normally a
    // module-level const array; setValue is a stable react-hook-form function identity) and are
    // intentionally excluded to avoid re-running on identity churn that isn't a real value change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values])
}
