import type { ReactNode } from 'react'
import { attentionOf, toneOf } from '@/lib/tone'
import { FactChip, type FactBarAttention, type FactBarSegment, type FactChipTone } from './FactBar'

/**
 * The attention tint a badge tone asks for, or `undefined` for a quiet segment. The tint is the tone's own family:
 * `warning` (pending, time-bound: Waitlist) -> the warning-container, `negative` (action needed, outstanding) ->
 * the error-container. `positive` and `neutral` never tint: an all-clear is the lime chip, never a fill. The mapping is
 * `attentionOf` in lib/tone.ts (The Attention Tint Rule); this only resolves the chip's older tone words first.
 *
 * Kept out of FactBar.tsx because that file exports components, and react-refresh wants component files to export
 * only components.
 */
export function attentionForTone(tone: FactChipTone): FactBarAttention | undefined {
  return attentionOf(toneOf(tone))
}

/**
 * The ONE spelling of an "x / y" figure in a glance strip: a space each side of the slash. Build every ratio through
 * this (Participants / Staff, High Support / Overnight, Insurance ...) so two figures at display size can never drift
 * apart, "12 / 10" beside "12/14". It only joins the two parts; the caller decides what a missing count means.
 */
export function glanceRatio(numerator: number | string, denominator: number | string): string {
  return `${numerator} / ${denominator}`
}

/**
 * One tone decides both the chip and the segment tint of a `FactBar variant="glance"` segment, so the fill can
 * never disagree with the badge it holds. Spread the result into the segment:
 *
 *   { label: 'Outstanding Tasks', value: 2, icon, ...glanceState('negative', 'Action Needed') }
 */
export function glanceState(tone: FactChipTone, label: ReactNode): Pick<FactBarSegment, 'badge' | 'attention'> {
  const attention = attentionForTone(tone)
  return {
    attention,
    badge: (
      <FactChip tone={tone} onTint={attention !== undefined}>
        {label}
      </FactChip>
    ),
  }
}
