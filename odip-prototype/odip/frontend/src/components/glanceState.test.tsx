import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { attentionForTone, glanceRatio, glanceState } from './glanceState'
import { FactBar, type FactBarSegment, type FactChipTone } from './FactBar'

describe('glanceRatio — the one spelling of an "x / y" figure', () => {
  it('puts a space each side of the slash, so "12 / 14" and "5 / 3" can never be "12/14"', () => {
    expect(glanceRatio(12, 14)).toBe('12 / 14')
    expect(glanceRatio(5, 3)).toBe('5 / 3')
  })

  it('keeps zeros and joins strings the same way', () => {
    expect(glanceRatio(0, 0)).toBe('0 / 0')
    expect(glanceRatio('4', 5)).toBe('4 / 5')
  })

  it.each([[0, 1], [7, 7], [12, 10], [100, 250]])('is always exactly "n / m" for %i, %i (never a bare slash)', (a, b) => {
    expect(glanceRatio(a, b)).toMatch(/^\d+ \/ \d+$/)
  })
})

describe('attentionForTone — which badge tones tint a segment', () => {
  it.each([
    ['warning', 'warning'],
    ['negative', 'error'],
  ] as const)('%s asks for the %s tint (the tone\'s own container family)', (tone, attention) => {
    expect(attentionForTone(tone)).toBe(attention)
  })

  it.each(['positive', 'neutral'] as const)('%s stays quiet: an all-clear is a lime chip, never a fill', tone => {
    expect(attentionForTone(tone)).toBeUndefined()
  })
})

describe('glanceState — one tone decides the chip and the tint', () => {
  it('returns the tint and a chip on it for an attention tone', () => {
    const { attention, badge } = glanceState('warning', 'Waitlist')
    expect(attention).toBe('warning')
    render(<>{badge}</>)
    // On a tinted segment the chip is a card-white pill carrying the tone's text colour.
    expect(screen.getByText('Waitlist')).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-on-warning-container)]')
  })

  it('returns no tint and a chip in its own colours for a quiet tone', () => {
    const { attention, badge } = glanceState('positive', 'On Track')
    expect(attention).toBeUndefined()
    render(<>{badge}</>)
    expect(screen.getByText('On Track')).toHaveClass('bg-[var(--color-primary-fixed)]', 'text-[var(--color-on-primary-fixed)]')
  })

  it('cannot disagree with itself: every tone yields a chip legible on the fill it asks for', () => {
    const tones: FactChipTone[] = ['positive', 'warning', 'negative', 'neutral']
    for (const tone of tones) {
      const { attention, badge } = glanceState(tone, `chip-${tone}`)
      const { unmount } = render(<>{badge}</>)
      const chip = screen.getByText(`chip-${tone}`)
      if (attention) {
        // Tinted segment: the chip must not be tone-on-tone.
        expect(chip.className).not.toMatch(/bg-\[var\(--color-(warning|error)-container\)\]/)
      } else {
        expect(chip.className).not.toMatch(/bg-\[var\(--color-card\)\]/)
      }
      unmount()
    }
  })

  it('spreads straight into a FactBar segment and tints exactly that segment', () => {
    const segments: FactBarSegment[] = [
      { label: 'Outstanding Tasks', value: 2, ...glanceState('negative', 'Action Needed') },
      { label: 'Insurance', value: '5/5', ...glanceState('positive', 'Covered') },
    ]
    const { container } = render(<FactBar variant="glance" segments={segments} />)
    const [tinted, quiet] = Array.from((container.firstElementChild as HTMLElement).children)
    expect(tinted).toHaveAttribute('data-attention', 'error')
    expect(tinted).toHaveClass('bg-[var(--color-error-container)]')
    expect(quiet).not.toHaveAttribute('data-attention')
    expect(quiet.className).not.toMatch(/bg-\[/)
  })
})
