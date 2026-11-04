import { Link } from 'react-router-dom'
import type { ParticipantTabKey } from './participantTabs'

export type SectionLineItem = { id: string; title: string; has: boolean }

/**
 * A wayfinding link on the section line and the Overview card. Not a ghost Button: it has no fill at any width (a pill on every link made the 390 line
 * heavy), keeps the 44px touch floor, and reads in the body tone, or the muted tone when its section is empty (`data-quiet`).
 */
export const SECTION_LINK = 'inline-flex min-h-[var(--tap-min)] items-center rounded-[var(--radius-sm)] bg-transparent px-3 text-xs font-medium text-[var(--color-foreground)] transition-colors duration-100 hover:underline data-[quiet]:text-[var(--color-muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-[var(--color-ring)]'

/**
 * The sections a merged chip stacks, as in-page links under the chip strip: they name the hidden ones (ADL, restrictive practices) without another
 * tab level. Only for a chip with 3 or more; a `#id` link, so the existing hash scroll does the work. An empty section is muted, like a quiet chip.
 */
export function SectionLine({ tab, sections }: { tab: ParticipantTabKey; sections: readonly SectionLineItem[] }) {
  if (sections.length < 3) return null
  return (
    <nav aria-label="Sections on this page" className="mt-3 flex flex-wrap gap-x-1">
      {sections.map(s => (
        <Link key={s.id} className={SECTION_LINK} to={`?tab=${tab}#${s.id}`} {...(s.has ? {} : { 'data-quiet': 'true' })}>
          {s.title}{s.has ? null : <span className="sr-only">, not recorded</span>}
        </Link>
      ))}
    </nav>
  )
}
