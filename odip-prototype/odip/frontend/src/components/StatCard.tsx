import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CARD_WASH, TONE, attentionOf, type Attention, type Tone } from '@/lib/tone'
import { Card } from './Card'
import { glanceState } from './glanceState'

/** A KPI tile's tone: every tone but `accessible`, which is a category colour, not a figure's state. */
export type StatCardTone = Exclude<Tone, 'accessible'>

/**
 * `default` (the default) is the small KPI tile: a 12px label over a `text-xl` value. `attention` is the opt-in tile of the
 * dashboard's attention band (DESIGN.md "Attention band"): the value is a display-step tabular figure, the tile is filled
 * with the same container tint the glance strip uses, and a tile at zero recedes. Given an `action` it is the tall tile of a count
 * somebody has to act on. A StatCard that does not ask for it renders exactly as before.
 */
export type StatCardVariant = 'default' | 'attention'

/** Where a count is fixed: the text of the link and the route it opens. */
export type StatCardAction = { label: string; to: string }

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
   * `attention` variant only: the one honest line under the label, saying what the count means ("Tasks past their due date and still open."). Only the
   * tall tile (see `action`) shows it.
   */
  detail?: string
  /**
   * `attention` variant only: where the count is fixed, as a link inside the tile. It makes the TALL tile: the figure, the label, the `detail` line and
   * this link, which stretches over the whole tile so the tile is one big target while the page keeps one link with a name of its own. The tall tile is a
   * named group, not a link, so leave `to` off; it has no caption (the `detail` line takes that job). A tile with no data (`loading` or `error`) is the
   * compact tile whatever it is given: there is no count for the line to explain.
   */
  action?: StatCardAction
  /**
   * `attention` variant only (the default tile ignores it): the value is not known yet. The tile shows an en dash in the muted
   * figure style with `aria-busy`, is never tinted, and shows no caption, so a request in flight is never read as a
   * definite zero.
   */
  loading?: boolean
  /**
   * `attention` variant only (the default tile ignores it): the request behind the value failed, so there is no number to show.
   * Like `loading` it is an en dash in the muted figure style, never tinted, with no caption (an "All clear" is never claimed
   * without data), but it is not busy, and a screen reader hears "Couldn't load" where a number would be. `loading` wins if
   * both are set.
   */
  error?: boolean
}

// What a screen reader hears in place of the number while the tile has no data.
const LOADING_TEXT = 'Loading'
const ERROR_TEXT = "Couldn't load"

// The tile's wash is the tone's soft wash (CARD_WASH: Card sets its own background, so it needs the important modifier) and its figure takes
// the tone's ink. A tile without a tone renders exactly as before: no wash, and the olive figure of the fleet KPIs, which is the default tile's
// own look rather than the neutral tone's ink.
const NEUTRAL_FIGURE = 'text-[var(--color-primary)]'
const figureInk = (tone: StatCardTone) => (tone === 'neutral' ? NEUTRAL_FIGURE : TONE[tone].ink)

