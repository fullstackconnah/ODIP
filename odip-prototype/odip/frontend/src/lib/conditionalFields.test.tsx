import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, useWatch } from 'react-hook-form'
import {
  computeHiddenFields, stripHiddenFieldKeys,
  useConditionalFields, useUnregisterHiddenFields, useFocusFallbackOnHide,
  type ConditionalFieldDef,
} from './conditionalFields'

// ── Pure functions: predicate show/hide, payload stripping ──────────────────

type Values = { toggle?: string; gated?: string; groupA?: string; groupB?: string; other?: string }

const SINGLE_DEF: ConditionalFieldDef<Values>[] = [
  { fields: ['gated'], visibleWhen: (v) => v.toggle === 'show' },
]

const GROUPED_DEFS: ConditionalFieldDef<Values>[] = [
  { fields: ['gated'], visibleWhen: (v) => v.toggle === 'show' },
  { fields: ['groupA', 'groupB'], visibleWhen: (v) => v.toggle !== 'show' },
]

describe('computeHiddenFields — predicate show/hide', () => {
  it('a field is hidden when its predicate is false', () => {
    const hidden = computeHiddenFields({ toggle: 'hide' }, SINGLE_DEF)
    expect(hidden.has('gated')).toBe(true)
  })

  it('a field is visible (not in the hidden set) when its predicate is true', () => {
    const hidden = computeHiddenFields({ toggle: 'show' }, SINGLE_DEF)
    expect(hidden.has('gated')).toBe(false)
  })

  it('a multi-field group is hidden/shown together as one unit', () => {
    const whenShown = computeHiddenFields({ toggle: 'show' }, GROUPED_DEFS)
    expect(whenShown.has('gated')).toBe(false)
    expect(whenShown.has('groupA')).toBe(true)
    expect(whenShown.has('groupB')).toBe(true)

    const whenHidden = computeHiddenFields({ toggle: 'other' }, GROUPED_DEFS)
    expect(whenHidden.has('gated')).toBe(true)
    expect(whenHidden.has('groupA')).toBe(false)
    expect(whenHidden.has('groupB')).toBe(false)
  })

  it('a field with no matching def is never hidden', () => {
    const hidden = computeHiddenFields({ toggle: 'hide' }, SINGLE_DEF)
    expect(hidden.has('other')).toBe(false)
  })
})

describe('stripHiddenFieldKeys — payload exclusion', () => {
  it('removes exactly the hidden fields, leaving everything else untouched', () => {
    const payload = { firstName: 'Jamie', gated: 'stale', other: 'x' }
    const result = stripHiddenFieldKeys(payload, new Set(['gated']))
    expect(result).toEqual({ firstName: 'Jamie', other: 'x' })
    expect('gated' in result).toBe(false)
  })

  it('is a no-op (same object reference) when nothing is hidden', () => {
    const payload = { firstName: 'Jamie' }
    const result = stripHiddenFieldKeys(payload, new Set())
    expect(result).toBe(payload)
  })
})

// ── React-hook-form integration: value exclusion + validation exclusion ─────
// A minimal harness mirroring how the wizard wires the engine: a toggle field
// controls whether `gated` (plain) and `requiredWhenVisible` (RHF `required` validation)
// render, backed by useConditionalFields + useUnregisterHiddenFields + useFocusFallbackOnHide.

const HARNESS_DEFS: ConditionalFieldDef<Values>[] = [
  { fields: ['gated'], visibleWhen: (v) => v.toggle === 'show', focusFallback: 'toggle' },
]

function Harness({ onSubmit, onInvalid }: { onSubmit: (data: Values) => void; onInvalid?: () => void }) {
  const { register, handleSubmit, control, unregister } = useForm<Values>({
    defaultValues: { toggle: 'hide', gated: '', other: 'x' },
  })
  const watched = useWatch({ control })
  const { isVisible, hiddenFields } = useConditionalFields(watched, HARNESS_DEFS)
  useUnregisterHiddenFields(unregister, hiddenFields)
  useFocusFallbackOnHide(HARNESS_DEFS, hiddenFields)

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
      <select id="toggle" {...register('toggle')}>
        <option value="hide">hide</option>
        <option value="show">show</option>
      </select>
      {isVisible('gated') && (
        <input id="gated" aria-label="Gated field" {...register('gated', { required: 'Gated is required' })} />
      )}
      <input id="other" aria-label="Other field" {...register('other')} />
      <button type="submit">Submit</button>
    </form>
  )
}

