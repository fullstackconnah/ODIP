import { Button } from '@/components/Button'
import type { ParticipantTabKey } from './participantTabs'

export type SectionLineItem = { id: string; title: string; has: boolean }

/**
 * The sections a merged chip stacks, as in-page links under the chip strip: they name the hidden ones (ADL, restrictive practices) without another
 * tab level. Only for a chip with 3 or more; a `#id` link, so the existing hash scroll does the work. An empty section is muted, like a quiet chip.
 */
export function SectionLine({ tab, sections }: { tab: ParticipantTabKey; sections: readonly SectionLineItem[] }) {
  if (sections.length < 3) return null
  return (
    <nav aria-label="Sections on this page" className="mt-3 flex flex-wrap gap-x-1">
      {sections.map(s => (
        <Button key={s.id} variant="ghost" size="sm" className={`min-h-[var(--tap-min)] ${s.has ? '' : 'text-[var(--color-muted-foreground)]'}`}
          to={`?tab=${tab}#${s.id}`} {...(s.has ? {} : { 'data-quiet': 'true' })}>
          {s.title}{s.has ? null : <span className="sr-only">, not recorded</span>}
        </Button>
      ))}
    </nav>
  )
}
