// Pure helpers for the canopy light field (canopy.ts): render size, the pointer breeze and its inertia,
// and the rectangles the shader reads (light pools round the paper clearings, quiet zones behind text).
// No DOM here, so every rule is unit-tested.

export const MAX_DPR = 2
/** Uniform slots in the shader: light pools, and quiet zones (content plus the fixed chrome). */
export const MAX_POOLS = 6
export const MAX_QUIET = 8

/** The field is soft by nature, so it renders small and the browser scales it up. */
export function renderScale(viewportWidth: number, coarsePointer: boolean): number {
  return coarsePointer || viewportWidth < 768 ? 0.35 : 0.5
}

/** Low power (coarse pointer or a narrow screen) drops the farthest layer of leaves. */
export function leafLayers(viewportWidth: number, coarsePointer: boolean): number {
  return coarsePointer || viewportWidth < 768 ? 3 : 4
}

export function canvasSize(cssWidth: number, cssHeight: number, devicePixelRatio: number, scale: number) {
  const dpr = Math.min(MAX_DPR, Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1))
  return {
    width: Math.max(1, Math.round(cssWidth * dpr * scale)),
    height: Math.max(1, Math.round(cssHeight * dpr * scale)),
  }
}

/** Frame-rate independent smoothing factor: how far to move toward a target in dt seconds at a given rate. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt))
}

export interface Breeze {
  /** Where the breeze is (CSS px), trailing the pointer. */
  x: number
  y: number
  /** Its velocity (CSS px per second), smoothed. */
  vx: number
  vy: number
  /** How hard it blows, 0 to 1: rises quickly as the pointer moves and dies away slowly, so leaves settle. */
  energy: number
}

export const CALM: Breeze = { x: -9999, y: -9999, vx: 0, vy: 0, energy: 0 }
/** Pointer speed (CSS px per second) that counts as a full gust. */
export const FULL_GUST = 1400

export function stepBreeze(b: Breeze, pointer: { x: number; y: number } | null, dt: number): Breeze {
  if (!(dt > 0)) return b
  if (!pointer) {
    const fade = damp(1.4, dt)
    return { ...b, vx: b.vx * (1 - fade), vy: b.vy * (1 - fade), energy: b.energy * (1 - fade) }
  }
  // The first sighting of the pointer places the breeze there instead of sweeping it in from off screen.
  const fresh = b.x < -9000
  const follow = fresh ? 1 : damp(10, dt)
  const x = b.x + (pointer.x - b.x) * follow
  const y = b.y + (pointer.y - b.y) * follow
  const mx = fresh ? 0 : (x - b.x) / dt
  const my = fresh ? 0 : (y - b.y) / dt
  const smooth = damp(6, dt)
  const vx = b.vx + (mx - b.vx) * smooth
  const vy = b.vy + (my - b.vy) * smooth
  const target = Math.min(1, Math.hypot(mx, my) / FULL_GUST)
  const energy = b.energy + (target - b.energy) * damp(target > b.energy ? 9 : 1.4, dt)
  return { x, y, vx, vy, energy }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Area of a rectangle inside the viewport grown by a margin on every side. */
export function visibleArea(r: Rect, viewportWidth: number, viewportHeight: number, margin = 0): number {
  const w = Math.min(r.x + r.w, viewportWidth + margin) - Math.max(r.x, -margin)
  const h = Math.min(r.y + r.h, viewportHeight + margin) - Math.max(r.y, -margin)
  return w > 0 && h > 0 ? w * h : 0
}

/** The (at most) max items whose rectangles show the most inside the viewport plus margin, in page order. */
export function pickVisible<T extends { rect: Rect }>(
  items: T[],
  viewportWidth: number,
  viewportHeight: number,
  max: number,
  margin = 0,
): T[] {
  const scored = items
    .map((item, order) => ({ item, order, area: item.rect.w > 0 && item.rect.h > 0 ? visibleArea(item.rect, viewportWidth, viewportHeight, margin) : 0 }))
    .filter((s) => s.area > 0)
  scored.sort((a, b) => b.area - a.area)
  return scored
    .slice(0, Math.max(0, max))
    .sort((a, b) => a.order - b.order)
    .map((s) => s.item)
}

/** Packs rectangles into a vec4 uniform array; unused slots stay zero, and the shader skips a zero width. */
export function packRects(rects: Rect[], slots: number): Float32Array {
  const out = new Float32Array(slots * 4)
  rects.slice(0, slots).forEach((r, i) => out.set([r.x, r.y, r.w, r.h], i * 4))
  return out
}

/** Moves a value toward a target at a fixed pace: up over riseSeconds, down over fallSeconds. */
export function rampToward(current: number, target: number, dt: number, riseSeconds: number, fallSeconds: number): number {
  if (current === target) return current
  const seconds = target > current ? riseSeconds : fallSeconds
  if (!(seconds > 0)) return target
  const stepSize = Math.max(0, dt) / seconds
  return target > current ? Math.min(target, current + stepSize) : Math.max(target, current - stepSize)
}
