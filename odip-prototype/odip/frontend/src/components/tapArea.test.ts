import { describe, it, expect } from 'vitest'
import { TAP_AREA } from './tapArea'

// TAP_AREA is the one place the spec's "hit area padded to 44px" (density spec §1) is written. jsdom has no
// layout, so these tests pin the class contract that produces the geometry in a browser: a transparent,
// centred ::before that is max(100%, --tap-min) each way, where --tap-min is 0px on a mouse (no change) and
// 44px under `pointer: coarse` (see the token block in index.css).
describe('TAP_AREA — the coarse-pointer hit-area pad', () => {
  const classes = TAP_AREA.split(/\s+/)

  it('positions a ::before absolutely against the control itself (`relative`)', () => {
    expect(classes).toContain('relative')
    expect(classes).toContain('before:absolute')
  })

  it('centres the pseudo-element on the control, so the pad reaches equally past every edge', () => {
    expect(classes).toEqual(expect.arrayContaining([
      'before:left-1/2', 'before:top-1/2', 'before:-translate-x-1/2', 'before:-translate-y-1/2',
    ]))
  })

  it('sizes it max(100%, --tap-min): full-size of the control, floored by the token', () => {
    expect(classes).toEqual(expect.arrayContaining([
      'before:h-full', 'before:w-full', 'before:min-h-[var(--tap-min)]', 'before:min-w-[var(--tap-min)]',
    ]))
  })

  it('never hard-codes the 44px: the floor comes from --tap-min, which is 0px on a mouse', () => {
    expect(TAP_AREA).not.toMatch(/\d+px/)
    expect(TAP_AREA).not.toMatch(/before:(?:min-)?[hw]-(?:11|\[44)/)
  })

  it('paints nothing: no background, border, ring or shadow on the pseudo-element', () => {
    for (const c of classes.filter(x => x.startsWith('before:'))) {
      expect(c).not.toMatch(/^before:(?:bg|border|ring|shadow|outline|opacity|content-\[)/)
    }
  })
})
