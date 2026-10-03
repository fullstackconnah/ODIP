import type { PlanBlock, PlanDayName } from '@/api/types'
import { DAY_SHORT, PLAN_DAYS, dayBars, formatDuration, formatMinute, layoutDay, type DayBar } from '@/lib/planBlocks'

const MINUTES_PER_DAY = 1440

function dayText(bars: readonly DayBar[]): string {
  if (bars.length === 0) return 'no support'
  return [...bars].sort((a, b) => a.from - b.from).map(bar => `${formatMinute(bar.from)}–${formatMinute(bar.to)}`).join(', ')
}

type WeekStripProps = {
  blocks: readonly PlanBlock[]
  /** The block to draw in the strong colour beside the others (the Review step's block). */
  highlightId?: string | null
  className?: string
}

/**
 * The week at a glance, Monday to Sunday: every block drawn where it falls in the day, to scale, with the 06:00 and 20:00 weekday price changes as dashed seams. A block that runs
 * past midnight carries on at the top of the next day. It only shows: the list of blocks is where they are changed, so the strip adds no tab stops, and its text alternative
 * says each day's times.
 */
export function WeekStrip({ blocks, highlightId = null, className = '' }: WeekStripProps) {
  const bars = dayBars(blocks)
  const byDay = new Map<PlanDayName, DayBar[]>(PLAN_DAYS.map(day => [day, bars.filter(bar => bar.day === day)]))
  const summary = `The week at a glance. ${PLAN_DAYS.map(day => `${day}: ${dayText(byDay.get(day) ?? [])}`).join('. ')}.`
  const hasHighlight = highlightId !== null && bars.some(bar => bar.blockId === highlightId)

  return (
    <figure className={`rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] ${className}`}>
      <div role="img" aria-label={summary} className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] gap-x-1 gap-y-1">
        <span aria-hidden="true" />
        {PLAN_DAYS.map(day => (
          <span key={day} aria-hidden="true" className="text-center text-xs font-medium text-[var(--color-muted-foreground)]">{DAY_SHORT[day]}</span>
        ))}

        <div aria-hidden="true" className="relative h-32 sm:h-40">
          {[{ minute: 360, label: '06:00' }, { minute: 1200, label: '20:00' }].map(seam => (
            <span key={seam.label} className="absolute right-1 -translate-y-1/2 text-xs tabular-nums text-[var(--color-muted-foreground)]" style={{ top: `${(seam.minute / MINUTES_PER_DAY) * 100}%` }}>{seam.label}</span>
          ))}
        </div>
        {PLAN_DAYS.map(day => (
          <div key={day} aria-hidden="true" className="relative h-32 sm:h-40 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)]">
            {[360, 1200].map(minute => (
              <span key={minute} className="absolute inset-x-0 border-t border-dashed border-[var(--color-border)]" style={{ top: `${(minute / MINUTES_PER_DAY) * 100}%` }} />
            ))}
            {layoutDay(byDay.get(day) ?? []).map((bar, index) => {
              const strong = bar.blockId === highlightId
              return (
                <span
                  key={`${bar.blockId}-${index}`}
                  data-highlight={strong ? 'true' : undefined}
                  className={`absolute rounded-[var(--radius-sm)] border ${strong ? 'border-[var(--color-primary)] bg-[var(--color-primary)]' : 'border-[var(--color-primary)]/40 bg-[var(--color-primary-fixed)]'}`}
                  style={{
                    top: `${(bar.from / MINUTES_PER_DAY) * 100}%`,
                    height: `max(3px, ${((bar.to - bar.from) / MINUTES_PER_DAY) * 100}%)`,
                    left: `calc(${(bar.lane / bar.lanes) * 100}% + 1px)`,
                    width: `calc(${100 / bar.lanes}% - 2px)`,
                  }}
                />
              )
            })}
          </div>
        ))}

        <span aria-hidden="true" />
        {PLAN_DAYS.map(day => {
          const minutes = (byDay.get(day) ?? []).reduce((sum, bar) => sum + (bar.to - bar.from), 0)
          return <span key={day} aria-hidden="true" className="text-center text-xs tabular-nums text-[var(--color-muted-foreground)]">{minutes === 0 ? '—' : formatDuration(minutes)}</span>
        })}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted-foreground)]">
        <span>Dashed lines: weekday prices change at 06:00 and 20:00.</span>
        {hasHighlight && (
          <>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-[var(--radius-sm)] border border-[var(--color-primary)] bg-[var(--color-primary)]" />This block</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-[var(--radius-sm)] border border-[var(--color-primary)]/40 bg-[var(--color-primary-fixed)]" />Other blocks</span>
          </>
        )}
      </figcaption>
    </figure>
  )
}
