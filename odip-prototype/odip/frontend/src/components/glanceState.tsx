import type { ReactNode } from 'react'
import { attentionOf, toneOf } from '@/lib/tone'
import { glanceRatio } from '@/lib/format'
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

// The glance strip's one spelling of an "x / y" figure is `formatRatio` in lib/format.ts (a space each side of the slash, so two figures at
// display size can never drift apart: "12 / 10" beside "12/14"). `glanceRatio` is its earlier name and stays exported from here.
export { glanceRatio }

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
