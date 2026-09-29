import type { ComponentType, ReactNode } from 'react'

export type FactBarSegment = {
  label: string
  value: ReactNode
  badge?: ReactNode
  icon?: ComponentType<{ className?: string }>
}

export type FactBarProps = {
  segments: FactBarSegment[]
  className?: string
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
      {segments.map((segment, idx) => {
        const Icon = segment.icon
        return (
          <div
            key={idx}
            className={`flex items-center gap-2 px-4 py-2 ${idx > 0 ? 'border-l border-[var(--color-border)]' : ''}`}
          >
            {Icon && <Icon className="w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]" />}
            <div className="flex flex-col leading-tight">
              <span className="text-xs text-[var(--color-muted-foreground)]">{segment.label}</span>
              <span className="text-sm font-medium text-[var(--color-foreground)]">{segment.value}</span>
            </div>
            {segment.badge}
          </div>
        )
      })}
    </div>
  )
}
