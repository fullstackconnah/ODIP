import { describe, expect, it } from 'vitest'
import { BAND_GRID_CLASS, BAND_PER_ROW, BAND_SPAN_CLASS, BAND_TRACKS, bandSpans, bandTileStyles, rowSizes } from './bandLayout'

// The band can hold from 1 to 10 tiles (only the items that need somebody are tiles), and at every width its rows must be full: no hole in a row, the same
// share for every tile of a row, and the rows as even as whole tiles allow.
const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

describe('rowSizes: how n tiles divide into rows of at most r', () => {
  it.each([
    [1, 5, [1]],
    [3, 5, [3]],
    [5, 5, [5]],
    [6, 5, [3, 3]],
    [7, 5, [4, 3]],
    [9, 5, [5, 4]],
    [4, 4, [4]],
    [5, 4, [3, 2]],
    [7, 4, [4, 3]],
    [8, 4, [4, 4]],
    [9, 4, [3, 3, 3]],
    [4, 3, [2, 2]],
    [5, 3, [3, 2]],
    [7, 3, [3, 2, 2]],
    [3, 2, [2, 1]],
    [7, 2, [2, 2, 2, 1]],
    [7, 1, [1, 1, 1, 1, 1, 1, 1]],
  ])('%i tiles, %i to a row: %j', (count, perRow, expected) => {
    expect(rowSizes(count, perRow)).toEqual(expected)
  })

  it('gives nothing for no tiles', () => {
    expect(rowSizes(0, 3)).toEqual([])
  })

  it('never overfills a row, never leaves a row more than one tile shorter than another, and always accounts for every tile', () => {
    for (const count of COUNTS) {
      for (const perRow of BAND_PER_ROW) {
        const sizes = rowSizes(count, perRow)
        expect(sizes.reduce((a, b) => a + b, 0), `${count} at ${perRow}`).toBe(count)
        expect(Math.max(...sizes), `${count} at ${perRow}`).toBeLessThanOrEqual(perRow)
        expect(Math.max(...sizes) - Math.min(...sizes), `${count} at ${perRow}`).toBeLessThanOrEqual(1)
        expect([...sizes].sort((a, b) => b - a), `${count} at ${perRow}`).toEqual(sizes) // longer rows first
      }
    }
  })
})

describe('bandSpans: each tile\'s share of its row, in 60 tracks, at every step', () => {
  it('gives every tile the whole row on a phone and a few worked examples at the other steps', () => {
    // 7 tiles by step: 1 a row = 1+1+1+1+1+1+1; 2 a row = 2+2+2+1; 3 a row = 3+2+2; 4 a row = 4+3; 5 a row = 4+3 again.
    const spans = bandSpans(7)
    expect(spans[0]).toEqual([60, 30, 20, 15, 15]) // the first tile: in a row of 1, 2, 3, 4 and 4
    expect(spans[3]).toEqual([60, 30, 30, 15, 15]) // the fourth: in a row of 1, 2, 2, 4 and 4
    expect(spans[6]).toEqual([60, 60, 30, 20, 20]) // the last: in a row of 1, then alone, then 2, 3 and 3
  })

  it('fills every row exactly: the spans of consecutive tiles add up to the 60 tracks of one row, with no hole and no overflow, for 1 to 10 tiles at every step', () => {
    for (const count of COUNTS) {
      const spans = bandSpans(count)
      expect(spans).toHaveLength(count)
      for (let step = 0; step < BAND_PER_ROW.length; step++) {
        let used = 0
        for (let tile = 0; tile < count; tile++) {
          const span = spans[tile][step]
          expect(Number.isInteger(span), `${count} tiles, tile ${tile}, step ${step}`).toBe(true)
          used += span
          expect(used, `${count} tiles, tile ${tile}, step ${step}`).toBeLessThanOrEqual(BAND_TRACKS)
          if (used === BAND_TRACKS) used = 0
        }
        expect(used, `${count} tiles leave a row unfinished at step ${step}`).toBe(0)
      }
    }
  })

  it('keeps the tiles of one row the same width as one another', () => {
    for (const count of COUNTS) {
      const spans = bandSpans(count)
      for (let step = 0; step < BAND_PER_ROW.length; step++) {
        const sizes = rowSizes(count, BAND_PER_ROW[step])
        let tile = 0
        for (const size of sizes) {
          const row = spans.slice(tile, tile + size).map((s) => s[step])
          expect(new Set(row).size, `${count} tiles, step ${step}, row of ${size}`).toBe(1)
          tile += size
        }
      }
    }
  })

  it('is empty for no tiles', () => {
    expect(bandSpans(0)).toEqual([])
  })
})

describe('bandTileStyles: the spans as the custom properties the span classes read', () => {
  it('sets one custom property per step on every tile', () => {
    expect(bandTileStyles(2)).toEqual([
      { '--span-0': 60, '--span-1': 30, '--span-2': 30, '--span-3': 30, '--span-4': 30 },
      { '--span-0': 60, '--span-1': 30, '--span-2': 30, '--span-3': 30, '--span-4': 30 },
    ])
  })

  it('gives a lone tile the whole row at every width', () => {
    expect(bandTileStyles(1)).toEqual([{ '--span-0': 60, '--span-1': 60, '--span-2': 60, '--span-3': 60, '--span-4': 60 }])
  })
})

describe('the classes the layout is written in', () => {
  it('is a 60-track grid with NO column gap: 59 gaps of 8px would overflow a phone, so the 8px between tiles is padding, with the grid pulled out to match', () => {
    expect(BAND_GRID_CLASS).toBe('-mx-1 grid grid-cols-60 gap-y-2')
    expect(BAND_GRID_CLASS).not.toMatch(/(?:^|\s)gap-(?:x-)?\d/)
    expect(BAND_SPAN_CLASS.split(' ')).toContain('px-1')
  })

  it('reads one span custom property per step, opening at the band\'s own width (a container query, not the viewport)', () => {
    const classes = BAND_SPAN_CLASS.split(' ')
    expect(classes).toContain('col-span-(--span-0)')
    expect(classes).toContain('@min-[36rem]:col-span-(--span-1)')
    expect(classes).toContain('@min-[56rem]:col-span-(--span-2)')
    expect(classes).toContain('@min-[72rem]:col-span-(--span-3)')
    expect(classes).toContain('@min-[96rem]:col-span-(--span-4)')
    expect(BAND_SPAN_CLASS).not.toMatch(/(?:^|\s)(?:sm|md|lg|xl|2xl):/)
  })

  it('has as many steps as the span classes read', () => {
    expect(BAND_PER_ROW).toHaveLength(5)
    expect(BAND_SPAN_CLASS.match(/col-span-\(--span-\d\)/g)).toHaveLength(BAND_PER_ROW.length)
  })
})
