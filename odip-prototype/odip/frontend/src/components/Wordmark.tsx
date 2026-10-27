type WordmarkProps = {
  /** Font size in px; the gap and the dot scale with it. */
  size: number
  /** `dark` is for the wordmark on a dark (on-primary-fixed) panel. */
  tone?: 'light' | 'dark'
  className?: string
  /** The sidebar brand: marks the "b" as the part that glides into the rail tile and the rest as the part that folds into it. */
  fold?: boolean
}

/**
 * The Bunya Support wordmark (owner's chosen board, 2026-10-16): "bunya" 500 in ink, "support" 800 in olive, then a lime dot.
 * The lettering is lowercase and aria-hidden; assistive tech reads the product name, "Bunya Support".
 */
export function Wordmark({ size, tone = 'light', className = '', fold = false }: WordmarkProps) {
  const dark = tone === 'dark'
  return (
    <span className={`inline-flex ${className}`.trim()}>
      <span className="sr-only">Bunya Support</span>
      <span
        aria-hidden="true"
        className="inline-flex items-baseline whitespace-nowrap font-medium leading-none"
        style={{ fontFamily: 'var(--font-display)', fontSize: size, letterSpacing: '-0.04em', ...(fold && { position: 'relative' }), color: dark ? 'var(--color-background)' : 'var(--color-foreground)' }}
      >
        <span data-glide={fold ? 'brand-mark' : undefined} style={fold ? { transformOrigin: '0 0' } : undefined}>b</span>
        <span data-fold={fold ? 'word' : undefined} className="inline-flex items-baseline">
          unya
          <span className="font-extrabold" style={{ marginLeft: '0.18em', color: dark ? 'var(--color-primary-fixed)' : 'var(--color-primary)' }}>support</span>
          <svg viewBox="0 0 16 16" style={{ width: '0.3em', height: '0.3em', marginLeft: '0.12em' }}>
            <circle
              cx="8" cy="8" r={dark ? 7 : 6.5}
              style={{ fill: dark ? 'var(--color-primary-fixed)' : 'var(--wordmark-dot)', stroke: dark ? 'none' : 'var(--color-primary)', strokeWidth: 2 }}
            />
          </svg>
        </span>
      </span>
    </span>
  )
}
