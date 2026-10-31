import { forwardRef, type ReactNode } from 'react'

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
