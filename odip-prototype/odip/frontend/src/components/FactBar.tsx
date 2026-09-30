import { isValidElement, type ComponentType, type ReactNode } from 'react'

type FactBarIconComponent = ComponentType<{ className?: string }>

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
}

export type FactBarProps = {
  segments: FactBarSegment[]
  className?: string
}

const ICON_CLASS = 'w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]'

// Slot for a ready-made icon element. `[&_svg]` and the Material Symbols selector pin the glyph
// to the 16px slot: `.material-symbols-outlined` sets an unlayered 24px font-size that a plain
// Tailwind size class cannot outrank, hence the important modifier on that one.
const ICON_SLOT_CLASS =
  'inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden text-[16px] leading-none text-[var(--color-muted-foreground)] [&_svg]:h-4 [&_svg]:w-4 [&_.material-symbols-outlined]:text-[16px]!'

function isIconComponent(icon: FactBarSegment['icon']): icon is FactBarIconComponent {
  if (typeof icon === 'function') return true
  // forwardRef / memo components (lucide icons) are plain objects carrying `$$typeof`, as are
  // React elements — tell them apart with isValidElement.
  return typeof icon === 'object' && icon !== null && '$$typeof' in icon && !isValidElement(icon)
}

function renderIcon(icon: FactBarSegment['icon']): ReactNode {
  if (icon === undefined || icon === null || typeof icon === 'boolean' || icon === '') return null
  if (isIconComponent(icon)) {
    const Icon = icon
    return <Icon className={ICON_CLASS} />
  }
  return (
    <span aria-hidden="true" className={ICON_SLOT_CLASS}>
      {icon}
    </span>
  )
}

/**
 * A single 44px-tall horizontal strip of `label / value [badge]` segments (density-redesign §5),
 * replacing a row of tall stat tiles on detail pages. Segments are separated by 1px vertical
 * rules and wrap onto a new line on narrow screens rather than overflowing or scrolling.
 */
export function FactBar({ segments, className }: FactBarProps) {
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
