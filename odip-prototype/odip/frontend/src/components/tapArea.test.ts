import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { TAP_AREA, TAP_AREA_LINKS, TAP_FLOOR, TAP_ICON_SQUARE, TAP_TRUNCATED_LINK } from './tapArea'

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

// The floor is the other half of the 44px story: a standalone link that has a line to itself grows to
// --tap-min instead of getting a pad, so it needs no neighbour spacing and can not be clipped.
describe('TAP_FLOOR — the coarse-pointer height floor for a standalone link', () => {
  const classes = TAP_FLOOR.split(/\s+/)

  it('floors the height with --tap-min and centres the content in it', () => {
    expect(classes).toEqual(expect.arrayContaining(['pointer-coarse:inline-flex', 'min-h-[var(--tap-min)]', 'pointer-coarse:items-center']))
  })

  it('switches display and alignment only under a coarse pointer, so a mouse keeps the plain inline link box for box', () => {
    // min-height is 0px on a mouse (--tap-min), so it needs no prefix; `inline-flex` would turn a 19px inline
    // link into a 20px flex box, which is a (harmless) geometry change on desktop that the prefix avoids.
    expect(classes).not.toContain('inline-flex')
    expect(classes).not.toContain('items-center')
    expect(classes.filter(c => /^(inline-flex|items-center|flex)$/.test(c))).toEqual([])
  })

  it('never hard-codes the 44px, and never adds a pseudo-element or a position', () => {
    expect(TAP_FLOOR).not.toMatch(/\d+px/)
    expect(TAP_FLOOR).not.toMatch(/before:|after:|relative|absolute/)
  })
})

// DataTable writes this once on every body <td>, so a caller's `render: row => <Link>` needs nothing. It is a single class,
// `tap-area-links`, a Tailwind `@utility` in index.css: TAP_AREA for a descendant `a`, all of it inside
// `@media (pointer: coarse)`, so on a mouse it does not even set `position`. One class instead of ten arbitrary variants
// because every table cell carries it (ten were ~730 characters of `class` per cell).
describe('TAP_AREA_LINKS — TAP_AREA for every link inside a table cell', () => {
  // The working copy may have CRLF line endings (Windows checkout); the assertions below are written against LF.
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf-8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  const utility = css.match(/@utility tap-area-links\s*\{([\s\S]*?)\n\}\n/)?.[1] ?? ''
  const rule = (selector: string) => utility.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))?.[1] ?? ''

  it('is one class, so a table cell carries one name and not ten arbitrary-variant classes', () => {
    expect(TAP_AREA_LINKS).toBe('tap-area-links')
    expect(TAP_AREA_LINKS.split(/\s+/)).toHaveLength(1)
  })

  it('is defined as a utility in index.css (the test finds it, so the assertions below cannot pass on an empty match)', () => {
    expect(utility).toContain('@media (pointer: coarse)')
  })

  it('does nothing at all to a mouse: every rule sits inside @media (pointer: coarse)', () => {
    const outside = utility.replace(/@media \(pointer: coarse\)\s*\{[\s\S]*\}\s*$/, '').trim()
    expect(outside).toBe('')
  })

  it('makes each descendant link `position: relative`, the containing block of its pad', () => {
    expect(rule('& a')).toMatch(/position:\s*relative/)
  })

  it('is TAP_AREA for the link: a transparent ::before centred on it, max(100%, --tap-min) each way', () => {
    const pad = rule('& a::before')
    expect(pad).toMatch(/content:\s*''/)
    expect(pad).toMatch(/position:\s*absolute/)
    expect(pad).toMatch(/left:\s*50%/)
    expect(pad).toMatch(/top:\s*50%/)
    expect(pad).toMatch(/width:\s*max\(100%,\s*var\(--tap-min\)\)/)
    expect(pad).toMatch(/height:\s*max\(100%,\s*var\(--tap-min\)\)/)
    expect(pad).toMatch(/translate:\s*-50%\s+-50%/)
  })

  it('takes its 44px from --tap-min like TAP_AREA does, never hard-coded, and paints nothing', () => {
    expect(utility).not.toMatch(/\d+px/)
    expect(utility).not.toMatch(/(background|border|box-shadow|outline|opacity|color)\s*:/)
  })
})

// A link that truncates has `overflow: hidden`, which clips its own ::before pad, so the DataTable's TAP_AREA_LINKS
// cannot make it 44px. From md up, on touch only, it takes vertical padding computed from the token instead.
describe('TAP_TRUNCATED_LINK — vertical padding for a truncating link', () => {
  it('applies only from md up and only under a coarse pointer', () => {
    expect(TAP_TRUNCATED_LINK.startsWith('md:pointer-coarse:py-')).toBe(true)
    expect(TAP_TRUNCATED_LINK.split(/\s+/)).toHaveLength(1)
  })

  it('computes the padding from --tap-min and a text-sm line (1.25rem), so the link box is exactly --tap-min tall', () => {
    expect(TAP_TRUNCATED_LINK).toBe('md:pointer-coarse:py-[calc((var(--tap-min)_-_1.25rem)_/_2)]')
    // (44px - 20px) / 2 = 12px each side; a 20px line + 24px = 44px.
    expect(TAP_TRUNCATED_LINK).not.toMatch(/\d+px/)
  })

  it('uses no pseudo-element: a padded box is part of the link, so overflow cannot clip it', () => {
    expect(TAP_TRUNCATED_LINK).not.toMatch(/before:|after:/)
  })
})

// The touch shape of a small icon control in a row cluster: the --control-h-sm square (36px) with the icon centred, and
// TAP_AREA's 44px pad on top. Shared by ActionButtons and the hand-rolled clusters on the trip detail Bookings / Staff tabs.
describe('TAP_ICON_SQUARE — a small icon control on touch', () => {
  const classes = TAP_ICON_SQUARE.split(/\s+/)

  it('carries every TAP_AREA class, so a tap within 44px lands on the control', () => {
    for (const c of TAP_AREA.split(/\s+/)) expect(classes).toContain(c)
  })

  it('becomes the --control-h-sm square with the icon centred, under a coarse pointer only', () => {
    expect(classes).toEqual(expect.arrayContaining([
      'pointer-coarse:inline-flex', 'pointer-coarse:size-[var(--control-h-sm)]', 'pointer-coarse:items-center',
      'pointer-coarse:justify-center', 'pointer-coarse:p-0',
    ]))
    // Nothing unprefixed sets a size, a display or a padding: a mouse keeps whatever the caller gave it (p-1 / p-1.5).
    for (const c of classes.filter(x => !x.startsWith('before:') && x !== 'relative')) expect(c.startsWith('pointer-coarse:')).toBe(true)
  })

  it('takes both sizes from tokens, never hard-coded', () => {
    expect(TAP_ICON_SQUARE).not.toMatch(/\d+px/)
    expect(TAP_ICON_SQUARE).toContain('before:min-h-[var(--tap-min)]')
  })
})
