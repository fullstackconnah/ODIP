// Pure maths behind the landing page's scroll motion, kept apart from the DOM so it can be tested.

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/** Smoothstep: eases in and out, so the middle of the range carries most of the change. */
export function smoothstep(t: number): number {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

/**
 * How far a fold has opened: 0 fully folded, 1 flat.
 * A fold starts opening as its top edge enters the bottom of the viewport (100%) and is flat once it reaches 45%.
 * Smoothstep spreads the angle across that whole scroll, so the sheet is still visibly folded (about 25 degrees
 * of a 58 degree peak) when its brown sign is fully on screen at 70%, and nearly flat at the reading line (60%).
 */
export function unfoldAmount(top: number, viewportHeight: number): number {
  const start = viewportHeight
  const end = viewportHeight * 0.45
  return smoothstep((start - top) / (start - end))
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

/** How far through the tour section the viewport has travelled, 0 as it enters to 1 as it leaves. Drives the landscape drift. */
export function sectionProgress(top: number, height: number, viewportHeight: number): number {
  return clamp01((viewportHeight - top) / (height + viewportHeight))
}
