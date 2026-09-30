import { describe, expect, it } from 'vitest'
import { clamp01, currentFold, easeOutCubic, kmAt, routeFill, unfoldAmount } from './motion-math'

describe('motion maths', () => {
  it('clamps to 0..1', () => {
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(9)).toBe(1)
  })

  it('eases out: fast start, gentle landing, fixed ends', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })

  it('a fold is folded below the viewport, flat once its top passes 42% of the height, and never overshoots', () => {
    const vh = 900
    expect(unfoldAmount(vh, vh)).toBe(0)
    expect(unfoldAmount(vh * 0.98, vh)).toBe(0)
    expect(unfoldAmount(vh * 0.42, vh)).toBe(1)
    expect(unfoldAmount(-500, vh)).toBe(1)
    const samples = [0.95, 0.8, 0.65, 0.5, 0.42].map((f) => unfoldAmount(vh * f, vh))
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1])
  })

  it('draws the route as the reading line passes a fold', () => {
    expect(routeFill(600, 500, 500)).toBe(0)
    expect(routeFill(400, 500, 650)).toBeCloseTo(0.5)
    expect(routeFill(0, 500, 900)).toBe(1)
    expect(routeFill(0, 0, 100)).toBe(0)
  })

  it('counts the odometer down from 60 km to 0 km', () => {
    expect(kmAt(-1)).toBe(60)
    expect(kmAt(0)).toBe(60)
    expect(kmAt(0.5)).toBe(30)
    expect(kmAt(1)).toBe(0)
    expect(kmAt(4)).toBe(0)
  })

  it('finds the fold under the reading line, or -1 outside the strip', () => {
    const rects = [
      { top: -400, bottom: 100 },
      { top: 100, bottom: 600 },
      { top: 600, bottom: 1100 },
    ]
    expect(currentFold(rects, 540)).toBe(1)
    expect(currentFold(rects, 600)).toBe(2)
    expect(currentFold(rects, 1200)).toBe(-1)
    expect(currentFold(rects, -500)).toBe(-1)
  })
})
