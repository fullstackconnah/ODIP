const MARK = { filled: 'rf-filled', open: 'rf-open rf-hatch' } as const

/** A legend key for an area mark: a 12x12 swatch wearing the mark's own classes, so its colour (and the forced-colours rows) are the mark's. */
export function ChartKey({ mark, label }: { mark: keyof typeof MARK; label: string }) {
  return (
    <span data-legend={mark} className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
      <span aria-hidden="true" className={`block h-3 w-3 shrink-0 ${MARK[mark]}`} />
      {label}
    </span>
  )
}