function DefaultStatCard({ label, value, className, to, tone = 'neutral', caption }: StatCardProps) {
  // Tiles that carry a link, tint or caption sit in dense KPI rows where a long label must not
  // wrap and change the row height; plain tiles keep their original (wrapping) label.
  const dense = !!to || tone !== 'neutral' || !!caption
  const body = (
    <Card compact className={`${CARD_WASH[tone]} ${className ?? ''}`.trim() || undefined}>
      <p className={`${dense ? 'truncate ' : ''}text-xs font-medium text-[var(--color-muted-foreground)]`}>{label}</p>
      <p className={`text-xl font-display font-bold ${figureInk(tone)}`}>{value}</p>
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

// The colours of one tile: the same fills and on-container colours as a glance segment (The Attention Tint Rule), because both take them
// from the one tone table: only warning and danger ask for attention (`attentionOf`), and they fill with the tone's own solid pair. A tinted
// tile puts EVERYTHING (figure and label) in the matching on-container colour, so secondary text is tinted from the hue, never grey. A
// quiet tile sets its figure and its label in the muted colour, which is what makes it recede.
const ATTENTION_LOOK: Record<'quiet' | Attention, string> = {
  quiet: 'bg-[var(--color-card)] text-[var(--color-muted-foreground)]',
  warning: TONE.warning.solid,
  error: TONE.danger.solid,
}

// Shape: its own bordered --radius-md tile (so a band that wraps onto a second row never leaves a hole in a shared strip), with
// --card-pad above and below and the compact card's 8px at the sides. The glance cell's 12px side inset (16px from xl) is too
// much here: nine tiles share a 1920 row, each 176px wide, and "Critical Participant Alerts" is 152.6px at 13px, so 12px sides
// (150px of room inside the borders) wrapped it and made the whole row 16px taller. At 8px it has 158px and every label is one line.
const ATTENTION_TILE = 'flex min-w-0 flex-col gap-0.5 rounded-md border border-[var(--color-border)] px-2 py-[var(--card-pad)]'

// A linked tile keeps a --tap-min floor (44px on touch; it is already taller than that, so this is the contract, not a resize).
const ATTENTION_LINK =
  'min-h-[var(--tap-min)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]'

function AttentionTile({ label, value, className, to, tone = 'neutral', caption, loading = false, error = false }: StatCardProps) {
  // No data to show: the request is still in flight (`loading`) or it failed (`error`). Either way the tile does not know its
  // count, so it is never tinted and shows no caption: an "All clear" is never claimed without data.
  const noData = loading || error
  const noDataText = loading ? LOADING_TEXT : ERROR_TEXT
  const attention = noData ? undefined : attentionOf(tone)
  const classes = `${ATTENTION_TILE} ${ATTENTION_LOOK[attention ?? 'quiet']} ${className ?? ''}`.trim()

  let captionNode = null
  if (!noData && caption) {
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
        <span className="text-display tabular-nums" aria-hidden={noData || undefined}>
          {noData ? '–' : value}
        </span>
        {/* The dash is decoration for assistive tech; what it hears where the number would be is why there is none. */}
        {noData && <span className="sr-only">{noDataText}</span>}
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
  const name = `${label} ${noData ? noDataText : value}${!noData && caption ? ` ${caption}` : ''}`
  return (
    <div role="group" aria-label={name} aria-busy={loading || undefined} data-attention={attention} className={classes}>
      {content}
    </div>
  )
}

// ── The tall action tile ──

// A count that needs somebody, made big enough to act on: the figure, the label, one honest line saying what the count means, and the link to where it is
// fixed, stacked in that order. It wears the same fills as the compact tile (ATTENTION_LOOK: the one tone table behind the glance strip and the band), so only
// the structure is new, and the structure is what makes it tall: its padding is --section-gap on every side (the airier step the dense pages do not use) and
// it is four lines deep, so it is the biggest colour field on the page. Colour is never the only cue: the number, the label and the line each say it in words.
const ACTION_TILE =
  'relative flex min-w-0 flex-col rounded-md border border-[var(--color-border)] p-[var(--section-gap)] transition-opacity has-[a:hover]:opacity-90'

// The link's `::after` fills the (positioned) tile, so the whole tile is the target while the page keeps ONE link with a name of its own ("Open overdue
// tasks"). The focus ring is drawn on that pseudo-element for the same reason: it surrounds the tile, not just the words. `--tap-min` floors the link's own
// box at 44px on touch.
const ACTION_LINK =
  'mt-auto inline-flex min-h-[var(--tap-min)] items-center gap-0.5 self-start pt-2 text-sm font-bold underline-offset-4 hover:underline focus:outline-none ' +
  'after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-[var(--color-ring)]'

function ActionTile({ label, value, className, tone = 'neutral', detail, action }: StatCardProps & { action: StatCardAction }) {
  const attention = attentionOf(tone)
  const classes = `${ACTION_TILE} ${ATTENTION_LOOK[attention ?? 'quiet']} ${className ?? ''}`.trim()

  // A named group, so its accessible name carries the number as well as the label (like the compact tile without a link).
  return (
    <div role="group" aria-label={`${label} ${value}`} data-attention={attention} className={classes}>
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-display tabular-nums">{value}</span>
        <span className="text-sm font-semibold leading-tight">{label}</span>
        {detail && <span className="text-[13px] leading-snug">{detail}</span>}
        <Link to={action.to} className={ACTION_LINK}>
          {action.label}
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}

export function StatCard(props: StatCardProps) {
  if (props.variant !== 'attention') return <DefaultStatCard {...props} />
  const { action } = props
  return action && !props.loading && !props.error ? <ActionTile {...props} action={action} /> : <AttentionTile {...props} />
}
