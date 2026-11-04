import { Link } from 'react-router-dom'
import { Card } from '@/components/Card'
import { SECTION_LINK } from './SectionLine'
import type { GroupedTabKey } from './participantTabs'

export type ProfileMapLine = {
  tab: GroupedTabKey
  label: string
  /** The tab badge's number; shown when above zero, as the badge is. */
  count?: number
  /** What the count counts, spoken ("3 active risks"), as the tab badge's screen-reader text. */
  spoken?: string
  chips: readonly { id: string; label: string; quiet: boolean }[]
}

/** The Overview map of the profile: one row per tab this role can see, its name in a left column and its chips as links in the right. A tab with one chip is one link under its own name. */
export function ProfileMapCard({ lines }: { lines: readonly ProfileMapLine[] }) {
  return (
    <Card title="In this profile">
      <ul aria-label="In this profile" className="flex flex-col gap-1">
        {lines.map(l => (
          <li key={l.tab} className="grid items-center sm:grid-cols-[9rem_1fr]">
            <span className="text-sm font-semibold">
              {l.label}
              {l.count ? <span className="ml-1.5 font-normal tabular-nums text-[var(--color-muted-foreground)]">{l.count}{l.spoken ? <span className="sr-only">, {l.spoken}</span> : null}</span> : null}
            </span>
            <div className="flex flex-wrap gap-x-1">
              {l.chips.map(c => (
                <Link key={c.id} className={SECTION_LINK} to={l.chips.length === 1 ? `?tab=${l.tab}` : `?tab=${l.tab}#${c.id}`} {...(c.quiet ? { 'data-quiet': 'true' } : {})}>
                  {c.label}{c.quiet ? <span className="sr-only">, not recorded</span> : null}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
