import { parseServiceStreams, SERVICE_STREAM_LABELS, SERVICE_STREAM_TITLES } from '@/api/types/participants'

const CHIP_CLASS = 'inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-[var(--color-secondary-container)] text-[var(--color-foreground)]'

/**
 * Small pill chips for a participant's service-stream tags. Accepts the raw wire value (a
 * comma-separated ServiceStreams flag list, or "None"/empty — see parseServiceStreams) so
 * callers can pass `participant.serviceStreams` straight through.
 *
 * Renders nothing when the participant has no streams, so a meta row of chips never ends in a
 * dangling "—". A caller that wants a placeholder (a table cell, say) must supply its own.
 */
export function ServiceStreamBadges({ value, className }: { value: string | null | undefined; className?: string }) {
  const streams = parseServiceStreams(value)
  if (streams.length === 0) return null

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className ?? ''}`}>
      {streams.map((s) => (
        <span key={s} className={CHIP_CLASS} title={SERVICE_STREAM_TITLES[s]}>{SERVICE_STREAM_LABELS[s]}</span>
      ))}
    </span>
  )
}
