import { Link } from 'react-router-dom'
import { FactChip } from '@/components/FactBar'
import { safetyFlags, unansweredSafetyFields } from './safetyFlags'
import type { ParticipantDetailDto } from '@/api/types/participants'

/**
 * The header's safety chips: what a worker must know before they start, on every tab. Each chip jumps to the section that holds the
 * detail. When a safety field has not been answered the row ends with a warning "Safety details not recorded" chip, so a deep link to any
 * tab still tells "nobody asked" apart from "nothing to flag". Renders nothing only when every field is answered and none flags.
 */
export function ParticipantSafetyFlags({ participant }: { participant: ParticipantDetailDto }) {
  const flags = safetyFlags(participant)
  const unanswered = unansweredSafetyFields(participant)
  if (flags.length === 0 && unanswered.length === 0) return null

  // A coarse pointer lifts the hit area to --tap-min (0 on a mouse, so the chip keeps its size there).
  const link = 'inline-flex items-center min-h-[var(--tap-min)] rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]'
  return (
    <ul aria-label="Safety flags" className="flex flex-wrap items-center gap-x-2 gap-y-1 list-none p-0">
      {flags.map(f => (
        <li key={f.key}>
          <Link to={{ search: `?tab=${f.tab}`, hash: f.hash }} className={link}>
            <FactChip tone={f.tone}>{f.label}</FactChip>
          </Link>
        </li>
      ))}
      {unanswered.length > 0 && (
        <li>
          <Link to={{ search: '?tab=overview', hash: 'before-you-start' }} className={link}>
            <FactChip tone="warning">Safety details not recorded</FactChip>
          </Link>
        </li>
      )}
    </ul>
  )
}
