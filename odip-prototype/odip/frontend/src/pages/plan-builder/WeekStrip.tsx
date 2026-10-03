import type { PlanBlock, PlanDayName } from '@/api/types'
import { DAY_SHORT, PLAN_DAYS, dayBars, describeBlock, formatDuration, formatMinute, layoutDay, type DayBar } from '@/lib/planBlocks'
import { NO_FIGURE } from '@/lib/planQuote'

const MINUTES_PER_DAY = 1440

/** The days the price changes at 06:00 and 20:00. Saturday and Sunday are one price all day, so they have no seams to draw. */
const WEEKDAYS: ReadonlySet<PlanDayName> = new Set<PlanDayName>(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])

/** A bar this long (two and a half hours, about 13px on the shortest strip) has room for its block's number; a shorter one is a sliver, and a title still names it. */
const NUMBER_MINUTES = 150

// A bar is a graphic the picture cannot be read without, so it holds 3:1 against the track (WCAG 1.4.11): the border is the full primary (6.5:1), the fill only tints. The block being
// reviewed is told apart by a solid fill, not by another hue.
const OTHER_BAR = 'border-[var(--color-primary)] bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
const THIS_BAR = 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
const SEAM = 'border-[var(--color-muted-foreground)]/70'

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
 * The week at a glance, Monday to Sunday: every block drawn where it falls in the day, to scale, with the 06:00 and 20:00 weekday price changes as dashed seams on the weekdays. A bar
 * carries its block's number when it is tall enough and a title that says which block it is. A block that runs past midnight carries on at the top of the next day. It only shows: the
 * list of blocks is where they are changed, so the strip adds no tab stops, and its text alternative says each day's times.
 */
export function WeekStrip({ blocks, highlightId = null, className = '' }: WeekStripProps) {
  const bars = dayBars(blocks)
  const byDay = new Map<PlanDayName, DayBar[]>(PLAN_DAYS.map(day => [day, bars.filter(bar => bar.day === day)]))
  const summary = `The week at a glance. ${PLAN_DAYS.map(day => `${day}: ${dayText(byDay.get(day) ?? [])}`).join('. ')}.`
  const hasHighlight = highlightId !== null && bars.some(bar => bar.blockId === highlightId)
  const place = (id: string) => blocks.findIndex(block => block.id === id)

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
            {WEEKDAYS.has(day) && [360, 1200].map(minute => (
              <span key={minute} data-seam="true" className={`absolute inset-x-0 border-t border-dashed ${SEAM}`} style={{ top: `${(minute / MINUTES_PER_DAY) * 100}%` }} />
            ))}
            {layoutDay(byDay.get(day) ?? []).map((bar, index) => {
              const strong = bar.blockId === highlightId
              const at = place(bar.blockId)
              const title = at >= 0 ? `${at + 1}. ${describeBlock(blocks[at])}` : undefined
              return (
                <span
                  key={`${bar.blockId}-${index}`}
                  data-highlight={strong ? 'true' : undefined}
                  title={title}
                  className={`absolute overflow-hidden rounded-[var(--radius-sm)] border text-center text-xs font-semibold leading-none ${strong ? THIS_BAR : OTHER_BAR}`}
                  style={{
                    top: `${(bar.from / MINUTES_PER_DAY) * 100}%`,
                    height: `max(3px, ${((bar.to - bar.from) / MINUTES_PER_DAY) * 100}%)`,
                    left: `calc(${(bar.lane / bar.lanes) * 100}% + 1px)`,
                    width: `calc(${100 / bar.lanes}% - 2px)`,
                  }}
                >
                  {at >= 0 && bar.to - bar.from >= NUMBER_MINUTES && bar.lanes <= 3 && <span className="block pt-0.5">{at + 1}</span>}
                </span>
              )
            })}
          </div>
        ))}

        <span aria-hidden="true" />
        {PLAN_DAYS.map(day => {
          const minutes = (byDay.get(day) ?? []).reduce((sum, bar) => sum + (bar.to - bar.from), 0)
          return <span key={day} aria-hidden="true" className="text-center text-xs tabular-nums text-[var(--color-muted-foreground)]">{minutes === 0 ? NO_FIGURE : formatDuration(minutes)}</span>
        })}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted-foreground)]">
        <span>Dashed lines: weekday prices change at 06:00 and 20:00.</span>
        {hasHighlight && (
          <>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`inline-block h-3 w-3 rounded-[var(--radius-sm)] border ${THIS_BAR}`} />This block</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`inline-block h-3 w-3 rounded-[var(--radius-sm)] border ${OTHER_BAR}`} />Other blocks</span>
          </>
        )}
      </figcaption>
    </figure>
  )
}
