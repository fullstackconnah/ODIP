import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  BAR_LINK_LIMIT, NAV_GROUP_IDS, barEntries, groupCount, isExactMatchOnly, isGroup, isLeafActive, isLeafVisible, leafCount, navItems, navLeaves,
  resolveNav, toBarItem, type BarAudience, type NavAccess, type NavCounts, type NavEntry, type NavGroup,
} from './navConfig'
import { usePermissions } from '@/lib/permissions'

/** What a real session of this role is allowed: the same permissions the shell reads. */
function accessFor(role: string | null): NavAccess {
  if (role) localStorage.setItem('odip_user', JSON.stringify({ role }))
  return renderHook(() => usePermissions()).result.current
}

const NO_COUNTS: NavCounts = { pendingLeave: 0, pendingCompletions: 0, pendingWitness: 0 }
const everything: NavAccess = { role: null, canAccessPage: () => true, canWrite: true, canManageParticipantLifecycle: true }

/** A menu as "label" / "label: child | child" strings, for readable assertions. */
const shape = (entries: ReturnType<typeof resolveNav>) =>
  entries.map(entry => (entry.kind === 'group' ? `${entry.group.label}: ${entry.children.map(child => child.label).join(' | ')}` : entry.leaf.label))

afterEach(() => {
  localStorage.clear()
})

