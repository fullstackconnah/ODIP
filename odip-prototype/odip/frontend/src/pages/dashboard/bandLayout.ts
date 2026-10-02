// How the needs-attention band deals its tiles into rows: balanced, with no hole in any row, for any number of tiles at any width. Pure and JSX-free.
//
// Only the items that need somebody are tiles, so how many there are changes with the day (1 to 10). The band is a size container, so its rows follow its OWN
// width (the 232px sidebar and the pointer's gutter do not matter): from the narrowest to the widest a row holds up to 1, 2, 3, 4 and 5 tiles, opening at
// band widths of 36rem, 56rem, 72rem and 96rem (the `@min-[…]` steps of BAND_SPAN_CLASS: 390 and 360 phones get 1, a 768 tablet 2, 1280 gets 3, 1440 gets 4
// and 1920 gets 5). With n tiles and r to a row the band takes ceil(n / r) rows and deals the tiles out evenly (7 tiles at 4 a row are 4 + 3, not 4 + 3
// alone in a corner), and the tiles of a row span equal shares of it, so every row is full and its tiles are as wide as one another. The shares are counted
// in 60 tracks, the least number every row length from 1 to 5 divides: a row of 4 spans 15 each, of 3 spans 20, of 5 spans 12. Nothing truncates, scrolls
// sideways or shrinks the type.
//
// The 8px between tiles is padding (4px on each side of every tile, the grid pulled out by the same 4px so the outer edges stay on the page's), not a grid
// gap: a column gap sits between EVERY pair of tracks, so 60 tracks would add 59 of them, 472px that no phone has.
import type { CSSProperties } from 'react'

export const BAND_TRACKS = 60

/** The most tiles a row holds at each step of the band's width, narrowest first. */
export const BAND_PER_ROW = [1, 2, 3, 4, 5] as const

// Full class strings, so Tailwind can see them. The band is a 60-track grid; each tile spans `--span-N` tracks at step N (set per tile by bandTileStyles),
// and the steps are the band's own width (the container query), not the viewport's.
export const BAND_GRID_CLASS = '-mx-1 grid grid-cols-60 gap-y-2'
export const BAND_SPAN_CLASS =
  'px-1 col-span-(--span-0) @min-[36rem]:col-span-(--span-1) @min-[56rem]:col-span-(--span-2) @min-[72rem]:col-span-(--span-3) @min-[96rem]:col-span-(--span-4)'

/** How `count` tiles divide into rows of at most `perRow`: as even as whole tiles allow, the longer rows first ([4, 3] for 7 at 4, [3, 2] for 5 at 3). */
export function rowSizes(count: number, perRow: number): number[] {
  if (count <= 0) return []
  const rows = Math.ceil(count / perRow)
  const base = Math.floor(count / rows)
  const longer = count % rows
  return Array.from({ length: rows }, (_, row) => base + (row < longer ? 1 : 0))
}

/** For each tile, in order, how many tracks it spans at every step of BAND_PER_ROW. */
export function bandSpans(count: number): number[][] {
  const bySteps = BAND_PER_ROW.map((perRow) => rowSizes(count, perRow).flatMap((size) => Array<number>(size).fill(BAND_TRACKS / size)))
  return Array.from({ length: count }, (_, tile) => bySteps.map((spans) => spans[tile]))
}

/** The inline style of each tile: its span at every step, as the custom properties BAND_SPAN_CLASS reads. */
export function bandTileStyles(count: number): CSSProperties[] {
  return bandSpans(count).map((spans) => Object.fromEntries(spans.map((span, step) => [`--span-${step}`, span])) as CSSProperties)
}
