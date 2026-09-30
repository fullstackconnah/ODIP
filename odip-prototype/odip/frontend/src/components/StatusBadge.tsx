import { QUIET_STATUS, STATUS_TONE, TONE, isTone, statusKey, type Tone } from '@/lib/tone'

export type StatusBadgeSize = 'sm' | 'md'

type StatusBadgeBaseProps = {
  /**
   * Per-call overrides for a domain whose word means something else there (a leave "Cancelled" is neutral, not danger). Each value
   * is a `Tone` (`'danger'`), or, for back-compat, a ready-made class string. Looked up by the lower-cased, space-stripped status.
   */
  colorMap?: Record<string, Tone | string>
  pulse?: boolean
  className?: string
  /**
   * `sm` (default) is the 12px pill used in tables and inline. `md` is the 13px semibold, 24px-tall pill that
   * leads the meta row of a detail-page header (see `PageHeaderMeta`). Colour is the same at both sizes.
   */
  size?: StatusBadgeSize
}

export type StatusBadgeProps = StatusBadgeBaseProps &
  (
    | {
        status: string
        /** Overrides the displayed text without changing the colour lookup. */
        label?: string
        /** Colours the badge with this tone, whatever the status word is. Wins over `colorMap` and the built-in map. */
        tone?: Tone
      }
    | {
        /** A badge that is only a tone and a word: `<StatusBadge tone="danger" label="Refused" />`. */
        status?: undefined
        label: string
        tone: Tone
      }
  )

// `sm` is exactly the pill every existing caller renders; only `md` is new.
const SIZE_CLASS: Record<StatusBadgeSize, string> = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-[13px] leading-5 font-semibold px-2.5 py-0.5',
}

// A status with no tone anywhere falls back to the amber "awaiting" pair rather than an unstyled pill.
const DEFAULT_TONE: Tone = 'warning'

function colorFor(key: string, tone: Tone | undefined, colorMap: StatusBadgeBaseProps['colorMap']): string {
  if (tone) return TONE[tone].solid
  const override = colorMap && Object.hasOwn(colorMap, key) ? colorMap[key] : undefined
  if (override !== undefined) return isTone(override) ? TONE[override].solid : override
  const own = Object.hasOwn(STATUS_TONE, key) ? STATUS_TONE[key] : DEFAULT_TONE
  return QUIET_STATUS.has(key) ? `${TONE[own].soft} ${TONE[own].ink}` : TONE[own].solid
}

export function StatusBadge({ status, label, tone, colorMap, pulse, className, size = 'sm' }: StatusBadgeProps) {
  const key = statusKey(status ?? '')
  const color = colorFor(key, tone, colorMap)
  return (
    <span className={`${SIZE_CLASS[size]} rounded-full ${color} ${pulse ? 'animate-pulse' : ''} ${className ?? ''}`}>
      {label ?? status}
    </span>
  )
}
