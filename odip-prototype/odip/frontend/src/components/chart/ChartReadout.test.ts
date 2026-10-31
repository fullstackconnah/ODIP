import { describe, expect, it } from 'vitest'
import { readoutLeft } from './ticks'

describe('readoutLeft', () => {
  it('sits 12px right of the point, and flips left when it would run off the chart', () => {
    expect(readoutLeft(100, 700, 200, false)).toBe(112)
    expect(readoutLeft(600, 700, 200, false)).toBe(388)
  })
  it('stays inside [0, W - readoutW] at both edges', () => {
    expect(readoutLeft(0, 150, 200, false)).toBe(0)
    expect(readoutLeft(10, 700, 200, false)).toBeGreaterThanOrEqual(0)
    expect(readoutLeft(699, 700, 200, false)).toBeLessThanOrEqual(500)
  })
  it('narrow: takes the side away from the point', () => {
    expect(readoutLeft(250, 300, 150, true)).toBe(0)
    expect(readoutLeft(50, 300, 150, true)).toBe(150)
  })
})
