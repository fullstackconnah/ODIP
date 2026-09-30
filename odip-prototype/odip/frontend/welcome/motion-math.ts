// Pure maths behind the landing page's scroll motion, kept apart from the DOM so it can be tested.

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/** Exponential-style ease-out: fast start, gentle landing. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 3)
}

/**
 * How far a fold has opened: 0 fully folded, 1 flat.
 * A fold starts opening as its top edge enters the bottom of the viewport (98%) and is flat by the time it reaches 42%.
 */
export function unfoldAmount(top: number, viewportHeight: number): number {
  const start = viewportHeight * 0.98
  const end = viewportHeight * 0.42
  return easeOutCubic((start - top) / (start - end))
}

/** How much of a fold the reading line has passed, 0 to 1. Draws the route line down the page. */
export function routeFill(top: number, height: number, readingLine: number): number {
  if (height <= 0) return 0
  return clamp01((readingLine - top) / height)
}

/** The odometer: `total` km at the head of the strip counting down to 0 km at its foot. */
export function kmAt(progress: number, total = 60): number {
  return Math.round(total * (1 - clamp01(progress)))
}

/** Index of the fold the reading line is inside, or -1 when it is above or below the strip. */
export function currentFold(rects: Array<{ top: number; bottom: number }>, readingLine: number): number {
  return rects.findIndex((r) => r.top <= readingLine && r.bottom > readingLine)
}
