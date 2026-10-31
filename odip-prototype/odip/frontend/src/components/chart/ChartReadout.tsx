import { forwardRef, type ReactNode } from 'react'

/** Where the floating readout's left edge goes: beside the point (12px off), flipped when it would run past the chart, and always inside [0, W - readoutW]. A narrow chart puts it on the side away from the point. */
export function readoutLeft(cx: number, W: number, readoutW: number, narrow: boolean): number {
  const left = narrow ? (cx > W / 2 ? 0 : W - readoutW) : cx + 12 + readoutW <= W ? cx + 12 : cx - 12 - readoutW
  return Math.min(Math.max(left, 0), Math.max(W - readoutW, 0))
}

/** The floating readout shell (a 12px header, then rows). It takes no pointer events, so the plot under it keeps tracking. */
export const ChartReadout = forwardRef<HTMLDivElement, { header: string; left: number; top: number; children: ReactNode; className?: string }>(
  function ChartReadout({ header, left, top, children, className = '' }, ref) {
    return (
      <div
        ref={ref}
        data-readout
        className={`${className} pointer-events-none absolute z-10 w-max whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--color-popover)] px-3 py-2 text-[var(--color-popover-foreground)] shadow-[var(--shadow-float)]`}
        style={{ left, top }}
      >
        <p data-readout-header className="text-xs text-[var(--color-muted-foreground)]">{header}</p>
        {children}
      </div>
    )
  },
)