describe('useConditionalFields + useUnregisterHiddenFields — rendering', () => {
  it('a hidden field is not rendered at all (a real unmount, not CSS-hidden)', () => {
    render(<Harness onSubmit={vi.fn()} />)
    expect(screen.queryByLabelText('Gated field')).not.toBeInTheDocument()
  })

  it('toggling the predicate mounts the field', async () => {
    const user = userEvent.setup()
    render(<Harness onSubmit={vi.fn()} />)

    await user.selectOptions(screen.getByRole('combobox'), 'show')

    expect(screen.getByLabelText('Gated field')).toBeInTheDocument()
  })
})

describe('useUnregisterHiddenFields — value exclusion from the submit payload', () => {
  it('a value typed while visible is dropped once the field becomes hidden again', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    await user.selectOptions(screen.getByRole('combobox'), 'show')
    await user.type(screen.getByLabelText('Gated field'), 'typed value')
    await user.selectOptions(screen.getByRole('combobox'), 'hide')

    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const data = onSubmit.mock.calls[0][0]
    expect('gated' in data).toBe(false) // excluded entirely, not just falsy/empty
    expect(data.other).toBe('x') // untouched sibling field still present
  })

  it('a field left hidden the whole time never appears in the payload', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect('gated' in onSubmit.mock.calls[0][0]).toBe(false)
  })
})

describe('useUnregisterHiddenFields — validation exclusion', () => {
  it('a required-but-hidden field does not block submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onInvalid = vi.fn()
    render(<Harness onSubmit={onSubmit} onInvalid={onInvalid} />)

    // `gated` is required but hidden (toggle stays 'hide') — unregistering it must also drop
    // its validation rule, or this submit would be blocked.
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onInvalid).not.toHaveBeenCalled()
  })

  it('the same required field DOES block submit once visible and left empty', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onInvalid = vi.fn()
    render(<Harness onSubmit={onSubmit} onInvalid={onInvalid} />)

    await user.selectOptions(screen.getByRole('combobox'), 'show')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(onInvalid).toHaveBeenCalledTimes(1))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('useFocusFallbackOnHide — accessible reveal/hide (no focus loss)', () => {
  // Uses fireEvent (not userEvent.selectOptions) to change the toggle deliberately: userEvent
  // simulates the browser's own click-to-focus side effect on the element it interacts with,
  // which would move focus onto the toggle anyway and make these assertions pass regardless of
  // whether the engine's fallback logic does anything. fireEvent.change fires only the value
  // change react-hook-form listens for, leaving focus exactly where the test put it beforehand —
  // isolating the DOM-removal-steals-focus scenario the fallback exists to guard against.

  it('moves focus to focusFallback when the currently-focused field becomes hidden', async () => {
    render(<Harness onSubmit={vi.fn()} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'show' } })
    const gatedInput = await screen.findByLabelText('Gated field')
    gatedInput.focus()
    expect(gatedInput).toHaveFocus()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'hide' } })

    // Never falls through to <body> — lands on the def's focusFallback (the toggle select
    // itself, which is what the user just operated to trigger the hide in the first place).
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
  })

  it('does not steal focus from an unrelated field when a hide happens elsewhere', async () => {
    render(<Harness onSubmit={vi.fn()} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'show' } })
    await screen.findByLabelText('Gated field')
    const otherInput = screen.getByLabelText('Other field')
    otherInput.focus()
    expect(otherInput).toHaveFocus()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'hide' } })
    await waitFor(() => expect(screen.queryByLabelText('Gated field')).not.toBeInTheDocument())

    // The hidden field never owned focus, so focus must stay exactly where the user left it.
    expect(otherInput).toHaveFocus()
  })
})
