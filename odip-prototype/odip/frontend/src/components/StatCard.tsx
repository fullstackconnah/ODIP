import { Link } from 'react-router-dom'
import { Card } from './Card'

export type StatCardTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export type StatCardProps = {
  label: string
  value: string | number
  className?: string
  /** Renders the whole tile as a react-router Link (with a visible focus ring). */
  to?: string
  /** Tints the tile and its value using existing colour tokens. Omitted / 'neutral' = untinted. */
  tone?: StatCardTone
  /** Optional small line under the value (e.g. "All clear"). */
  caption?: string
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

export function StatCard({ label, value, className, to, tone = 'neutral', caption }: StatCardProps) {
  // Tiles that carry a link, tint or caption sit in dense KPI rows where a long label must not
  // wrap and change the row height; plain tiles keep their original (wrapping) label.
  const dense = !!to || tone !== 'neutral' || !!caption
  const body = (
    <Card compact className={`${TONE_TILE[tone]} ${className ?? ''}`.trim() || undefined}>
      <p className={`${dense ? 'truncate ' : ''}text-xs font-medium text-[var(--color-muted-foreground)]`}>{label}</p>
      <p className={`text-xl font-display font-bold ${TONE_VALUE[tone]}`}>{value}</p>
      {caption && <p className="text-[11px] text-[var(--color-muted-foreground)]">{caption}</p>}
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
