import { describe, expect, it } from 'vitest'
import { clamp01, currentFold, kmAt, routeFill, sectionProgress, smoothstep, unfoldAmount } from './motion-math'

const PEAK = 58 // degrees, as in welcome.css
const angle = (topFraction: number, vh = 900) => (1 - unfoldAmount(vh * topFraction, vh)) * PEAK

describe('motion maths', () => {
  it('clamps to 0..1', () => {
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(9)).toBe(1)
  })

  it('smoothstep eases in and out with fixed ends and a flat middle slope', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(1)).toBe(1)
    expect(smoothstep(0.5)).toBe(0.5)
    expect(smoothstep(0.25)).toBeLessThan(0.25)
    expect(smoothstep(0.75)).toBeGreaterThan(0.75)
  })

  it('a fold is folded below the viewport, flat once its top reaches 45% of the height, and never overshoots', () => {
    const vh = 900
    expect(unfoldAmount(vh, vh)).toBe(0)
    expect(unfoldAmount(vh * 1.2, vh)).toBe(0)
    expect(unfoldAmount(vh * 0.45, vh)).toBe(1)
    expect(unfoldAmount(-500, vh)).toBe(1)
    const samples = [0.95, 0.8, 0.65, 0.5, 0.45].map((f) => unfoldAmount(vh * f, vh))
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1])
  })

  it('keeps the sheet visibly folded while its sign arrives and nearly flat at the reading line (measured by the review)', () => {
    expect(angle(0.85)).toBeCloseTo(47.4, 0)
    expect(angle(0.7)).toBeCloseTo(25, 0)
    expect(angle(0.6)).toBeCloseTo(10.6, 0)
    expect(angle(0.5)).toBeLessThan(2)
    // the old curve was at 4 degrees by 70% of the viewport: the new one must be at least five times that
    expect(angle(0.7)).toBeGreaterThan(20)
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

  it('measures how far the viewport has travelled through the tour, for the landscape drift', () => {
    expect(sectionProgress(900, 4000, 900)).toBe(0)
    expect(sectionProgress(-4000, 4000, 900)).toBe(1)
    expect(sectionProgress(-1550, 4000, 900)).toBeCloseTo(0.5, 2)
    expect(sectionProgress(5000, 4000, 900)).toBe(0)
  })
})
