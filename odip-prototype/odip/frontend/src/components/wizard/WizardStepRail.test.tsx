import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WizardStepRail } from './WizardStepRail'

const steps = [
  { key: 'a', label: 'Alpha', fields: [] },
  { key: 'b', label: 'Beta', fields: [] },
  { key: 'c', label: 'Gamma', fields: [] },
]

describe('WizardStepRail', () => {
  it('marks the current step with aria-current="step"', () => {
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a'])} currentKey="a" onSelect={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: /intake wizard steps/i })
    expect(within(nav).getByRole('button', { name: /alpha/i, current: 'step' })).toBeInTheDocument()
  })

  // The state classes were an object inside an array that was joined into a string, so the fills never reached the DOM ("[object Object]") and the current step looked
  // like every other: only aria-current said where you were. The fill is an opt-in now: the plan builder, the intake and the profile wizards ask for it; the incident and
  // the caregiver wizards, whose rail is a full-width stack from lg, stay as they are on main.
  describe('filled', () => {
    it('fills the current step, tints the finished ones and puts the rest on the plain accent, in the class list itself', () => {
      render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b', 'c'])} currentKey="b" onSelect={vi.fn()} filled />)

      const [alpha, beta, gamma] = screen.getAllByRole('button')
      expect(beta.className).toContain('bg-[var(--color-primary)] text-white')
      expect(alpha.className).toContain('bg-[var(--color-primary)]/10')
      expect(alpha.className).toContain('text-[var(--color-primary)]')
      expect(gamma.className).toContain('bg-[var(--color-accent)]')
      for (const pill of [alpha, beta, gamma]) expect(pill.className).not.toContain('[object Object]')
    })

    // The upcoming step the person cannot open yet was opacity-60 over the accent fill: its label was about 2.9:1. It keeps the full ink on a lighter fill.
    it('does not fade a step that cannot be opened yet: no opacity, the ink in full on a lighter fill', () => {
      render(<WizardStepRail steps={steps} visitedSteps={new Set(['a'])} currentKey="a" onSelect={vi.fn()} filled />)

      const [alpha, beta, gamma] = screen.getAllByRole('button')
      expect(beta).toBeDisabled()
      expect(gamma).toBeDisabled()
      for (const pill of [alpha, beta, gamma]) expect(pill.className).not.toMatch(/(^|\s)opacity-/)
      expect(beta.className).toContain('text-[var(--color-muted-foreground)]')
      expect(beta.className).toContain('bg-[var(--color-accent)]/40')
      expect(beta.className).toContain('cursor-not-allowed')
    })

    it("stands the focus ring off the pill, so the current step's ring is not the fill's own olive against itself (N4)", () => {
      render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={vi.fn()} filled />)

      for (const pill of screen.getAllByRole('button')) {
        expect(pill.className).toContain('focus-visible:ring-2')
        expect(pill.className).toContain('focus-visible:ring-offset-2')
      }
    })

    it("draws the current step's number in primary on white, not as the white veil it had", () => {
      render(<WizardStepRail steps={steps} visitedSteps={new Set(['a'])} currentKey="a" onSelect={vi.fn()} filled />)

      const bubble = screen.getByRole('button', { name: /alpha/i }).querySelector('span') as HTMLElement
      expect(bubble.className).toContain('bg-white text-[var(--color-primary)]')
      expect(bubble.className).not.toContain('bg-white/20')
    })

    // Read from the palette in index.css, as PlanVisuals does: the label of every state is 4.5:1 or better on the fill it sits on.
    describe('contrast of every state, read from the palette in index.css', () => {
      const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../index.css'), 'utf-8')
      const theme = css.slice(css.indexOf('@theme'), css.indexOf('}', css.indexOf('@theme')))
      const token = (name: string) => {
        const hex = new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})`).exec(theme)?.[1]
        if (!hex) throw new Error(`--color-${name} is not a six digit colour in index.css`)
        return [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16))
      }
      const luminance = ([r, g, b]: number[]) => [r, g, b].map(c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
      const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
      const over = (fg: number[], bg: number[], alpha: number) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha))
      const white = [255, 255, 255]

      it('reads 4.5:1 or better on the current, the finished, the upcoming and the not-yet-open step, over the page and over a card', () => {
        for (const surface of [token('background'), token('card'), white]) {
          expect(contrast(white, token('primary'))).toBeGreaterThanOrEqual(4.5) // current
          expect(contrast(token('primary'), over(token('primary'), surface, 0.1))).toBeGreaterThanOrEqual(4.5) // finished: primary on primary/10
          expect(contrast(token('muted-foreground'), token('accent'))).toBeGreaterThanOrEqual(4.5) // upcoming
          expect(contrast(token('muted-foreground'), over(token('accent'), surface, 0.4))).toBeGreaterThanOrEqual(4.5) // not yet open: accent/40
          expect(contrast(token('muted-foreground'), token('border'))).toBeGreaterThanOrEqual(4.5) // the number in an upcoming step's bubble
        }
        expect(contrast(token('primary'), white)).toBeGreaterThanOrEqual(4.5) // the current step's number
      })

      it('was under 3:1 with opacity-60 over the accent fill, which is why a step that cannot be opened is no longer faded', () => {
        const page = token('background')
        expect(contrast(over(token('muted-foreground'), page, 0.6), over(token('accent'), page, 0.6))).toBeLessThan(3)
      })
    })
  })

  // The incident and the caregiver wizards put the rail in the page flow, a full-width stack from lg; the fill there is a solid olive band, the loudest thing on a form
  // page. Without `filled` the rail is what it is on main: no fill on any state, the dimmed step still dimmed, and the number bubbles as they were.
  describe('not filled (the default, as on main)', () => {
    it('puts no fill on any state: not on the current step, the finished ones or the rest', () => {
      render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b', 'c'])} currentKey="b" onSelect={vi.fn()} />)

      for (const pill of screen.getAllByRole('button')) {
        expect(pill.className).not.toMatch(/(^|\s)bg-\[var\(--color-(primary|accent)\)\]/)
        expect(pill.className).not.toContain('text-white')
        expect(pill.className).not.toContain('ring-offset')
        expect(pill.className).not.toContain('[object Object]')
      }
    })

    it('still dims a step that cannot be opened yet, and still says which step is current with aria-current', () => {
      render(<WizardStepRail steps={steps} visitedSteps={new Set(['a'])} currentKey="a" onSelect={vi.fn()} />)

      expect(screen.getByRole('button', { name: /beta/i }).className).toContain('opacity-60')
      expect(screen.getByRole('button', { name: /alpha/i })).toHaveAttribute('aria-current', 'step')
      expect(screen.getByRole('button', { name: /alpha/i }).querySelector('span')?.className).toContain('bg-white/20')
    })
  })

  it('disables a pill whose key is not in visitedSteps', () => {
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a'])} currentKey="a" onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /gamma/i })).toBeDisabled()
  })

  it('calls onSelect with the clicked step key when the pill is visited', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: /beta/i }))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('keeps the rail inside its container while preserving an independently scrollable touch target', () => {
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={vi.fn()} />)

    const nav = screen.getByRole('navigation', { name: /intake wizard steps/i })
    expect(nav).toHaveClass('relative', 'w-full', 'min-w-0', 'max-w-full', '[contain:inline-size]', 'overflow-x-auto', 'touch-pan-x')
    expect(within(nav).getByRole('list')).toHaveClass('w-max', 'min-w-full')
  })

  it('shows a visible current-step summary while retaining every full step label in button names', () => {
    const nineSteps = Array.from({ length: 9 }, (_, index) => ({
      key: `step-${index + 1}`,
      label: `Step label ${index + 1}`,
      fields: [],
    }))
    render(<WizardStepRail steps={nineSteps} visitedSteps={new Set(['step-1', 'step-2'])} currentKey="step-2" onSelect={vi.fn()} />)

    expect(screen.getByText('Step 2 of 9')).toBeVisible()
    for (const step of nineSteps) {
      expect(screen.getByRole('button', { name: new RegExp(step.label) })).toBeInTheDocument()
    }
  })

  it('keeps visited buttons keyboard-operable while unvisited steps stay disabled', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={onSelect} />)

    await user.tab()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('a')
    expect(screen.getByRole('button', { name: /gamma/i })).toBeDisabled()
  })

  // L5-10: the label was hard-coded "Intake wizard steps", so every wizard announced itself as the intake. A wizard names itself with `ariaLabel`;
  // the default is still the intake's name (see the prop's note), so the Intake and Profile wizards' own tests keep passing.
  it('names the nav with the wizard’s own name through ariaLabel, and not "Intake" when it is not the intake', () => {
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a'])} currentKey="a" onSelect={vi.fn()} ariaLabel="Incident report steps" />)

    expect(screen.getByRole('navigation', { name: 'Incident report steps' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /intake/i })).not.toBeInTheDocument()
  })

  it('still defaults to "Intake wizard steps" with orientation="vertical" too', () => {
    render(<WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={vi.fn()} orientation="vertical" />)

    expect(screen.getByRole('navigation', { name: /intake wizard steps/i })).toBeInTheDocument()
  })

  it('with orientation="vertical" the <ol> carries the vertical layout classes and the buttons keep their step-label accessible name', () => {
    render(
      <WizardStepRail
        steps={steps}
        visitedSteps={new Set(['a', 'b'])}
        currentKey="a"
        onSelect={vi.fn()}
        orientation="vertical"
      />,
    )

    const list = screen.getByRole('list')
    expect(list).toHaveClass('flex', 'flex-col', 'gap-2', 'w-full')
    // No horizontal-scrolling class on a vertical rail.
    expect(list).not.toHaveClass('w-max', 'min-w-full')

    // Every step button still has its full label as accessible name in vertical mode (no DOM
    // stripping of the label just because the layout changed).
    expect(screen.getByRole('button', { name: /alpha/i, current: 'step' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /beta/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /gamma/i })).toBeInTheDocument()
    // And no duplicate step buttons.
    expect(screen.getAllByRole('button', { name: /alpha/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /beta/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /gamma/i })).toHaveLength(1)
  })

  it('does not render duplicated step buttons in either orientation (single rendered nav at every width)', () => {
    const { rerender } = render(
      <WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={vi.fn()} orientation="horizontal" />,
    )
    expect(screen.getAllByRole('navigation', { name: /intake wizard steps/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /alpha/i })).toHaveLength(1)
    rerender(
      <WizardStepRail steps={steps} visitedSteps={new Set(['a', 'b'])} currentKey="a" onSelect={vi.fn()} orientation="vertical" />,
    )
    expect(screen.getAllByRole('navigation', { name: /intake wizard steps/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /alpha/i })).toHaveLength(1)
  })
})
