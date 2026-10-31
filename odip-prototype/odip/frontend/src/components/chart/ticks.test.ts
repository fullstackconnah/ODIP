import { describe, expect, it } from 'vitest'
import { countTicks } from './ticks'

describe('countTicks', () => {
  it.each([
    [1, 120, [0, 1, 2]],
    [3, 120, [0, 2, 4]],
    [24, 120, [0, 15, 30]],
    [0, 120, [0, 1, 2]],
  ])('max %d at plot height %d gives %j', (max, plotH, expected) => {
    expect(countTicks(max, plotH)).toEqual(expected)
  })

  it('uses four gaps from a 200px plot and only whole numbers', () => {
    const ticks = countTicks(10, 240)
    expect(ticks).toHaveLength(5)
    expect(ticks.every(Number.isInteger)).toBe(true)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(10)
  })

  it('always covers the largest count', () => {
    for (const max of [1, 2, 5, 7, 13, 48, 190, 1240]) {
      expect(countTicks(max, 120).at(-1)).toBeGreaterThanOrEqual(max)
    }
  })
})
