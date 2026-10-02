import { describe, expect, it } from 'vitest'
import { DURATION, INITIAL, arrivedNow, dragProgress, step, visuals, type CrossingEvent, type CrossingState } from './crossing-machine'

const run = (events: CrossingEvent[], from: CrossingState = INITIAL) => events.reduce((s, e) => step(s, e), from)
const tick = (dt: number): CrossingEvent => ({ type: 'tick', dt })

describe('crossing state machine: waiting, crossing, arrived', () => {
  it('waits, then crosses once it enters view', () => {
    expect(INITIAL.phase).toBe('waiting')
    const s = run([{ type: 'enter' }])
    expect(s).toEqual({ phase: 'crossing', progress: 0, played: true, dragging: false })
  })

  it('does not move while waiting: ticks before entering view change nothing', () => {
    expect(run([tick(1), tick(1)])).toEqual(INITIAL)
  })

  it('advances with time and arrives after one duration, exactly at 1', () => {
    const half = run([{ type: 'enter' }, tick(DURATION / 2)])
    expect(half.phase).toBe('crossing')
    expect(half.progress).toBeCloseTo(0.5, 5)
    const done = run([{ type: 'enter' }, tick(DURATION / 2), tick(DURATION)])
    expect(done.phase).toBe('arrived')
    expect(done.progress).toBe(1)
  })

  it('plays once: entering view again after arriving does not replay it', () => {
    const arrived = run([{ type: 'enter' }, tick(DURATION)])
    expect(step(arrived, { type: 'enter' })).toBe(arrived)
  })

  it('replay starts the crossing again from the canopy side, from any phase', () => {
    for (const from of [INITIAL, run([{ type: 'enter' }, tick(1)]), run([{ type: 'enter' }, tick(DURATION)])]) {
      expect(step(from, { type: 'replay' })).toEqual({ phase: 'crossing', progress: 0, played: true, dragging: false })
    }
  })

  it('reduced motion shows the arrived state at once', () => {
    expect(step(INITIAL, { type: 'reduce' })).toEqual({ phase: 'arrived', progress: 1, played: true, dragging: false })
    expect(step(run([{ type: 'enter' }, tick(0.4)]), { type: 'reduce' }).phase).toBe('arrived')
  })

  it('a drag holds the crossing at the dragged progress; time does not move it while held', () => {
    const held = run([{ type: 'drag', progress: 0.3 }, tick(1)])
    expect(held).toEqual({ phase: 'crossing', progress: 0.3, played: true, dragging: true })
  })

  it('releasing a drag carries the crossing on to arrived (the record is never left half hidden)', () => {
    const released = run([{ type: 'drag', progress: 0.2 }, { type: 'release' }])
    expect(released.dragging).toBe(false)
    expect(released.phase).toBe('crossing')
    expect(run([tick(DURATION)], released).phase).toBe('arrived')
    expect(run([{ type: 'drag', progress: 1 }, { type: 'release' }]).phase).toBe('arrived')
  })

  it('a drag can pull an arrived crossing back, and a stray release does nothing', () => {
    const arrived = run([{ type: 'enter' }, tick(DURATION)])
    expect(step(arrived, { type: 'drag', progress: 0.1 }).phase).toBe('crossing')
    expect(step(arrived, { type: 'release' })).toBe(arrived)
  })

  it('clamps nonsense input', () => {
    expect(step(INITIAL, { type: 'drag', progress: 7 }).progress).toBe(1)
    expect(step(INITIAL, { type: 'drag', progress: Number.NaN }).progress).toBe(0)
    expect(run([{ type: 'enter' }, tick(-5)]).progress).toBe(0)
  })

  it('reports arrival once, on the step where the record lands', () => {
    const crossing = run([{ type: 'enter' }, tick(DURATION - 0.01)])
    const arrived = step(crossing, tick(0.02))
    expect(arrivedNow(crossing, arrived)).toBe(true)
    expect(arrivedNow(arrived, step(arrived, tick(1)))).toBe(false)
    expect(arrivedNow(INITIAL, step(INITIAL, { type: 'reduce' }))).toBe(true)
  })
})

describe('crossing visuals and drag', () => {
  it('waiting: nothing has left the canopy side; arrived: everything has landed and the seam is at rest', () => {
    expect(visuals(0)).toEqual({ carrier: 0, flare: 0, reveal: 0, settle: 0 })
    const end = visuals(1)
    expect(end.carrier).toBe(1)
    expect(end.reveal).toBe(1)
    expect(end.settle).toBe(1)
    expect(end.flare).toBeLessThan(1e-9)
  })

  it('the light reaches the seam before the record opens, and the caption settles last', () => {
    const mid = visuals(0.5)
    expect(mid.carrier).toBe(1)
    expect(mid.flare).toBeGreaterThan(0.8)
    expect(mid.reveal).toBeGreaterThan(0)
    expect(mid.settle).toBe(0)
    let last = visuals(0)
    for (let p = 0.05; p <= 1.0001; p += 0.05) {
      const v = visuals(p)
      expect(v.carrier).toBeGreaterThanOrEqual(last.carrier)
      expect(v.reveal).toBeGreaterThanOrEqual(last.reveal)
      expect(v.settle).toBeGreaterThanOrEqual(last.settle)
      last = v
    }
  })

  it('drag progress follows the pointer across the span, from where the drag began', () => {
    expect(dragProgress(0, 150, 300)).toBeCloseTo(0.5)
    expect(dragProgress(0.5, -300, 300)).toBe(0)
    expect(dragProgress(0.8, 400, 300)).toBe(1)
    expect(dragProgress(0.2, 10, 0)).toBe(1)
  })
})
