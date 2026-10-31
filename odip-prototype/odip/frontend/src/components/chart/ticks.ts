const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/** Whole-number y ticks from 0 for a count axis (shifts, people): 2 gaps under a 200px plot, else 4. The top tick covers `max` with the smallest whole step; a max of 0 still gets a 0-1-2 axis. */
export function countTicks(max: number, plotH: number): number[] {
  const gaps = plotH < 200 ? 2 : 4
  let step = 1
  for (let power = 1; ; power *= 10) {
    const found = STEPS.map(s => s * power).find(s => Number.isInteger(s) && s * gaps >= max)
    if (found) { step = found; break }
  }
  return Array.from({ length: gaps + 1 }, (_, i) => i * step)
}

/** Where the floating readout's left edge goes: beside the point (12px off), flipped when it would run past the chart, and always inside [0, W - readoutW]. A narrow chart puts it on the side away from the point. */
export function readoutLeft(cx: number, W: number, readoutW: number, narrow: boolean): number {
  const left = narrow ? (cx > W / 2 ? 0 : W - readoutW) : cx + 12 + readoutW <= W ? cx + 12 : cx - 12 - readoutW
  return Math.min(Math.max(left, 0), Math.max(W - readoutW, 0))
}
