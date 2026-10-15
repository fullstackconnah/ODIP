import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useDeriveFieldValues, type FieldDerivationDef } from './conditionalFields'

// ── useDeriveFieldValues — value derivation (DIAG-02's engine extension point) ──────────────
// Deliberately generic field names ("source"/"derived"), not epilepsy/diagnosis-specific — this
// tests the reusable capability itself; the retired create-wizard's test suite covers the concrete
// epilepsy -> HIDPA consumer end to end.

type DerivedValues = { source?: string; derived?: string; other?: string }

const DERIVE_ON_TRIGGER: FieldDerivationDef<DerivedValues>[] = [
  { when: (v) => v.source === 'trigger', apply: (_v, setValue) => setValue('derived', 'defaulted') },
]

function DerivationHarness({ initialSource = '', resetKey }: { initialSource?: string; resetKey?: unknown }) {
  const { register, control, setValue } = useForm<DerivedValues>({
    defaultValues: { source: initialSource, derived: '', other: '' },
  })
  const watched = useWatch({ control })
  useDeriveFieldValues(watched, DERIVE_ON_TRIGGER, setValue, resetKey)

  return (
    <form>
      <select aria-label="Source" {...register('source')}>
        <option value="">none</option>
        <option value="trigger">trigger</option>
        <option value="elsewhere">elsewhere</option>
      </select>
      <input aria-label="Derived" {...register('derived')} />
      <input aria-label="Other" {...register('other')} />
    </form>
  )
}

describe('useDeriveFieldValues — transition-only firing', () => {
  it('fires apply on the false -> true transition of `when`', async () => {
    const user = userEvent.setup()
    render(<DerivationHarness />)

    expect(screen.getByLabelText('Derived')).toHaveValue('')
    await user.selectOptions(screen.getByLabelText('Source'), 'trigger')
    await waitFor(() => expect(screen.getByLabelText('Derived')).toHaveValue('defaulted'))
  })

  it('does NOT fire on mount even when `when` is already true at mount (the first run is the baseline, not a transition)', async () => {
    render(<DerivationHarness initialSource="trigger" />)

    // Give any (incorrect) mount-time fire a chance to happen before asserting it didn't.
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByLabelText('Derived')).toHaveValue('')
  })

  it('does NOT re-fire on every render while `when` stays true (typing in an unrelated field must not re-derive)', async () => {
    const user = userEvent.setup()
    render(<DerivationHarness />)

    await user.selectOptions(screen.getByLabelText('Source'), 'trigger')
    await waitFor(() => expect(screen.getByLabelText('Derived')).toHaveValue('defaulted'))

    await user.clear(screen.getByLabelText('Derived'))
    await user.type(screen.getByLabelText('Other'), 'unrelated edit')

    // `when` never transitioned again (source is still 'trigger') — the user's clear must survive.
    expect(screen.getByLabelText('Derived')).toHaveValue('')
  })

  it('a false -> true -> false -> true cycle re-fires apply on the second true transition (each transition is a fresh default)', async () => {
    const user = userEvent.setup()
    render(<DerivationHarness />)

    await user.selectOptions(screen.getByLabelText('Source'), 'trigger')
    await waitFor(() => expect(screen.getByLabelText('Derived')).toHaveValue('defaulted'))
    await user.clear(screen.getByLabelText('Derived'))

    await user.selectOptions(screen.getByLabelText('Source'), 'elsewhere') // when: false
    expect(screen.getByLabelText('Derived')).toHaveValue('') // untouched by the false transition

    await user.selectOptions(screen.getByLabelText('Source'), 'trigger') // when: false -> true again
    await waitFor(() => expect(screen.getByLabelText('Derived')).toHaveValue('defaulted'))
  })
})

