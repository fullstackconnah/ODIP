import { useEffect, useRef } from 'react'
import type { UseFormUnregister } from 'react-hook-form'

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
 * when `fundingSource === 'Other'`) — they're shown/hidden/unregistered as one unit. This is also
 * the intended extension point for the later waves INTAKE-07 is the umbrella for: diagnoses
 * gating (DIAG-02's epilepsy -> HIDPA default), living-arrangement fields (LIVING-01/02/03), and
 * service-specific inline fields (INTAKE-03) are all just more `ConditionalFieldDef` entries
 * against whatever values shape that step's form uses — no engine changes needed.
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
