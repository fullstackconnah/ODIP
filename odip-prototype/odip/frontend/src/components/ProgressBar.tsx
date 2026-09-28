type ProgressBarProps = {
  /** Completed units. */
  value: number
  /** Total units. Rendered as a clamped fraction plus a segmented track. */
  total: number
  /** Accessible description of what the numbers mean, e.g. "3 of 5 gates". */
  label: string
  className?: string
}

/**
 * Compact progress indicator for onboarding worklist rows. Segments (not a
 * continuous bar) because the underlying model is discrete gates: a coordinator
 * reads "2 of 5 done", not "40%". Never colour-only: the numeric label is the
 * accessible name and stays visible next to the track.
 */
export function ProgressBar({ value, total, label, className = '' }: ProgressBarProps) {
  const safeTotal = Math.max(0, total)
  const safeValue = Math.min(Math.max(0, value), safeTotal)
  const segments = Array.from({ length: safeTotal }, (_, i) => i < safeValue)

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={safeValue}
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        className="flex gap-0.5"
      >
        {segments.map((filled, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`h-1.5 w-3 rounded-full ${filled ? 'bg-[var(--color-primary-fixed)]' : 'bg-[var(--color-surface-container)]'}`}
          />
        ))}
      </div>
      <span className="text-xs text-[var(--color-muted-foreground)] whitespace-nowrap">{label}</span>
    </div>
  )
}
