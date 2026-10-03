import type { PlanBlock } from '@/api/types'
import { WEEKDAY_BAND_LABEL, durationMinutes, endsNextDay, formatDuration, formatMinute, hasWholeDayBands, weekdayBandParts, type WeekdayBand } from '@/lib/planBlocks'

const MINUTES_PER_DAY = 1440

const ZONES: { band: WeekdayBand; from: number; to: number }[] = [
  { band: 'night', from: 0, to: 360 },
  { band: 'day', from: 360, to: 1200 },
  { band: 'evening', from: 1200, to: 1440 },
]

const pct = (minutes: number) => `${(minutes / MINUTES_PER_DAY) * 100}%`

/** The block's stretches on the 24 hour line: the part before midnight, and the part after it (the next day) from the left edge. */
function segments(block: Pick<PlanBlock, 'start' | 'end'>): { from: number; to: number }[] {
  const parts = weekdayBandParts(block)
  if (parts.length === 0) return []
  const start = parts[0].from
  const end = parts[parts.length - 1].to
  return end <= MINUTES_PER_DAY ? [{ from: start, to: end }] : [{ from: start, to: MINUTES_PER_DAY }, { from: 0, to: end - MINUTES_PER_DAY }]
}

type BandPreviewProps = {
  block: Pick<PlanBlock, 'days' | 'start' | 'end'>
}

/**
 * One weekday as a line from midnight to midnight, cut where the NDIS prices change (06:00 and 20:00, and midnight itself), with the block drawn on it. A block that runs past
 * midnight carries on from the left edge as the next day. Beneath it, in words, which price band each part of the block falls in and how long each lasts.
 */
export function BandPreview({ block }: BandPreviewProps) {
  const parts = weekdayBandParts(block)
  const stretches = segments(block)
  if (parts.length === 0) return null

  const words = parts.map(part => {
    const next = part.from >= MINUTES_PER_DAY
    return `${WEEKDAY_BAND_LABEL[part.band]} ${formatMinute(part.from % MINUTES_PER_DAY)}–${formatMinute(part.to - (next ? MINUTES_PER_DAY : 0))}${next ? ' next day' : ''} (${formatDuration(part.minutes)})`
  })

  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={`Weekday price bands. The block covers ${words.join('; ')}.`} className="flex flex-col gap-1">
        <div aria-hidden="true" className="relative flex h-7 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]">
          {ZONES.map(zone => (
            <span key={zone.band} className={`flex items-center justify-center text-xs text-[var(--color-muted-foreground)] ${zone.band === 'day' ? 'bg-[var(--color-card)]' : 'bg-[var(--color-surface-container)]'}`} style={{ width: pct(zone.to - zone.from) }}>
              {WEEKDAY_BAND_LABEL[zone.band]}
            </span>
          ))}
        </div>
        <div aria-hidden="true" className="relative h-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)]">
          {stretches.map((stretch, index) => (
            <span key={index} className="absolute inset-y-0 rounded-[var(--radius-sm)] bg-[var(--color-primary)]" style={{ left: pct(stretch.from), width: pct(stretch.to - stretch.from) }} />
          ))}
        </div>
        <div aria-hidden="true" className="relative h-4 text-xs tabular-nums text-[var(--color-muted-foreground)]">
          {[{ at: 0, label: '00:00', align: 'left-0' }, { at: 360, label: '06:00', align: '-translate-x-1/2' }, { at: 1200, label: '20:00', align: '-translate-x-1/2' }, { at: 1440, label: '24:00', align: 'right-0' }].map(tick => (
            <span key={tick.label} className={`absolute top-0 ${tick.align}`} style={tick.align.includes('translate') ? { left: pct(tick.at) } : undefined}>{tick.label}</span>
          ))}
        </div>
      </div>
      <p className="text-sm">
        <span className="font-medium">{formatDuration(durationMinutes(block))}</span>
        {endsNextDay(block) ? ' across midnight' : ' on the same day'}
        <span className="text-[var(--color-muted-foreground)]">{': '}{words.join(', ')}.</span>
      </p>
      {hasWholeDayBands(block.days) && (
        <p className="text-xs text-[var(--color-muted-foreground)]">Saturday and Sunday are one price for the whole day, so the bands above are what a weekday does with this block.</p>
      )}
    </div>
  )
}
