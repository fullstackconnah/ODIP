import { isValidElement, type ComponentType, type ReactNode } from 'react'
import { ON_TINT, TONE, toneOf, type Attention, type Tone } from '@/lib/tone'

type FactBarIconComponent = ComponentType<{ className?: string }>

/**
 * How a `glance` segment asks for attention. `warning` fills it with `--color-warning-container` (pending,
 * time-bound), `error` with `--color-error-container` (action needed, outstanding). Quiet segments set nothing.
 */
export type FactBarAttention = Attention

export type FactBarSegment = {
  label: string
  value: ReactNode
  badge?: ReactNode
  /**
   * Optional leading category icon, rendered 16px and muted before the label. Pass either an icon
   * component (e.g. a lucide icon: `icon: Users`) or a ready-made element (e.g. a Material Symbols
   * glyph: `icon: <span className="material-symbols-outlined">groups</span>`) — the bar sizes and
   * colours it either way. Decorative only: an element is wrapped in an `aria-hidden` slot (lucide
   * components already mark themselves hidden), so the label carries the meaning. A segment
   * without an icon renders exactly as before.
   */
  icon?: FactBarIconComponent | ReactNode
  /**
   * `glance` variant only: this segment needs attention, so it is filled with the matching container tint and its
   * text takes the matching on-container colour. Leave it unset for a quiet segment, which stays on the card fill.
   * The default bar ignores it. Derive it from the same tone as the badge (see `glanceState`) so the fill can
   * never disagree with the chip it holds.
   */
  attention?: FactBarAttention
}

export type FactBarVariant = 'default' | 'glance'

export type FactBarProps = {
  segments: FactBarSegment[]
  className?: string
  /**
   * `default` is the 44px label/value strip that every page uses today.
   * `glance` is the detail-page header strip (DESIGN.md "Detail header pattern"): the value is a big tabular
   * figure at the display step with a 13px label beneath, the cells share the width equally, it is a 2x2 grid
   * below md and one row from md, and a segment can carry an attention tint.
   */
  variant?: FactBarVariant
}

const ICON_CLASS = 'w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]'

// Slot for a ready-made icon element. `[&_svg]` and the Material Symbols selector pin the glyph
// to the 16px slot: `.material-symbols-outlined` sets an unlayered 24px font-size that a plain
// Tailwind size class cannot outrank, hence the important modifier on that one.
const ICON_SLOT_CLASS =
  'inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden text-[16px] leading-none text-[var(--color-muted-foreground)] [&_svg]:h-4 [&_svg]:w-4 [&_.material-symbols-outlined]:text-[16px]!'

// The same two, for the glance variant: the icon takes the colour of its label (muted on a quiet segment, the
// on-container colour on a tinted one) instead of a fixed muted grey.
const GLANCE_ICON_CLASS = 'w-4 h-4 shrink-0 text-current'
const GLANCE_ICON_SLOT_CLASS =
  'inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden text-[16px] leading-none text-current [&_svg]:h-4 [&_svg]:w-4 [&_.material-symbols-outlined]:text-[16px]!'

type IconClasses = { icon: string; slot: string }
const DEFAULT_ICON_CLASSES: IconClasses = { icon: ICON_CLASS, slot: ICON_SLOT_CLASS }
const GLANCE_ICON_CLASSES: IconClasses = { icon: GLANCE_ICON_CLASS, slot: GLANCE_ICON_SLOT_CLASS }

function isIconComponent(icon: FactBarSegment['icon']): icon is FactBarIconComponent {
  if (typeof icon === 'function') return true
  // forwardRef / memo components (lucide icons) are plain objects carrying `$$typeof`, as are
  // React elements — tell them apart with isValidElement.
  return typeof icon === 'object' && icon !== null && '$$typeof' in icon && !isValidElement(icon)
}

function renderIcon(icon: FactBarSegment['icon'], classes: IconClasses = DEFAULT_ICON_CLASSES): ReactNode {
  if (icon === undefined || icon === null || typeof icon === 'boolean' || icon === '') return null
  if (isIconComponent(icon)) {
    const Icon = icon
    return <Icon className={classes.icon} />
  }
  return (
    <span aria-hidden="true" className={classes.slot}>
      {icon}
    </span>
  )
}

/**
 * The colours of one glance segment. A quiet segment sits on the card fill with ink text and a muted label; a tinted
 * one takes the container as its fill and the matching on-container colour for EVERYTHING in it (figure, label and
 * icon), so secondary text is tinted from the hue, never grey.
 */
const GLANCE_TONE: Record<'quiet' | FactBarAttention, { cell: string; label: string }> = {
  quiet: {
    cell: 'text-[var(--color-foreground)]',
    label: 'text-[var(--color-muted-foreground)]',
  },
  // A tinted segment is the tone's own container and on-container (lib/tone.ts): the same pair StatCard's attention tile wears.
  warning: { cell: TONE.warning.solid, label: '' },
  error: { cell: TONE.danger.solid, label: '' },
}

