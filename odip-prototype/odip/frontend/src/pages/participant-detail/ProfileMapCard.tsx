import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import type { GroupedTabKey } from './participantTabs'

export type ProfileMapLine = {
  tab: GroupedTabKey
  label: string
  /** The tab badge's number; shown when above zero, as the badge is. */
  count?: number
  chips: readonly { id: string; label: string; quiet: boolean }[]
}

const QUIET = 'text-[var(--color-muted-foreground)]'

/** The Overview map of the profile: one line per tab this role can see, its chips as links. A tab with one chip is one link under its own name. */
export function ProfileMapCard({ lines }: { lines: readonly ProfileMapLine[] }) {
  return (
    <Card title="In this profile">
      <ul className="flex flex-col gap-1">
        {lines.map(l => (
          <li key={l.tab} className="flex flex-wrap items-center gap-x-1">
            {l.chips.length === 1 ? (
              <Button variant="ghost" size="sm" className="min-h-[var(--tap-min)] font-semibold" to={`?tab=${l.tab}`}>{l.label}</Button>
            ) : (
              <>
                <span className="w-full text-sm font-semibold sm:w-36">{l.label}{l.count ? <span className="ml-1.5 font-normal tabular-nums text-[var(--color-muted-foreground)]">{l.count}</span> : null}</span>
                {l.chips.map(c => (
                  <Button key={c.id} variant="ghost" size="sm" className={`min-h-[var(--tap-min)] ${c.quiet ? QUIET : ''}`} to={`?tab=${l.tab}#${c.id}`} {...(c.quiet ? { 'data-quiet': 'true' } : {})}>
                    {c.label}{c.quiet ? <span className="sr-only">, not recorded</span> : null}
                  </Button>
                ))}
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
