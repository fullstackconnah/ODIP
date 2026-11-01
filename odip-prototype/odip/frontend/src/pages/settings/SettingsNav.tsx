import { Fragment, useEffect, useId, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { NAV_IDLE } from '@/components/layout/navConfig'
import type { SectionDef, SectionKey } from './settingsSections'

type SettingsNavProps = {
  sections: readonly SectionDef[]
  /** The open section, lit with aria-current on the rail. Null draws the phone list, where nothing is open. */
  current: SectionKey | null
  /** A SuperAdmin with no organisation: one line where the organisation groups would be. */
  noOrganisation: boolean
  /** On the phone list: the row of the section just left, which takes focus back. */
  returnFocusTo?: SectionKey | null
}

// The open section is a 2px primary bar and the on-selected ink, no fill: the main nav beside it owns the one lime area on the screen.
const ACTIVE = 'text-[var(--color-on-selected)] font-semibold bg-transparent rounded-l-none shadow-[inset_2px_0_0_var(--color-primary)]'

// From md: a rail item, 28px tall like the sidebar's group children (44px under a coarse pointer). Below md: a full-width card row with a
// chevron, the row-height floor, content ink (it is content here, not chrome) and a Mist press.
const ITEM =
  'flex h-7 min-h-[var(--tap-min)] items-center rounded-md px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ' +
  'max-md:h-auto max-md:min-h-[var(--row-h)] max-md:justify-between max-md:rounded-none max-md:px-[var(--card-pad)] max-md:font-medium max-md:text-[var(--color-foreground)] max-md:active:bg-[var(--color-muted)]'

/**
 * Settings' one list of sections, drawn two ways: the sticky rail beside the open section from md, and the grouped list that is the
 * whole screen below md. Group labels are plain text, not headings; each group's list is named by its label.
 */
export default function SettingsNav({ sections, current, noOrganisation, returnFocusTo }: SettingsNavProps) {
  const nav = useRef<HTMLElement>(null)
  const idBase = useId()
  useEffect(() => {
    if (returnFocusTo) nav.current?.querySelector<HTMLElement>(`[data-section="${returnFocusTo}"]`)?.focus()
    // A rail taller than the window scrolls inside itself; the lit item starts in view.
    else nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [returnFocusTo])

  const groups: { name: SectionDef['group']; items: SectionDef[] }[] = []
  for (const s of sections) {
    const last = groups.at(-1)
    if (last?.name === s.group) last.items.push(s)
    else groups.push({ name: s.group, items: [s] })
  }

  return (
    <nav
      ref={nav}
      aria-label="Settings"
      className="flex flex-col gap-[var(--section-gap)] md:sticky md:top-16 md:max-h-[calc(100dvh-4rem-var(--mobile-nav-h))] md:overflow-y-auto lg:max-h-[calc(100dvh-5rem)]"
    >
      {groups.map((group, index) => (
        <Fragment key={group.name}>
          <div>
            <p id={`${idBase}-${index}`} className="mb-1 px-3 text-xs font-semibold text-[var(--color-muted-foreground)] max-md:mb-2 max-md:px-0 max-md:text-[13px]">
              {group.name}
            </p>
            <ul
              aria-labelledby={`${idBase}-${index}`}
              className="flex flex-col max-md:divide-y max-md:divide-[var(--color-border)] max-md:overflow-hidden max-md:rounded-[var(--radius-md)] max-md:border max-md:border-[var(--color-border)] max-md:bg-[var(--color-card)]"
            >
              {group.items.map(s => (
                <li key={s.key}>
                  <Link
                    to={`/settings?section=${s.key}`}
                    data-section={s.key}
                    aria-current={s.key === current ? 'page' : undefined}
                    className={`${ITEM} ${s.key === current ? ACTIVE : NAV_IDLE}`}
                  >
                    {s.label}
                    <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)] md:hidden" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {noOrganisation && index === 0 && (
            <p className="px-3 text-[13px] text-[var(--color-muted-foreground)] max-md:px-0">Choose an organisation to see its settings.</p>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
