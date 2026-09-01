import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWizard, REVIEW_STEP_KEY } from './useWizard'
import type { UseWizardOptions, WizardFieldError, WizardStepDef } from './types'

type V = { a: string; b: string; c: string; d: string }

function step(key: string, fields: (keyof V)[] = []): WizardStepDef<V> {
  return { key, label: key, fields }
}

function makeOptions(overrides: Partial<UseWizardOptions<V>> = {}): UseWizardOptions<V> {
  return {
    steps: [step('a'), step('b'), step('c')],
    initialVisited: 'linear',
    validate: () => null,
    getValues: () => ({ a: '', b: '', c: '', d: '' }),
    setError: vi.fn(),
    clearErrors: vi.fn(),
    ...overrides,
  }
}

// Every non-reshuffle test below builds its `options` object ONCE, outside the render callback,
// and passes that same stable reference into `useWizard` on every render — exactly the contract
// CORE-01 places on a real caller ("steps... typically via useMemo"). Calling `makeOptions()`
// fresh inside the render callback itself would hand the hook a brand-new `steps` array identity
// on every re-render, which is indistinguishable (by design — see useWizard.ts) from a genuinely
// reshuffled list and would loop forever re-triggering the render-phase clamp.
describe('useWizard', () => {
  it('starts on the first step with stepIndex 0', () => {
    const options = makeOptions()
    const { result } = renderHook(() => useWizard(options))
    expect(result.current.currentStep.key).toBe('a')
    expect(result.current.stepIndex).toBe(0)
    expect(result.current.isReviewStep).toBe(false)
  })

  describe('visitedSteps seeding', () => {
    it('"linear" seeds only the first step key', () => {
      const options = makeOptions({ initialVisited: 'linear' })
      const { result } = renderHook(() => useWizard(options))
      expect(result.current.visitedSteps).toEqual(new Set(['a']))
    })

    it('"all" seeds every step key plus the review pseudo-step', () => {
      const options = makeOptions({ initialVisited: 'all' })
      const { result } = renderHook(() => useWizard(options))
      expect(result.current.visitedSteps).toEqual(new Set(['a', 'b', 'c', REVIEW_STEP_KEY]))
    })
  })

  describe('key-based state across a reshuffled step list', () => {
    it('survives a step being inserted above the current one — position is derived, not stored', async () => {
      const { result, rerender } = renderHook((opts: UseWizardOptions<V>) => useWizard(opts), {
        initialProps: makeOptions({ initialVisited: 'all' }),
      })

      act(() => result.current.goToStep('b'))
      expect(result.current.currentStep.key).toBe('b')
      expect(result.current.stepIndex).toBe(1)

      // Insert a new step between 'a' and 'b'.
      rerender(makeOptions({ initialVisited: 'all', steps: [step('a'), step('x'), step('b'), step('c')] }))

      // Still on 'b' — but its derived index has moved from 1 to 2.
      expect(result.current.currentStep.key).toBe('b')
      expect(result.current.stepIndex).toBe(2)
    })

    it('clamps to the nearest remaining step (by last-known position) when the current step is removed', () => {
      const { result, rerender } = renderHook((opts: UseWizardOptions<V>) => useWizard(opts), {
        initialProps: makeOptions({ initialVisited: 'all', steps: [step('a'), step('b'), step('c'), step('d')] }),
      })

      act(() => result.current.goToStep('c')) // index 2
      expect(result.current.currentStep.key).toBe('c')

      // Remove 'c' and 'd' entirely.
      rerender(makeOptions({ initialVisited: 'all', steps: [step('a'), step('b')] }))

      // lastKnownIndex was 2; clamped to steps[min(2, length-1=1)] = steps[1] = 'b'.
      expect(result.current.currentStep.key).toBe('b')
      expect(result.current.stepIndex).toBe(1)
    })

    it('does not throw and does not disturb visitedSteps for unrelated steps when the list shrinks', () => {
      const { result, rerender } = renderHook((opts: UseWizardOptions<V>) => useWizard(opts), {
        initialProps: makeOptions({ initialVisited: 'all', steps: [step('a'), step('b'), step('c')] }),
      })

      act(() => result.current.goToStep('c'))
      expect(() =>
        rerender(makeOptions({ initialVisited: 'all', steps: [step('a')] })),
      ).not.toThrow()

      expect(result.current.currentStep.key).toBe('a')
      // 'b' and 'c' remain in visitedSteps even though they're gone from `steps` — stale entries
      // are harmless by construction.
      expect(result.current.visitedSteps.has('b')).toBe(true)
      expect(result.current.visitedSteps.has('c')).toBe(true)
    })

    it('a step re-added later is immediately clickable again if it was ever visited, with no re-visit required', () => {
      const { result, rerender } = renderHook((opts: UseWizardOptions<V>) => useWizard(opts), {
        initialProps: makeOptions({ initialVisited: 'all', steps: [step('a'), step('b'), step('c')] }),
      })

      act(() => result.current.goToStep('c'))
      rerender(makeOptions({ initialVisited: 'all', steps: [step('a'), step('b')] })) // 'c' vanishes
      act(() => result.current.goToStep('a'))
      rerender(makeOptions({ initialVisited: 'all', steps: [step('a'), step('b'), step('c')] })) // 'c' reappears

      act(() => result.current.goToStep('c'))
      expect(result.current.currentStep.key).toBe('c')
    })
  })

  describe('validate gating handleNext', () => {
    it('a synchronous validator advances the step unchanged', async () => {
      const validate = vi.fn(() => null)
      const options = makeOptions({ validate })
      const { result } = renderHook(() => useWizard(options))

      await act(async () => {
        await result.current.handleNext()
      })

      expect(validate).toHaveBeenCalledTimes(1)
      expect(result.current.currentStep.key).toBe('b')
      expect(result.current.visitedSteps.has('b')).toBe(true)
    })

    it('an async validator blocks Next while pending and exposes isAdvancing', async () => {
      let resolveValidate!: (value: WizardFieldError[] | null) => void
      const validate = vi.fn(
        () => new Promise<WizardFieldError[] | null>((resolve) => { resolveValidate = resolve }),
      )
      const options = makeOptions({ validate })
      const { result } = renderHook(() => useWizard(options))

      let nextPromise!: Promise<void>
      act(() => {
        nextPromise = result.current.handleNext()
      })
      expect(result.current.isAdvancing).toBe(true)
      expect(result.current.currentStep.key).toBe('a') // not advanced yet

      await act(async () => {
        resolveValidate(null)
        await nextPromise
      })

      expect(result.current.isAdvancing).toBe(false)
      expect(result.current.currentStep.key).toBe('b')
    })

    it('blocks handleNext and reports every field error when validation fails', async () => {
      const setError = vi.fn()
      const onValidationFailed = vi.fn()
      const errors: WizardFieldError[] = [
        { path: 'b', message: 'B is required', code: 'too_small' },
        { path: 'c', message: 'C is required', code: 'too_small' },
      ]
      const validate = vi.fn(() => errors)
      const options = makeOptions({ validate, setError, onValidationFailed })
      const { result } = renderHook(() => useWizard(options))

      await act(async () => {
        await result.current.handleNext()
      })

      expect(result.current.currentStep.key).toBe('a') // unchanged
      expect(result.current.visitedSteps.has('b')).toBe(false)
      expect(setError).toHaveBeenCalledTimes(2)
      expect(setError).toHaveBeenNthCalledWith(1, 'b', { type: 'too_small', message: 'B is required' })
      expect(onValidationFailed).toHaveBeenCalledWith('b')
    })

    it('advancing past the last step lands on the review pseudo-step', async () => {
      const options = makeOptions({ steps: [step('a')] })
      const { result } = renderHook(() => useWizard(options))

      await act(async () => {
        await result.current.handleNext()
      })

      expect(result.current.isReviewStep).toBe(true)
      expect(result.current.visitedSteps.has(REVIEW_STEP_KEY)).toBe(true)
    })
  })

  describe('handleInvalidSubmit', () => {
    it('jumps to the step owning the first errored field and marks it visited', () => {
      const onValidationFailed = vi.fn()
      const options = makeOptions({
        steps: [step('a', ['a']), step('b', ['b']), step('c', ['c'])],
        onValidationFailed,
      })
      const { result } = renderHook(() => useWizard(options))

      act(() => result.current.handleInvalidSubmit({ c: { message: 'bad' } }))

      expect(result.current.currentStep.key).toBe('c')
      expect(result.current.visitedSteps.has('c')).toBe(true)
      expect(onValidationFailed).toHaveBeenCalledWith('c')
    })

    it('still resolves correctly after the step list has been reshuffled', () => {
      const { result, rerender } = renderHook((opts: UseWizardOptions<V>) => useWizard(opts), {
        initialProps: makeOptions({ steps: [step('a', ['a']), step('b', ['b']), step('c', ['c'])] }),
      })

      rerender(makeOptions({ steps: [step('c', ['c']), step('a', ['a']), step('b', ['b'])] }))

      act(() => result.current.handleInvalidSubmit({ b: { message: 'bad' } }))

      expect(result.current.currentStep.key).toBe('b')
      expect(result.current.stepIndex).toBe(2)
    })
  })

  describe('handleBack', () => {
    it('moves to the previous step by position', async () => {
      const options = makeOptions({ initialVisited: 'all' })
      const { result } = renderHook(() => useWizard(options))
      act(() => result.current.goToStep('c'))
      act(() => result.current.handleBack())
      expect(result.current.currentStep.key).toBe('b')
    })

    it('from the review step, returns to the last real step', async () => {
      const options = makeOptions({ steps: [step('a'), step('b')] })
      const { result } = renderHook(() => useWizard(options))
      await act(async () => { await result.current.handleNext() })
      await act(async () => { await result.current.handleNext() })
      expect(result.current.isReviewStep).toBe(true)
      act(() => result.current.handleBack())
      expect(result.current.currentStep.key).toBe('b')
      expect(result.current.isReviewStep).toBe(false)
    })
  })

  describe('goToStep', () => {
    it('no-ops for a key not in visitedSteps', () => {
      const options = makeOptions({ initialVisited: 'linear' })
      const { result } = renderHook(() => useWizard(options))
      act(() => result.current.goToStep('c'))
      expect(result.current.currentStep.key).toBe('a')
    })
  })
})
