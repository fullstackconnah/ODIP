import { useEffect, useRef } from 'react'
import type { UseFormSetValue, UseFormUnregister } from 'react-hook-form'

/**
 * INTAKE-07 — conditional-visibility engine for the participant wizard
 * ======================================================================
 *
 * A declarative, reusable replacement for per-field ad-hoc conditionals
 * (`{someValue === 'X' && <FormField>...}`) scattered through the wizard. One `ConditionalFieldDef`
 * says "these fields render only when this predicate over the current form values is true" — the
 * engine derives which fields are hidden, and gives you the three things a hide needs to be
 * correct and accessible:
 *
 *   1. RENDER   — `isVisible(field)` from {@link useConditionalFields}. Gate the field's JSX with
 *                 it (`{isVisible('x') && <FormField>...}`), same conditional-mount pattern the
 *                 wizard already used for gender self-description — a real unmount, never CSS
 *                 `display:none`/`hidden`, so a hidden field is never merely visually hidden
 *                 (matters for screen readers and for keeping it out of the tab order).
 *   2. VALIDATE + PAYLOAD — {@link useUnregisterHiddenFields} calls react-hook-form's `unregister`
 *                 for every hidden field on each visibility change. Unregistering removes the
 *                 field from both `formState` validation AND the values object handleSubmit hands
 *                 to your submit callback — so a hidden field is excluded from validation and from
 *                 the submit payload without any extra bookkeeping. {@link stripHiddenFieldKeys} is
 *                 a defence-in-depth belt-and-braces pass you can additionally run over the
 *                 payload object in `onSubmit`, for the same guarantee even if you build the
 *                 payload from `data` in a way that could reintroduce a stale key.
 *   3. FOCUS    — {@link useFocusFallbackOnHide} tracks the currently-focused field id via a live
 *                 `focusin` listener (reading `document.activeElement` after a hide is too late —
 *                 removing a focused node from the DOM already forces focus to `<body>` as part of
 *                 that same commit) and, when a field that just became hidden owned focus, moves
 *                 focus to that def's `focusFallback` id instead of letting it fall through to
 *                 `<body>`. This is the "no focus loss" half of accessible reveal/hide; "no layout
 *                 jank" is satisfied by the wizard's existing stacked-card layout (removing one
 *                 row reflows the rest, same as it always has for the gender self-description
 *                 field this engine migrates).
 *
 * Usage (see ParticipantCreatePage.tsx for the live example — Gender and FUND-02 funding source):
 *
 *   const CONDITIONAL_FIELDS: ConditionalFieldDef<ParticipantFormData>[] = [
 *     { fields: ['genderSelfDescription'], visibleWhen: v => v.gender === 'Other', focusFallback: 'gender' },
 *   ]
 *   const { unregister } = useForm<ParticipantFormData>(...)
 *   const watchedValues = useWatch({ control })
 *   const { isVisible, hiddenFields } = useConditionalFields(watchedValues, CONDITIONAL_FIELDS)
 *   useUnregisterHiddenFields(unregister, hiddenFields)
 *   useFocusFallbackOnHide(CONDITIONAL_FIELDS, hiddenFields)
 *   // JSX: {isVisible('genderSelfDescription') && <FormField>...}
 *   // onSubmit: const payload = stripHiddenFieldKeys({ ...data }, hiddenFields)
 *
 * A `ConditionalFieldDef` may list several field names together when one answer gates a whole
 * mini-section (e.g. FUND-02 hides `ndisNumber`/`planStartDate`/`planEndDate`/`planType` together
 * when `fundingSource === 'Other'`) — they're shown/hidden/unregistered as one unit.
 *
 * EXTENSION POINT for later waves: LIVING-01/02/03 (living arrangements) and INTAKE-03
 * (service-specific inline fields) are pure visibility questions — just more
 * `ConditionalFieldDef` entries against whatever values shape that step's form uses, no engine
 * changes needed.
 *
 * VALUE DERIVATION (DIAG-02 and later): a field whose VALUE should default off another field's
 * value — as opposed to whether it renders at all — is a different question to visibility, and
 * `ConditionalFieldDef` has no way to express it. {@link FieldDerivationDef} + {@link useDeriveFieldValues}
 * cover this case, e.g. DIAG-02's rule: "an Epilepsy diagnosis pre-selects the epilepsy-management
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
 *     not "correct" the field back on subsequent renders.
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
 *
 * PITFALL — the same field name listed in more than one `ConditionalFieldDef`: hidden fields
 * accumulate into a single `Set` (see `computeHiddenFields`'s `hidden.add(field)` loop over every
 * def, not just the first matching one), so a field hidden by ANY def stays hidden even if another
 * def listing that same field says visible. In other words this is AND-visibility across defs
 * mentioning a field (every one of them must say visible), NOT OR-visibility ("visible if any def
 * shows it") — the opposite of what "listing it in another def" might suggest. LIVING-01's "some
 * fields shared across arrangement types" (Family/Independent/Supported Accommodation) is exactly
 * the shape this bites: do not list one shared field in three separate per-arrangement-type defs
 * expecting it to show whenever ANY arrangement is selected — that field would only ever show when
 * every arrangement type happened to be selected simultaneously (never, for a single-select). Union
 * the arrangement types into ONE def's `visibleWhen` instead, e.g.
 * `visibleWhen: v => v.arrangementType === 'Family' || v.arrangementType === 'Independent'`.
 *
 * Deliberately NOT covered here: the equipment-notes gating (`equipmentRequirements` disabled
 * until an equipment checkbox is ticked) is a visible-but-disabled pattern, not a hide — the field
 * stays mounted with an explanatory hint rather than disappearing, which is a different UX
 * contract to a true hide/unregister. It still expresses its predicate as a plain
 * {@link ConditionPredicate} for a shared vocabulary with this engine, it just isn't wired through
 * `useConditionalFields`/`useUnregisterHiddenFields` since disabling isn't hiding. INC-style
 * reveals on the incident report page are untouched — that page is out of scope for INTAKE-07.
 */

