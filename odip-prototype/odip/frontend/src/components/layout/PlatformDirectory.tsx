import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarDays, Grid2X2, Plus, Search } from 'lucide-react'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import { Modal } from '@/components/Modal'
import { TextField } from '@/components/TextField'
import type { usePermissions } from '@/lib/permissions'
import { pageDescription, platformLeaves } from './platformDirectoryModel'
import type { ResolvedEntry } from './navConfig'
import { getViewAs } from '@/lib/viewAs'

/** The compact trigger is a bare round icon on a phone and the field-style search from md (from xl beside the SuperAdmin switchers). */
const FIELD_MD = 'md:w-72 md:h-[var(--control-h)] md:justify-start md:rounded-[var(--radius-sm)] md:border md:border-[var(--color-field-border)] md:bg-[var(--color-field)] md:px-3 md:hover:bg-[var(--color-field)] md:hover:border-[var(--color-muted-foreground)]'
const FIELD_XL = 'xl:w-72 xl:h-[var(--control-h)] xl:justify-start xl:rounded-[var(--radius-sm)] xl:border xl:border-[var(--color-field-border)] xl:bg-[var(--color-field)] xl:px-3 xl:hover:bg-[var(--color-field)] xl:hover:border-[var(--color-muted-foreground)]'

export function PlatformDirectoryTrigger({ entries, compact = false, tight = false }: { entries: ResolvedEntry[]; compact?: boolean; tight?: boolean }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const close = () => setOpen(false)
  const term = query.trim().toLocaleLowerCase()
  const sections = entries.map(entry => ({
    key: entry.kind === 'group' ? entry.group.id : entry.leaf.to,
    label: entry.kind === 'group' ? entry.group.label : undefined,
    leaves: (entry.kind === 'group' ? entry.children : [entry.leaf]).filter(leaf =>
      `${leaf.label} ${pageDescription(leaf)}`.toLocaleLowerCase().includes(term)),
  })).filter(section => section.leaves.length > 0)

  return (
    <>
      {compact ? (
        <button type="button" className={`inline-flex shrink-0 items-center justify-center gap-2 size-8 pointer-coarse:min-h-[var(--tap-min)] pointer-coarse:min-w-[var(--tap-min)] rounded-full text-sm font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${tight ? FIELD_XL : FIELD_MD}`}
          aria-label="Find a page" title="Find a page" aria-haspopup="dialog" aria-expanded={open}
          onClick={() => { setQuery(''); setOpen(true) }}>
          <Search aria-hidden="true" className={`h-5 w-5 shrink-0 ${tight ? "xl:h-4 xl:w-4" : "md:h-4 md:w-4"}`} />
          <span className={tight ? 'max-xl:sr-only' : 'max-md:sr-only'}>Find a page…</span>
        </button>
      ) : (
        <Button variant="secondary" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11 w-full justify-between"
          aria-label="Explore the platform" aria-haspopup="dialog" aria-expanded={open}
          onClick={() => { setQuery(''); setOpen(true) }}>
          <span>Explore the platform</span>
          <Grid2X2 aria-hidden="true" className="h-4 w-4" />
        </Button>
      )}
      {createPortal(<Modal open={open} onClose={close} title="Explore the platform" size="lg"
        className="pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11 pointer-coarse:[&_input]:min-h-11">
        <TextField label="Find a page" type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Try leave or medications" hint="Search page names and purposes, not participant records." />
        {sections.length === 0 ? (
          <p role="status" className="py-6 text-sm text-[var(--color-muted-foreground)]">
            {entries.length === 0 ? 'No platform pages are available for this account.' : 'No matching page. Try a different page name.'}
          </p>
        ) : (
          <div className="mt-4 grid gap-[var(--section-gap)] sm:grid-cols-2">
            {sections.map(section => (
              <div key={section.key}>
                {section.label && <h4 className="mb-2 text-sm font-semibold">{section.label}</h4>}
                <ul className="space-y-1">
                  {section.leaves.map(leaf => (
                    <li key={leaf.to}>
                      <Link to={leaf.to} onClick={close}
                        className="flex min-h-[var(--tap-min)] gap-3 rounded-[var(--radius-sm)] p-2 text-sm hover:bg-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
                        <span className="material-symbols-outlined shrink-0 text-[var(--color-secondary)]" aria-hidden="true">{leaf.msIcon}</span>
                        <span className="min-w-0"><span className="block font-semibold">{leaf.label}</span>
                          <span className="block text-[13px] text-[var(--color-muted-foreground)]">{pageDescription(leaf)}</span></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Modal>, document.body)}
    </>
  )
}

export function DashboardShortcuts({ entries, permissions }: { entries: ResolvedEntry[]; permissions: ReturnType<typeof usePermissions> }) {
  const navigate = useNavigate()
  const leaves = platformLeaves(entries)
  const has = (to: string) => leaves.some(leaf => leaf.to === to)
  const inOrganisation = !permissions.isSuperAdmin || !!getViewAs('odip_viewing_tenant')
  const items = inOrganisation ? [
    ...(permissions.canWrite && has('/trips') ? [{ value: '/trips/new', label: 'New trip' }] : []),
    ...(permissions.canManageParticipantLifecycle && has('/participants') ? [{ value: '/participants/new-inquiry', label: 'New enquiry' }] : []),
    ...(permissions.canCreateIncidents && has('/incidents') ? [{ value: '/incidents/new', label: 'New incident' }] : []),
    ...(permissions.canWrite && has('/tasks') ? [{ value: '/tasks/new', label: 'New task' }] : []),
  ] : []
  if (!has('/rostering') && items.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {has('/rostering') && <Button variant="secondary" to="/rostering" className="pointer-coarse:min-h-11"><CalendarDays aria-hidden="true" className="h-4 w-4" />Open roster</Button>}
      {items.length > 0 && <div className="pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11"><Dropdown variant="menu" triggerVariant="secondary" label="New" icon={<Plus aria-hidden="true" className="h-4 w-4" />} items={items} onSelect={navigate} /></div>}
    </div>
  )
}