describe('navConfig — the tree itself', () => {
  it('lists every page once: no two leaves share a path', () => {
    const paths = navLeaves.map(leaf => leaf.to)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('gives every group a stable id that is not its label, with no duplicates; NAV_GROUP_IDS is exactly those', () => {
    const groups = navItems.filter(isGroup)
    const ids = groups.map(group => group.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const group of groups) expect(group.id, group.label).toMatch(/^[a-z]+(-[a-z]+)*$/)
    expect([...NAV_GROUP_IDS].sort()).toEqual([...ids].sort())
  })

  it('fits each bar: at most BAR_LINK_LIMIT pages for either audience even when a role could see everything', () => {
    for (const audience of ['office', 'field'] as BarAudience[]) {
      const entries = barEntries(resolveNav(navItems, everything), audience)
      expect(entries.length, audience).toBeLessThanOrEqual(BAR_LINK_LIMIT)
      expect(entries.length, audience).toBeGreaterThan(0)
    }
  })

  it('has one slot per order in each bar, so the bar order is never a tie', () => {
    for (const audience of ['office', 'field'] as BarAudience[]) {
      const orders = navItems
        .map(entry => entry.bar)
        .filter(slot => slot && (!slot.audience || slot.audience === audience))
        .map(slot => slot!.order)
      expect(new Set(orders).size, audience).toBe(orders.length)
    }
  })
})

describe('navConfig — active state', () => {
  const leaf = (to: string) => navLeaves.find(candidate => candidate.to === to)!

  it('matches a leaf exactly or by path segment, as NavLink does', () => {
    expect(isLeafActive(leaf('/trips'), '/trips')).toBe(true)
    expect(isLeafActive(leaf('/trips'), '/trips/t-1')).toBe(true)
    expect(isLeafActive(leaf('/trips'), '/tripsy')).toBe(false)
    expect(isLeafActive(leaf('/'), '/')).toBe(true)
    expect(isLeafActive(leaf('/'), '/trips')).toBe(false)
  })

  it('ignores case and a trailing slash, as the router does', () => {
    expect(isLeafActive(leaf('/trips'), '/Trips/')).toBe(true)
    expect(isLeafActive(leaf('/staff'), '/STAFF/s-1')).toBe(true)
  })

  it('keeps /rostering exact-only, since /rostering/patterns is a leaf of its own', () => {
    expect(isExactMatchOnly('/rostering')).toBe(true)
    expect(isLeafActive(leaf('/rostering'), '/rostering')).toBe(true)
    expect(isLeafActive(leaf('/rostering'), '/rostering/patterns')).toBe(false)
    expect(isLeafActive(leaf('/rostering/patterns'), '/rostering/patterns')).toBe(true)
  })

  it('lets matchActive replace the default: the Participants hub owns /participants/*, /onboarding/:id and nothing else', () => {
    const hub = leaf('/participants')
    for (const path of ['/participants', '/participants/p-1', '/participants/p-1/profile', '/onboarding/p-1']) expect(isLeafActive(hub, path), path).toBe(true)
    for (const path of ['/participantsx', '/medications', '/onboarding']) expect(isLeafActive(hub, path), path).toBe(false)
  })

  it('keeps /billing exact-only now that Claim batches is nested under it, and lights Claim batches on the batch pages and on a claim', () => {
    expect(isExactMatchOnly('/billing')).toBe(true)
    const billing = leaf('/billing')
    const batches = leaf('/billing/claim-batches')
    expect(isLeafActive(billing, '/billing')).toBe(true)
    for (const path of ['/billing/claim-batches', '/billing/claim-batches/new', '/billing/claim-batches/cb-1', '/claims/claim-1']) {
      expect(isLeafActive(billing, path), `Billing on ${path}`).toBe(false)
      expect(isLeafActive(batches, path), `Claim batches on ${path}`).toBe(true)
    }
    expect(isLeafActive(batches, '/billing')).toBe(false)
    expect(isLeafActive(batches, '/claimsx/1')).toBe(false)
  })
})

describe('navConfig — who sees what', () => {
  it('drops a leaf the role may not open, and one whose route needs write access when the role has none', () => {
    const caregiverForms = navLeaves.find(candidate => candidate.to === '/caregiver-submissions')!
    expect(isLeafVisible(caregiverForms, accessFor('Coordinator'))).toBe(true)
    expect(isLeafVisible(caregiverForms, accessFor('SupportWorker'))).toBe(false)
    expect(isLeafVisible(caregiverForms, { ...everything, canWrite: false })).toBe(false)
  })

  it('gives a SupportWorker only their pages, no Dashboard, and no group that has lost every child', () => {
    expect(shape(resolveNav(navItems, accessFor('SupportWorker')))).toEqual([
      'My Shifts', 'Trips: All Trips | Schedule | Tasks', 'Participants: Participants | Medications', 'Incidents',
    ])
  })

  it('gives ReadOnly what its API lets it read: no Rostering pages but Staff and Qualifications, no Finance, no Caregiver forms, no Settings', () => {
    expect(shape(resolveNav(navItems, accessFor('ReadOnly')))).toEqual([
      'Dashboard',
      'My Shifts',
      'Trips: All Trips | Schedule | Bookings | Accommodation | Vehicles | Tasks',
      'Participants: Participants | Medications',
      'Staff & roster: Staff | Qualifications',
      'Incidents',
    ])
  })

  it('keeps the Dashboard for every role but a SupportWorker (hideForRoles), whatever the page access', () => {
    const dashboard = navLeaves.find(candidate => candidate.to === '/')!
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator', 'ReadOnly']) expect(isLeafVisible(dashboard, accessFor(role)), role).toBe(true)
    // 'dashboard' stays on a SupportWorker's allow-list (a link to `/` must still resolve): it is the menu that leaves it out.
    expect(accessFor('SupportWorker').canAccessPage('dashboard')).toBe(true)
    expect(isLeafVisible(dashboard, accessFor('SupportWorker'))).toBe(false)
  })

  it('shows a role with no restriction everything, in config order', () => {
    expect(shape(resolveNav(navItems, accessFor('Admin')))).toEqual([
      'Dashboard',
      'My Shifts',
      'Trips: All Trips | Schedule | Bookings | Accommodation | Vehicles | Tasks',
      'Participants: Participants | Medications | Caregiver forms',
      'Staff & roster: Board | Patterns | Compatibility | Leave | Completions | Staff | Qualifications',
      'Finance: Billing | Claim batches',
      'Incidents',
      'Settings',
    ])
  })

  it('renders a group with exactly one visible child as that child, as a plain link (U4)', () => {
    const entries: NavEntry[] = [
      { to: '/', label: 'Home', msIcon: 'home', page: 'dashboard' },
      {
        id: 'compliance',
        label: 'Compliance',
        msIcon: 'shield',
        bar: { order: 2, label: 'Comply' },
        children: [
          { to: '/incidents', label: 'Incidents', msIcon: 'emergency', page: 'incidents' },
          { to: '/audit', label: 'Audit log', msIcon: 'history', page: 'settings' },
        ],
      },
    ]
    const onlyIncidents: NavAccess = { ...everything, canAccessPage: page => page !== 'settings' }

    const [home, promoted] = resolveNav(entries, onlyIncidents)
    expect(home.kind).toBe('link')
    expect(promoted.kind).toBe('link')
    // The child is what renders (its own label and path), and it keeps the group's place in the bar.
    expect(promoted).toMatchObject({ kind: 'link', leaf: { label: 'Incidents', to: '/incidents' }, bar: { order: 2, label: 'Comply' } })
    // With both children visible it stays a group; with none it disappears.
    expect(resolveNav(entries, everything)[1].kind).toBe('group')
    expect(resolveNav(entries, { ...everything, canAccessPage: page => page === 'dashboard' })).toHaveLength(1)
  })

  it('does not change a leaf that is not in a group', () => {
    const [only] = resolveNav([{ to: '/', label: 'Home', msIcon: 'home', page: 'dashboard' }], everything)
    expect(only).toMatchObject({ kind: 'link', leaf: { label: 'Home' } })
  })

  it('hides a leaf from the roles it names in hideForRoles, whatever their page access', () => {
    const entries: NavEntry[] = [{ to: '/', label: 'Home', msIcon: 'home', page: 'dashboard', hideForRoles: ['SupportWorker'] }]
    expect(resolveNav(entries, { ...everything, role: 'SupportWorker' })).toHaveLength(0)
    expect(resolveNav(entries, { ...everything, role: 'Admin' })).toHaveLength(1)
    expect(resolveNav(entries, { ...everything, role: null })).toHaveLength(1)
  })
})

describe('navConfig — pending counts', () => {
  const group = navItems.find((entry): entry is NavGroup => isGroup(entry) && entry.id === 'staff-roster')!

  it('reads a leaf\'s count from its badge source, and zero for a leaf without one', () => {
    const counts = { ...NO_COUNTS, pendingLeave: 3, pendingCompletions: 4, pendingWitness: 2 }
    expect(leafCount(group.children.find(child => child.label === 'Leave')!, counts)).toBe(3)
    expect(leafCount(group.children.find(child => child.label === 'Completions')!, counts)).toBe(4)
    expect(leafCount(navLeaves.find(child => child.to === '/portal')!, counts)).toBe(2)
    expect(leafCount(navLeaves.find(child => child.to === '/trips')!, counts)).toBe(0)
  })

  it('adds a group\'s counts up over the children it is given, and only those', () => {
    const counts = { ...NO_COUNTS, pendingLeave: 3, pendingCompletions: 4 }
    expect(groupCount(group.children, counts)).toBe(7)
    expect(groupCount(group.children.filter(child => child.label !== 'Leave'), counts)).toBe(4)
    expect(groupCount([], counts)).toBe(0)
  })
})

describe('navConfig — the bottom bar', () => {
  const bar = (role: string, audience: BarAudience) => barEntries(resolveNav(navItems, accessFor(role)), audience)
  const labels = (role: string, audience: BarAudience, pathname = '/', counts = NO_COUNTS) =>
    bar(role, audience).map(entry => toBarItem(entry, pathname, counts).label)

  it('gives the office roles Dashboard, Trips, Roster, Participants, in that order', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator', 'ReadOnly']) expect(labels(role, 'office'), role).toEqual(['Dashboard', 'Trips', 'Roster', 'Participants'])
  })

  it('gives a SupportWorker My Shifts, Trips, Participants, Incidents, in that order', () => {
    expect(labels('SupportWorker', 'field')).toEqual(['My Shifts', 'Trips', 'Participants', 'Incidents'])
  })

  it('keeps an entry out of a bar its audience excludes, even when the role could see it', () => {
    expect(labels('Admin', 'field')).toEqual(['My Shifts', 'Trips', 'Participants', 'Incidents'])
    expect(labels('SupportWorker', 'office')).toEqual(['Trips', 'Participants'])
  })

  it('cuts a bar that would be longer than BAR_LINK_LIMIT, by order', () => {
    const entries: NavEntry[] = Array.from({ length: BAR_LINK_LIMIT + 2 }, (_, index) => ({
      to: `/p${index}`, label: `P${index}`, msIcon: 'x', page: 'dashboard' as const, bar: { order: BAR_LINK_LIMIT + 2 - index },
    }))
    const kept = barEntries(resolveNav(entries, everything), 'office').map(entry => toBarItem(entry, '/', NO_COUNTS).label)
    // Orders run 6 down to 1 over P0..P5, so ascending order is P5 first, and the two with the highest orders (P1, P0) are the ones cut.
    expect(kept).toEqual(['P5', 'P4', 'P3', 'P2'])
    expect(kept).toHaveLength(BAR_LINK_LIMIT)
  })

  it('opens a group\'s first visible page, and lights on any page of the group with aria-current "true"', () => {
    const [, trips, roster] = bar('Coordinator', 'office').map(entry => toBarItem(entry, '/rostering/leave', NO_COUNTS))
    expect(trips).toMatchObject({ to: '/trips', active: false, current: undefined })
    expect(roster).toMatchObject({ to: '/rostering', label: 'Roster', active: true, current: 'true' })
  })

  it('sends ReadOnly, which cannot open the Board, to Staff from the Roster cell', () => {
    const items = bar('ReadOnly', 'office').map(entry => toBarItem(entry, '/', NO_COUNTS))
    expect(items.map(item => item.label)).toEqual(['Dashboard', 'Trips', 'Roster', 'Participants'])
    expect(items[2].to).toBe('/staff')
  })

  it('sends a role that cannot open the Board to the first page it can open', () => {
    const access: NavAccess = { ...everything, canAccessPage: page => page !== 'rostering' && page !== 'leave-approvals' }
    const [roster] = barEntries(resolveNav(navItems, access), 'office').filter(entry => entry.kind === 'group' && entry.group.id === 'staff-roster')
    expect(toBarItem(roster, '/', NO_COUNTS).to).toBe('/staff')
  })

  it('lights a page\'s own cell with aria-current "page", and carries a count and its noun', () => {
    const items = bar('Coordinator', 'office').map(entry => toBarItem(entry, '/', { ...NO_COUNTS, pendingLeave: 3, pendingCompletions: 4 }))
    expect(items[0]).toMatchObject({ label: 'Dashboard', active: true, current: 'page', count: 0 })
    expect(items[2]).toMatchObject({ label: 'Roster', count: 7, noun: 'approval', active: false })
    const [myShifts] = bar('SupportWorker', 'field').map(entry => toBarItem(entry, '/portal', { ...NO_COUNTS, pendingWitness: 2 }))
    expect(myShifts).toMatchObject({ label: 'My Shifts', count: 2, noun: 'witness approval', active: true, current: 'page' })
  })
})
