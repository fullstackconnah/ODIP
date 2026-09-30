/**
 * The coarse-pointer hit area: density spec §1 says a 36px row action gets "hit area padded to 44px"
 * on a touch screen without growing, and this is that padding, written once.
 *
 * A transparent `::before`, absolutely positioned and centred on the control, sized
 * `max(100%, var(--tap-min))`. `--tap-min` is 0px on a fine pointer, so there the pseudo-element is
 * exactly the control's own box: it paints nothing, adds no hit area and moves no neighbour, and the
 * desktop look is untouched. Under `pointer: coarse` it is 44px, so a tap in the padding lands on the
 * control itself (the pseudo-element belongs to it, so the event target is the control) while the
 * control keeps its visual size and its place in the layout.
 *
 * Rules for callers (each one bit somebody while this was built):
 * - `relative` is part of the class list: do not give the same element another `position`.
 * - The pad reaches (44 - visual size) / 2 past each edge. Two padded controls, or a padded control and
 *   a neighbouring one, must sit at least that far apart under coarse, or the pads overlap and the top
 *   one steals the other's taps. Widen the gap for `pointer-coarse:` only (`RowActions` does).
 * - An `overflow-hidden` / `overflow-auto` ancestor clips the pad. A hover-reveal wrapper that clips its
 *   contents needs `pointer-coarse:overflow-visible`.
 * - Use it only where the control is content-sized and short (a row link, an icon). A control that
 *   already has a `--tap-min` floor (Tabs, the detail-page table links) does not need it.
 */
export const TAP_AREA =
  'relative before:absolute before:left-1/2 before:top-1/2 before:h-full before:w-full before:min-h-[var(--tap-min)] before:min-w-[var(--tap-min)] before:-translate-x-1/2 before:-translate-y-1/2'

/**
 * The other way to reach 44px on touch: a `--tap-min` FLOOR instead of TAP_AREA's transparent pad. For a
 * standalone, content-sized link that has a line of its own ("View All", "← Back to Trips", a "View" beside a
 * row of text): under `pointer: coarse` the link itself is 44px tall and centres its content in that height;
 * on a mouse `--tap-min` is 0px and nothing changes. The `inline-flex` (which `min-height` needs, an inline box
 * ignores it) and the centring are `pointer-coarse:` too, so a mouse keeps the plain inline link, box for box.
 * Unlike the pad the floor adds real layout height on touch (up to ~25px for a 19px link), so it needs no
 * neighbour spacing, and it can never be clipped by an `overflow` ancestor. Use the pad where growing the box
 * would move things (a 36px row action inside a 48px row, a link in a wrapping flex card); use the floor where
 * the link is alone and the extra height is welcome.
 */
export const TAP_FLOOR = 'pointer-coarse:inline-flex min-h-[var(--tap-min)] pointer-coarse:items-center'

/**
 * TAP_AREA for every link inside a table body cell, written once on the `<td>` (DataTable does it), so a caller's
 * `render: row => <Link to=…>` gets the 44px hit area without knowing about it. It is TAP_AREA spelled out under
 * `pointer-coarse:` and `[&_a]:` — Tailwind only emits whole class names it can read, so it cannot be derived
 * from TAP_AREA at runtime — and being `pointer-coarse:` it does not even set `position` on a mouse, so the
 * desktop table is byte-for-byte what it was. The pad is `max(100%, --tap-min)` centred on the link: a 19px
 * name link reaches 12px past its text above and below, inside the 48px coarse row; a link narrower than 44px
 * (an "Open") is widened to 44px. Same caveats as TAP_AREA: an `overflow-hidden` link (`truncate`) clips its own pad,
 * so such a link takes vertical padding instead (see the Incidents and Participants name links).
 */
export const TAP_AREA_LINKS = [
  'pointer-coarse:[&_a]:relative',
  'pointer-coarse:[&_a]:before:absolute',
  'pointer-coarse:[&_a]:before:left-1/2',
  'pointer-coarse:[&_a]:before:top-1/2',
  'pointer-coarse:[&_a]:before:h-full',
  'pointer-coarse:[&_a]:before:w-full',
  'pointer-coarse:[&_a]:before:min-h-[var(--tap-min)]',
  'pointer-coarse:[&_a]:before:min-w-[var(--tap-min)]',
  'pointer-coarse:[&_a]:before:-translate-x-1/2',
  'pointer-coarse:[&_a]:before:-translate-y-1/2',
].join(' ')

/**
 * For a table-cell link that TRUNCATES (`md:truncate`, so `overflow: hidden`): it clips its own TAP_AREA pad, which
 * is why the Incidents and Participants name links were still 20px tall on a touch tablet. From md up (the widths
 * where the table is a table and the link truncates), under a coarse pointer, such a link takes vertical padding
 * instead: a `text-sm` line is 1.25rem, so (--tap-min - 1.25rem) / 2 each side makes the link box itself 44px, inside
 * the 48px coarse row, and padding is part of the box, so nothing clips it. Below md the same links do not truncate
 * and TAP_AREA_LINKS already reaches 44px. Nothing changes on a mouse.
 */
export const TAP_TRUNCATED_LINK = 'md:pointer-coarse:py-[calc((var(--tap-min)_-_1.25rem)_/_2)]'
