import { describe, expect, it } from 'vitest'
import {
  CALM,
  FULL_GUST,
  MAX_DPR,
  canvasSize,
  damp,
  leafLayers,
  packRects,
  pickVisible,
  rampToward,
  renderScale,
  stepBreeze,
  visibleArea,
  type Breeze,
} from './canopy-math'

describe('canopy field: render size', () => {
  it('renders at about half resolution, and about a third on coarse pointers or narrow screens', () => {
    expect(renderScale(1440, false)).toBe(0.5)
    expect(renderScale(1440, true)).toBe(0.35)
    expect(renderScale(390, false)).toBe(0.35)
    expect(renderScale(768, false)).toBe(0.5)
  })

  it('drops a leaf layer in low power, never below three', () => {
    expect(leafLayers(1920, false)).toBe(4)
    expect(leafLayers(390, true)).toBe(3)
    expect(leafLayers(1024, true)).toBe(3)
  })

  it('caps the device pixel ratio at 2 and never sizes the canvas to zero', () => {
    expect(MAX_DPR).toBe(2)
    expect(canvasSize(1440, 900, 1, 0.5)).toEqual({ width: 720, height: 450 })
    expect(canvasSize(390, 844, 3, 0.35)).toEqual({ width: 273, height: 591 })
    expect(canvasSize(1920, 1080, 2, 0.5)).toEqual({ width: 1920, height: 1080 })
    expect(canvasSize(0, 0, Number.NaN, 0.5)).toEqual({ width: 1, height: 1 })
  })
})

describe('canopy field: the pointer is a breeze with inertia', () => {
  const run = (from: Breeze, path: Array<{ x: number; y: number } | null>, dt = 1 / 60) =>
    path.reduce<Breeze>((b, p) => stepBreeze(b, p, dt), from)

  it('damp is frame-rate independent: two half steps equal one whole step', () => {
    const whole = damp(6, 0.1)
    const half = damp(6, 0.05)
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(whole, 10)
    expect(damp(6, 0)).toBe(0)
  })

  it('first sight of the pointer places the breeze there, calm', () => {
    const b = stepBreeze(CALM, { x: 300, y: 200 }, 1 / 60)
    expect(b).toEqual({ x: 300, y: 200, vx: 0, vy: 0, energy: 0 })
  })

  it('trails a moving pointer and gathers energy from its speed', () => {
    let b = stepBreeze(CALM, { x: 0, y: 300 }, 1 / 60)
    for (let i = 1; i <= 20; i++) b = stepBreeze(b, { x: i * 40, y: 300 }, 1 / 60) // 2400 px/s
    expect(b.x).toBeLessThan(800)
    expect(b.x).toBeGreaterThan(400)
    expect(b.vx).toBeGreaterThan(0)
    expect(b.energy).toBeGreaterThan(0.5)
    expect(b.energy).toBeLessThanOrEqual(1)
    expect(FULL_GUST).toBeGreaterThan(0)
  })

  it('settles slowly once the pointer stops or leaves (the leaves flutter, then settle)', () => {
    let b = stepBreeze(CALM, { x: 0, y: 0 }, 1 / 60)
    for (let i = 1; i <= 20; i++) b = stepBreeze(b, { x: i * 40, y: 0 }, 1 / 60)
    const gust = b.energy
    const afterQuarter = run(b, Array(15).fill(null))
    expect(afterQuarter.energy).toBeLessThan(gust)
    expect(afterQuarter.energy).toBeGreaterThan(gust * 0.5)
    const later = run(b, Array(240).fill(null))
    expect(later.energy).toBeLessThan(0.01)
  })

  it('ignores a zero or broken frame time', () => {
    const b: Breeze = { x: 1, y: 2, vx: 3, vy: 4, energy: 0.5 }
    expect(stepBreeze(b, { x: 100, y: 100 }, 0)).toBe(b)
    expect(stepBreeze(b, null, Number.NaN)).toBe(b)
  })
})

describe('canopy field: light pools and quiet zones from the page', () => {
  const r = (x: number, y: number, w: number, h: number) => ({ rect: { x, y, w, h } })

  it('measures how much of a rectangle shows in the viewport, with a margin', () => {
    expect(visibleArea({ x: 0, y: 0, w: 100, h: 100 }, 1000, 800)).toBe(10000)
    expect(visibleArea({ x: -50, y: 0, w: 100, h: 100 }, 1000, 800)).toBe(5000)
    expect(visibleArea({ x: 0, y: 900, w: 100, h: 100 }, 1000, 800)).toBe(0)
    expect(visibleArea({ x: 0, y: 900, w: 100, h: 100 }, 1000, 800, 150)).toBe(5000)
  })

  it('keeps the rectangles that show most, at most the slots available, in page order', () => {
    const items = [r(0, -500, 100, 100), r(0, 0, 100, 50), r(0, 100, 100, 400), r(0, 600, 100, 100), r(0, 2000, 10, 10)]
    // areas in view: items[1] 5,000, items[2] 40,000, items[3] 10,000; the other two are off screen
    const picked = pickVisible(items, 1000, 800, 2)
    expect(picked).toEqual([items[2], items[3]])
    expect(pickVisible(items, 1000, 800, 10).length).toBe(3)
    expect(pickVisible([r(0, 0, 0, 100)], 1000, 800, 6)).toEqual([])
  })

  it('packs rectangles into vec4 slots and leaves the rest zero', () => {
    const packed = packRects([{ x: 1, y: 2, w: 3, h: 4 }, { x: 5, y: 6, w: 7, h: 8 }], 3)
    expect(Array.from(packed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0])
    expect(packRects([{ x: 1, y: 1, w: 1, h: 1 }], 0).length).toBe(0)
  })

  it('ramps a pool up as its clearing arrives and lets it fade when it leaves', () => {
    expect(rampToward(0, 1, 0.6, 1.2, 0.8)).toBeCloseTo(0.5)
    expect(rampToward(0.9, 1, 1, 1.2, 0.8)).toBe(1)
    expect(rampToward(1, 0, 0.4, 1.2, 0.8)).toBeCloseTo(0.5)
    expect(rampToward(0.3, 1, 0.1, 0, 0)).toBe(1)
    expect(rampToward(0.5, 0.5, 1, 1, 1)).toBe(0.5)
  })
})