/**
 * Classes for one glance cell. The rules between cells are drawn by the cells themselves, not by a gap trick, so
 * an odd count leaves plain card colour rather than a grey hole. Below md the strip is two columns: a cell in the
 * right column gets a left rule and every cell from the second row a top rule. From md it is one row: every
 * cell after the first gets a left rule and none a top rule. An odd last cell takes the whole row below md.
 */
function glanceCellClass(idx: number, count: number, attention: FactBarAttention | undefined): string {
  const tone = GLANCE_TONE[attention ?? 'quiet']
  return [
    // px-3 until xl, where the cells are wide enough (about 250px) for the roomier 16px, the FactBar's own inset.
    'flex min-w-0 flex-col gap-0.5 border-[var(--color-border)] px-3 py-[var(--card-pad)] xl:px-4',
    tone.cell,
    idx % 2 === 1 ? 'border-l' : idx > 0 ? 'md:border-l' : '',
    idx >= 2 ? 'border-t md:border-t-0' : '',
    count % 2 === 1 && count > 1 && idx === count - 1 ? 'max-md:col-span-2' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function GlanceBar({ segments, className }: Pick<FactBarProps, 'segments' | 'className'>) {
  return (
    <div
      className={`grid grid-cols-2 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-card)] md:auto-cols-fr md:grid-flow-col md:grid-cols-none ${className ?? ''}`}
    >
      {segments.map((segment, idx) => {
        const tone = GLANCE_TONE[segment.attention ?? 'quiet']
        return (
          <div
            key={idx}
            data-attention={segment.attention}
            className={glanceCellClass(idx, segments.length, segment.attention)}
          >
            {/* Source order is label then value, so a screen reader announces "Outstanding Tasks, 2, Action
                Needed"; `order` puts the figure on top visually. */}
            <div className={`order-2 flex items-start gap-1.5 text-[13px] font-medium leading-tight ${tone.label}`}>
              {renderIcon(segment.icon, GLANCE_ICON_CLASSES)}
              <span>{segment.label}</span>
            </div>
            <div className="order-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-display tabular-nums">{segment.value}</span>
              {segment.badge}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * A single 44px-tall horizontal strip of `label / value [badge]` segments (density-redesign §5),
 * replacing a row of tall stat tiles on detail pages. Segments are separated by 1px vertical
 * rules and wrap onto a new line on narrow screens rather than overflowing or scrolling.
 *
 * `variant="glance"` is the opt-in detail-header form of the same strip (big figures, attention tints); see
 * `FactBarProps.variant`. Omit it and nothing changes.
 */
export function FactBar({ segments, className, variant = 'default' }: FactBarProps) {
  if (variant === 'glance') return <GlanceBar segments={segments} className={className} />
  return (
    <div
      className={`flex min-h-[44px] flex-wrap items-stretch rounded-md border border-[var(--color-border)] bg-[var(--color-card)] ${className ?? ''}`}
    >
      {segments.map((segment, idx) => (
        <div
          key={idx}
          className={`flex items-center gap-2 px-4 py-2 ${idx > 0 ? 'border-l border-[var(--color-border)]' : ''}`}
        >
          {renderIcon(segment.icon)}
          <div className="flex flex-col leading-tight">
            <span className="text-xs text-[var(--color-muted-foreground)]">{segment.label}</span>
            <span className="text-sm font-medium text-[var(--color-foreground)]">{segment.value}</span>
          </div>
          {segment.badge}
        </div>
      ))}
    </div>
  )
}

/**
 * The state a badge reports. `warning` and `negative` (the danger tone) ask for attention; `positive` (success) and `neutral` do not.
 * `positive` and `negative` are the older words for the success and danger tones, and `success` and `danger` work too.
 */
export type FactChipTone = 'positive' | 'warning' | 'negative' | 'neutral' | Extract<Tone, 'success' | 'danger'>

/**
 * Small state pill for a `FactBarSegment.badge` (Waitlist, Action Needed, Covered ...): the same rounded-full,
 * text-xs shape as `StatusBadge`. Pass `onTint` when the segment is tinted so the pill stays legible; `glanceState`
 * does that for you.
 */
export function FactChip({ tone, onTint = false, children }: { tone: FactChipTone; onTint?: boolean; children: ReactNode }) {
  const resolved = toneOf(tone)
  // On a tinted segment a chip in its own tone would vanish into the fill (warning on warning-container), so it becomes a card-white
  // pill that keeps the tone's text colour. Success and neutral chips never sit on a tint.
  const toneClass = (onTint && ON_TINT[resolved]) || TONE[resolved].solid
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${toneClass}`}>{children}</span>
}
