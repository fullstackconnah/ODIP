import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronRight, Grid2X2, Plus, Search } from 'lucide-react'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Dropdown } from '@/components/Dropdown'
import { Modal } from '@/components/Modal'
import { TextField } from '@/components/TextField'
import { TAP_FLOOR } from '@/components/tapArea'
import type { usePermissions } from '@/lib/permissions'
import { pageDescription, platformLeaves } from './platformDirectoryModel'
import type { ResolvedEntry } from './navConfig'

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
      <Button variant="secondary" className={`pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${compact ? (tight ? 'max-xl:px-2 xl:w-72 xl:justify-start' : 'max-md:px-2 md:w-72 md:justify-start') : 'w-full justify-between'}`}
        aria-label={compact ? 'Find a page' : 'Explore the platform'} title={compact ? 'Find a page' : undefined} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setQuery(''); setOpen(true) }}>
        {compact ? <Search aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
        <span className={compact ? (tight ? 'max-xl:sr-only' : 'max-md:sr-only') : undefined}>{compact ? 'Find a page…' : 'Explore the platform'}</span>
        {!compact && <Grid2X2 aria-hidden="true" className="h-4 w-4" />}
      </Button>
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
  const inOrganisation = !permissions.isSuperAdmin || !!localStorage.getItem('odip_viewing_tenant')
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
      {items.length > 0 && <div className="pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11"><Dropdown variant="menu" label="New" icon={<Plus aria-hidden="true" className="h-4 w-4" />} items={items} onSelect={navigate} /></div>}
    </div>
  )
}

export function PlatformEntryRail({ entries }: { entries: ResolvedEntry[] }) {
  const leaves = platformLeaves(entries)
  const mainPages = ['/trips', '/participants', '/staff'].flatMap(to => leaves.filter(leaf => leaf.to === to))
  if (leaves.length === 0) return null
  return (
    <aside aria-label="Platform entry points" className="min-w-0 self-start">
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Your platform</h2>
        <p className="mb-3 text-[13px] text-[var(--color-muted-foreground)]">Open a workspace or find a page.</p>
        <ul className="mb-3 divide-y divide-[var(--color-border)]">
          {mainPages.map(leaf => <li key={leaf.to}>
            <Link to={leaf.to} className={`${TAP_FLOOR} flex w-full items-center justify-between gap-3 py-3 text-sm hover:text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]`}>
              <span><span className="block font-semibold">{leaf.label}</span><span className="block text-[13px] text-[var(--color-muted-foreground)]">{pageDescription(leaf)}</span></span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
            </Link>
          </li>)}
        </ul>
        <PlatformDirectoryTrigger entries={entries} />
      </Card>
    </aside>
  )
}
