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