/** A predicate over the current (possibly partial, mid-entry) form values. */
export type ConditionPredicate<V> = (values: Partial<V>) => boolean

export interface ConditionalFieldDef<V, F extends string = Extract<keyof V, string>> {
  /** Field name(s) gated together, as one unit, by the same predicate. */
  fields: readonly F[]
  /** True = render/register/include in payload. False = hide/unregister/exclude. */
  visibleWhen: ConditionPredicate<V>
  /**
   * Element id to move focus to if a field in this group currently owns focus at the moment it
   * becomes hidden (see {@link useFocusFallbackOnHide}). Omit if this group can never plausibly
   * hide while one of its own fields is focused (rare) — but for anything reachable from a select
   * the user just changed, i.e. nearly everything, set it to that select/trigger's id.
   */
  focusFallback?: string
}

/** Pure computation shared by {@link useConditionalFields} and any non-hook caller (e.g. tests). */
export function computeHiddenFields<V>(
  values: Partial<V>,
  defs: readonly ConditionalFieldDef<V, Extract<keyof V, string>>[],
): Set<string> {
  const hidden = new Set<string>()
  for (const def of defs) {
    if (!def.visibleWhen(values)) {
      for (const field of def.fields) hidden.add(field)
    }
  }
  return hidden
}

function hiddenFieldsKey(hiddenFields: Set<string>): string {
  return Array.from(hiddenFields).sort().join('|')
}

/** Derives which fields are currently hidden from the live watched form values. */
export function useConditionalFields<V>(
  values: Partial<V>,
  defs: readonly ConditionalFieldDef<V, Extract<keyof V, string>>[],
): { isVisible: (field: Extract<keyof V, string> | (string & {})) => boolean; hiddenFields: Set<string> } {
  const hiddenFields = computeHiddenFields(values, defs)
  return { isVisible: (field) => !hiddenFields.has(field), hiddenFields }
}

/**
 * Unregisters every currently-hidden field from react-hook-form whenever the hidden-field set
 * changes — the mechanism behind "hidden fields are excluded from validation and payload".
 * react-hook-form's default `unregister` options (`keepValue: false`, `keepError: false`) are
 * exactly what's wanted here: the value is dropped from the values object handleSubmit builds,
 * and any pending validation error for that field is cleared too.
 */
export function useUnregisterHiddenFields<V extends Record<string, unknown>>(
  unregister: UseFormUnregister<V>,
  hiddenFields: Set<string>,
): void {
  const key = hiddenFieldsKey(hiddenFields)
  useEffect(() => {
    if (hiddenFields.size === 0) return
    unregister(Array.from(hiddenFields) as never)
    // `key` is the hidden-field set as a stable string — the only thing this effect should
    // re-run on. `hiddenFields`/`unregister` are intentionally excluded: hiddenFields is a new
    // Set instance every render (re-including it would fire this every render), and unregister
    // is a stable function identity from react-hook-form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/**
 * Keeps reveal/hide accessible: if the field that just became hidden currently owns keyboard
 * focus, moves focus to its `focusFallback` instead of letting the browser drop it to `<body>`
 * when the focused node is removed from the DOM. See the module doc for why this needs a live
 * `focusin` listener rather than reading `document.activeElement` inside the effect.
 */
export function useFocusFallbackOnHide<V>(
  defs: readonly ConditionalFieldDef<V, Extract<keyof V, string>>[],
  hiddenFields: Set<string>,
): void {
  const lastFocusedId = useRef<string | null>(null)
  const prevHiddenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const handler = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && e.target.id) lastFocusedId.current = e.target.id
    }
    document.addEventListener('focusin', handler)
    return () => document.removeEventListener('focusin', handler)
  }, [])

  const key = hiddenFieldsKey(hiddenFields)
  useEffect(() => {
    const prevHidden = prevHiddenRef.current
    for (const def of defs) {
      if (!def.focusFallback) continue
      for (const field of def.fields) {
        const justHidden = hiddenFields.has(field) && !prevHidden.has(field)
        if (justHidden && lastFocusedId.current === field) {
          const fallback = document.getElementById(def.focusFallback)
          if (fallback instanceof HTMLElement) fallback.focus()
        }
      }
    }
    prevHiddenRef.current = new Set(hiddenFields)
    // See useUnregisterHiddenFields — `key` is the intentional, sole dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/**
 * Defence-in-depth companion to {@link useUnregisterHiddenFields}: strips hidden fields' keys from
 * an already-built payload object. Call it in `onSubmit` right before sending the payload —
 * `unregister` should already have dropped these keys from `data`, so this is normally a no-op,
 * but it makes the "excluded from payload" guarantee hold even if a payload is assembled in a way
 * that could reintroduce a stale key (e.g. spreading in a default/existing-record value).
 */
export function stripHiddenFieldKeys<T extends Record<string, unknown>>(payload: T, hiddenFields: Set<string>): T {
  if (hiddenFields.size === 0) return payload
  const copy: Record<string, unknown> = { ...payload }
  for (const field of hiddenFields) delete copy[field]
  return copy as T
}

/**
 * One value-derivation rule: default a field's value off a *different* field's value, as opposed
 * to a `ConditionalFieldDef`'s pure "show/hide". See the module doc's VALUE DERIVATION section for
 * the full semantics (transition-only firing, user-override survival, the `resetKey` re-baseline
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
