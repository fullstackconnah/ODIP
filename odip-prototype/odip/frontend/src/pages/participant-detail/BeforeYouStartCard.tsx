import { Link } from 'react-router-dom'
import { Card } from '@/components/Card'
import { FactChip } from '@/components/FactBar'
import { joinList } from '@/lib/format'
import { safetyFlags, unansweredSafetyFields } from './safetyFlags'
import type { ParticipantDetailDto } from '@/api/types/participants'

/**
 * Overview's first card: each safety flag with its full recorded text and a link to where it lives. A field nobody has answered is
 * named under "Not recorded", never shown as safe. The all-clear line says what it covers (the profile fields), because the Health tab
 * can still hold active risk entries.
 */
export function BeforeYouStartCard({ participant }: { participant: ParticipantDetailDto }) {
  const flags = safetyFlags(participant)
  const unanswered = unansweredSafetyFields(participant)
  return (
    <section id="before-you-start" aria-label="Before you start" className="scroll-mt-12">
      <Card title="Before you start">
        {flags.length > 0 && (
          <ul className="flex flex-col gap-3 list-none p-0">
            {flags.map(f => (
              <li key={f.key} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <FactChip tone={f.tone}>{f.label}</FactChip>
                <span className="flex-1 min-w-[12rem] text-sm break-words">{f.detail}</span>
                <Link
                  to={{ search: `?tab=${f.tab}`, hash: f.hash }}
                  className="text-sm underline inline-flex items-center min-h-[var(--tap-min)]"
                >
                  See {f.section}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {unanswered.length > 0 && (
          <p className="mt-3 first:mt-0 text-sm text-[var(--color-muted-foreground)]">Not recorded: {joinList(unanswered)}</p>
        )}
        {flags.length === 0 && unanswered.length === 0 && (
          <p className="text-sm text-[var(--color-muted-foreground)]">No safety flags in the profile fields.</p>
        )}
      </Card>
    </section>
  )
}
