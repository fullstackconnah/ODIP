import { Link } from 'react-router-dom'
import { Card } from './Card'
import type { FactBarAttention, FactChipTone } from './FactBar'
import { attentionForTone, glanceState } from './glanceState'

export type StatCardTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/**
 * `default` (the default) is the small KPI tile: a 12px label over a `text-xl` value. `attention` is the opt-in tile of the
 * dashboard's attention band (DESIGN.md "Attention band"): the value is a display-step tabular figure, the tile is filled
 * with the same container tint the glance strip uses, and a tile at zero recedes. A StatCard that does not ask for it
 * renders exactly as before.
 */
export type StatCardVariant = 'default' | 'attention'

export type StatCardProps = {
  label: string
  value: string | number
  className?: string
  /** Renders the whole tile as a react-router Link (with a visible focus ring). */
  to?: string
  /**
   * Tints the tile and its value using existing colour tokens. Omitted / 'neutral' = untinted. In the `attention`
   * variant only `warning` and `danger` tint (exactly as the glance strip does); every other tone is a quiet tile.
   */
  tone?: StatCardTone
  /**
   * Optional small line under the value (e.g. "All clear"). In the `attention` variant it is the all-clear state, so a quiet
   * tile shows it as the lime positive chip the glance strip uses; a tinted tile shows it as plain text, never a lime chip
   * on a tint.
   */
  caption?: string
  variant?: StatCardVariant
  /**
   * `attention` variant only (the default tile ignores it): the value is not known yet. The tile shows an en dash in the muted
   * figure style with `aria-busy`, is never tinted, and shows no caption, so a request in flight is never read as a
   * definite zero.
   */
  loading?: boolean
}

// Tile background tint (applied with `!` because Card sets its own background) and value colour
// per tone. 'neutral' adds nothing, so a StatCard without `tone` renders exactly as before.
const TONE_TILE: Record<StatCardTone, string> = {
  neutral: '',
  info: '!bg-[var(--color-secondary-container)]/60',
  success: '!bg-[var(--color-primary-fixed)]/40',
  warning: '!bg-[var(--color-warning-container)]',
  danger: '!bg-[var(--color-error-container)]/30',
}

const TONE_VALUE: Record<StatCardTone, string> = {
  neutral: 'text-[var(--color-primary)]',
  info: 'text-[var(--color-info)]',
  success: 'text-[var(--color-primary)]',
  warning: 'text-[var(--color-on-warning-container)]',
  danger: 'text-[var(--color-destructive)]',
}

function DefaultStatCard({ label, value, className, to, tone = 'neutral', caption }: StatCardProps) {
  // Tiles that carry a link, tint or caption sit in dense KPI rows where a long label must not
  // wrap and change the row height; plain tiles keep their original (wrapping) label.
  const dense = !!to || tone !== 'neutral' || !!caption
  const body = (
    <Card compact className={`${TONE_TILE[tone]} ${className ?? ''}`.trim() || undefined}>
      <p className={`${dense ? 'truncate ' : ''}text-xs font-medium text-[var(--color-muted-foreground)]`}>{label}</p>
      <p className={`text-xl font-display font-bold ${TONE_VALUE[tone]}`}>{value}</p>
      {caption && <p className="text-xs text-[var(--color-muted-foreground)]">{caption}</p>}
    </Card>
  )
  if (to) {
    return (
      <Link
        to={to}
        className="block rounded-[var(--radius-md)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        {body}
      </Link>
    )
  }
  return body
}

// ── Attention variant ──

// The glance tone each StatCard tone asks for. Only warning and danger ask for attention, and the tint comes from the glance
// strip's own mapping (`attentionForTone`), so a tile and a glance segment can never tint differently.
const GLANCE_TONE: Record<StatCardTone, FactChipTone> = {
  neutral: 'neutral',
  info: 'neutral',
  success: 'neutral',
  warning: 'warning',
  danger: 'negative',
}

// The colours of one tile: the same fills and on-container colours as `GLANCE_TONE` in FactBar.tsx (StatCard.test.tsx pins the
// two together). A tinted tile puts EVERYTHING (figure and label) in the matching on-container colour, so secondary text is
// tinted from the hue, never grey. A quiet tile sets its figure and its label in the muted colour, which is what makes it recede.
const ATTENTION_LOOK: Record<'quiet' | FactBarAttention, string> = {
  quiet: 'bg-[var(--color-card)] text-[var(--color-muted-foreground)]',
  warning: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  error: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
}

// Shape: the glance strip's cell inset (12px sides, --card-pad above and below), as its own bordered --radius-md tile so a
// band that wraps onto a second row never leaves a hole in a shared strip.
const ATTENTION_TILE = 'flex min-w-0 flex-col gap-0.5 rounded-md border border-[var(--color-border)] px-3 py-[var(--card-pad)]'

// A linked tile keeps a --tap-min floor (44px on touch; it is already taller than that, so this is the contract, not a resize).
const ATTENTION_LINK =
  'min-h-[var(--tap-min)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]'

function AttentionTile({ label, value, className, to, tone = 'neutral', caption, loading = false }: StatCardProps) {
  // A tile that is still loading does not know its count, so it is never tinted and shows no caption.
  const attention = loading ? undefined : attentionForTone(GLANCE_TONE[tone])
  const classes = `${ATTENTION_TILE} ${ATTENTION_LOOK[attention ?? 'quiet']} ${className ?? ''}`.trim()

  let captionNode = null
  if (!loading && caption) {
    captionNode = attention ? (
      <span className="text-xs font-medium">{caption}</span>
    ) : (
      glanceState('positive', caption).badge
    )
  }

  // Source order is label, figure, caption (the glance strip's order): a screen reader hears "Qualification Issues, 0, All
  // clear"; `order` puts the figure on top visually. The 13px label is the strip's, the figure is its display-step tabular figure.
  const content = (
    <>
      <span className="order-2 text-balance text-[13px] font-medium leading-tight">{label}</span>
      <div className="order-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-display tabular-nums" aria-hidden={loading || undefined}>
          {loading ? '–' : value}
        </span>
        {loading && <span className="sr-only">Loading</span>}
        {captionNode}
      </div>
    </>
  )

  if (to) {
    return (
      <Link to={to} aria-busy={loading || undefined} data-attention={attention} className={`${classes} ${ATTENTION_LINK}`}>
        {content}
      </Link>
    )
  }
  // A tile with no link is a named group ("Overdue 1"), so its accessible name carries the number as well as the label,
  // just as a linked tile's name comes from its content.
  const name = `${label} ${loading ? 'Loading' : value}${!loading && caption ? ` ${caption}` : ''}`
  return (
    <div role="group" aria-label={name} aria-busy={loading || undefined} data-attention={attention} className={classes}>
      {content}
    </div>
  )
}

export function StatCard(props: StatCardProps) {
  return props.variant === 'attention' ? <AttentionTile {...props} /> : <DefaultStatCard {...props} />
}