describe('useDeriveFieldValues — user override survives (default, not a lock)', () => {
  it('a user-cleared derived value is never silently restored while `when` remains true', async () => {
    const user = userEvent.setup()
    render(<DerivationHarness />)

    await user.selectOptions(screen.getByLabelText('Source'), 'trigger')
    await waitFor(() => expect(screen.getByLabelText('Derived')).toHaveValue('defaulted'))

    await user.clear(screen.getByLabelText('Derived'))
    await user.type(screen.getByLabelText('Derived'), 'user value')

    expect(screen.getByLabelText('Derived')).toHaveValue('user value')
  })
})

describe('useDeriveFieldValues — generic capability (no field-specific knowledge)', () => {
  it('works against arbitrary def field names supplied by the caller, proving the hook itself carries no domain knowledge', async () => {
    const user = userEvent.setup()
    const customDefs: FieldDerivationDef<DerivedValues>[] = [
      { when: (v) => v.other === 'go', apply: (_v, setValue) => setValue('derived', 'custom-derived') },
    ]

    function CustomHarness() {
      const { register, control, setValue } = useForm<DerivedValues>({ defaultValues: { source: '', derived: '', other: '' } })
      const watched = useWatch({ control })
      useDeriveFieldValues(watched, customDefs, setValue)
      return (
        <form>
          <input aria-label="Other" {...register('other')} />
          <input aria-label="Derived" {...register('derived')} />
        </form>
      )
    }

    render(<CustomHarness />)
    await user.type(screen.getByLabelText('Other'), 'go')
    await waitFor(() => expect(screen.getByLabelText('Derived')).toHaveValue('custom-derived'))
  })
})

describe('useDeriveFieldValues — resetKey re-baselines without firing apply (edit-mode safe)', () => {
  // Mirrors exactly how the retired single-step wizard wires this: an "existing" record that starts
  // undefined (create mode / fetch not yet resolved) and later lands with real data via reset() —
  // the SAME update that both changes `source` to a triggering value AND changes resetKey's
  // identity must not fire `apply`, since that's loaded data, not a user's edit.
  function EditModeHarness({ existing }: { existing: DerivedValues | undefined }) {
    const { register, control, setValue, reset } = useForm<DerivedValues>({
      defaultValues: { source: '', derived: '', other: '' },
    })
    const watched = useWatch({ control })
    useDeriveFieldValues(watched, DERIVE_ON_TRIGGER, setValue, existing)

    useEffect(() => {
      if (existing) reset({ source: existing.source, derived: existing.derived ?? '', other: '' })
    }, [existing, reset])

    return (
      <form>
        <select aria-label="Source" {...register('source')}>
          <option value="">none</option>
          <option value="trigger">trigger</option>
          <option value="elsewhere">elsewhere</option>
        </select>
        <input aria-label="Derived" {...register('derived')} />
      </form>
    )
  }

  it('loading existing data whose source is already "trigger" does not force the derived value on, even if the saved record left it deliberately unset', async () => {
    const { rerender } = render(<EditModeHarness existing={undefined} />)
    expect(screen.getByLabelText('Derived')).toHaveValue('')

    // Simulates the fetch resolving with a record that already has the "derive" state, and whose
    // saved derived value was left blank (e.g. a user previously unticked it) — must NOT be
    // silently re-defaulted just because loading it looks, to the hook, like a transition.
    rerender(<EditModeHarness existing={{ source: 'trigger', derived: '' }} />)

    await waitFor(() => expect(screen.getByLabelText('Source')).toHaveValue('trigger'))
    expect(screen.getByLabelText('Derived')).toHaveValue('')
  })

  it('after the baseline re-sync, a genuine later user transition still derives normally', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<EditModeHarness existing={undefined} />)
    rerender(<EditModeHarness existing={{ source: 'trigger', derived: '' }} />)
    await waitFor(() => expect(screen.getByLabelText('Source')).toHaveValue('trigger'))
    expect(screen.getByLabelText('Derived')).toHaveValue('')

    await user.selectOptions(screen.getByLabelText('Source'), 'elsewhere') // when: false
    await user.selectOptions(screen.getByLabelText('Source'), 'trigger') // when: false -> true — a real user transition

    await waitFor(() => expect(screen.getByLabelText('Derived')).toHaveValue('defaulted'))
  })
})
