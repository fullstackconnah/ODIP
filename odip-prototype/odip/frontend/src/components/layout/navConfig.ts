import type { PageKey, UserRole } from '@/lib/permissions'

/**
 * The navigation tree, in ONE place. The desktop sidebar, the mobile drawer (the same <aside>) and the mobile bottom bar are
 * all generated from `navItems` by AppLayout, so a page is added, moved or renamed here once. The bar used to be hand-written
 * JSX with its own copy of the Participants active rule; that is how it came to list four of twenty-one destinations.
 *
 * Everything in this file is pure (no React, no storage): AppLayout feeds it the signed-in role's permissions, the current
 * pathname and the pending counts, and gets back what to render. See navConfig.test.ts.
 */

/** Optional active-match predicate for a leaf. When present it REPLACES the default exact / path-prefix matching. */
export type NavMatch = (pathname: string) => boolean

/** Where a leaf's pending count comes from. AppLayout owns the polling hooks and passes the numbers in as `NavCounts`. */
export type NavBadgeSource = 'pendingLeave' | 'pendingCompletions' | 'pendingWitness'
export type NavCounts = Record<NavBadgeSource, number>

/** What a pending count is called in the announcement of its link ("3 leave requests pending, Leave"). */
export type NavBadge = { source: NavBadgeSource; noun: string }

/**
 * The bottom bar has two shapes: the office roles' and the field role's. A SupportWorker is the one role that works from a phone,
 * on shift, so their bar leads with My Shifts and Incidents instead of the Dashboard and the roster.
 */
export type BarAudience = 'office' | 'field'

/** The bar holds this many pages and then "More", which opens the drawer: five cells fit a 360px phone at 44px+ each. */
export const BAR_LINK_LIMIT = 4

/**
 * A place in the bottom bar. An entry with no slot is reached through More. `order` sorts within the bar, `audience` keeps a slot
 * to one of the two bars (omitted: both) and `label` is the short name the bar uses where the full one is too wide ("Roster").
 */
export type NavBarSlot = { order: number; label?: string; audience?: BarAudience }

export type NavLeaf = {
  to: string
  label: string
  /** Material Symbols ligature. The span that renders it is `aria-hidden`, so it never ends up in an accessible name. */
  msIcon: string
  page: PageKey
  /** The route also needs write access (App.tsx `requiresWrite`), so a role without it would be bounced: do not offer the link. */
  requiresWrite?: boolean
  requiresParticipantLifecycleMutation?: boolean
  /** Roles that can open the page but have somewhere better to start (the Dashboard, for a SupportWorker: My Shifts). */
  hideForRoles?: UserRole[]
  matchActive?: NavMatch
  badge?: NavBadge
  bar?: NavBarSlot
}

export type NavGroup = {
  /** Stable key for the open/closed state and the panel's DOM id. NOT the label: labels get renamed, ids are stored in localStorage. */
  id: string
  label: string
  msIcon: string
  /** What the children's pending counts add up to, for the announcement of the closed group ("7 approvals pending, Staff & roster"). */
  badgeNoun?: string
  bar?: NavBarSlot
  children: NavLeaf[]
}

export type NavEntry = NavLeaf | NavGroup

export function isGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry
}

/**
 * The Participants hub at /participants owns the Enquiries, Onboarding and Active stages behind a single tab strip, so the nav
 * shows one Participants entry. Anything nested under /participants/ (detail, intake, profile, agreement-draft, edit, ...) and the
 * standalone /onboarding/:id checklist still light it up.
 */
const participantsHubActive: NavMatch = pathname =>
  pathname === '/participants' || pathname.startsWith('/participants/') || pathname.startsWith('/onboarding/')

export const navItems: NavEntry[] = [
  // A SupportWorker starts from My Shifts: the Dashboard is KPIs they cannot act on. They keep 'dashboard' on their allow-list (so a link
  // to it still resolves), but `/` sends them to /portal (App.tsx HomeRoute) and the menu does not offer it.
  { to: '/', label: 'Dashboard', msIcon: 'dashboard', page: 'dashboard', hideForRoles: ['SupportWorker'], bar: { order: 1, audience: 'office' } },
  {
    to: '/portal',
    label: 'My Shifts',
    msIcon: 'calendar_today',
    page: 'portal',
    badge: { source: 'pendingWitness', noun: 'witness approval' },
    bar: { order: 1, audience: 'field' },
  },
  {
    id: 'trips',
    label: 'Trips',
    msIcon: 'map',
    bar: { order: 2 },
    children: [
      { to: '/trips', label: 'All Trips', msIcon: 'map', page: 'trips' },
      { to: '/schedule', label: 'Schedule', msIcon: 'calendar_month', page: 'schedule' },
      { to: '/bookings', label: 'Bookings', msIcon: 'description', page: 'bookings' },
      { to: '/accommodation', label: 'Accommodation', msIcon: 'home_work', page: 'accommodation' },
      { to: '/vehicles', label: 'Vehicles', msIcon: 'directions_car', page: 'vehicles' },
      // Today's tasks are trip-bound (a task needs a trip; the create form says so), so they live with the trips. The obligation
      // engine is making them a general work queue: if that lands, Tasks goes back to a top-level entry (one line to move).
      { to: '/tasks', label: 'Tasks', msIcon: 'checklist', page: 'tasks' },
    ],
  },
  {
    id: 'participants',
    label: 'Participants',
    msIcon: 'group',
    bar: { order: 4 },
    children: [
      { to: '/participants', label: 'Participants', msIcon: 'group', page: 'participants', matchActive: participantsHubActive },
      { to: '/medications', label: 'Medications', msIcon: 'pill', page: 'medications' },
      // cg04: the review pages are behind `requiresWrite` in App.tsx (so a SupportWorker would be bounced), and the API behind them admits
      // only the three management roles (so ReadOnly would get a 403): its own page key keeps both out of the menu and the route.
      { to: '/caregiver-submissions', label: 'Caregiver forms', msIcon: 'checklist_rtl', page: 'caregiver-submissions', requiresWrite: true },
    ],
  },
  {
    id: 'staff-roster',
    label: 'Staff & roster',
    msIcon: 'calendar_view_week',
    badgeNoun: 'approval',
    bar: { order: 3, label: 'Roster', audience: 'office' },
    children: [
      { to: '/rostering', label: 'Board', msIcon: 'calendar_view_week', page: 'rostering' },
      { to: '/rostering/patterns', label: 'Patterns', msIcon: 'event_repeat', page: 'rostering' },
      { to: '/rostering/compatibility', label: 'Compatibility', msIcon: 'join_inner', page: 'rostering' },
      {
        to: '/rostering/leave',
        label: 'Leave',
        msIcon: 'event_busy',
        page: 'leave-approvals',
        badge: { source: 'pendingLeave', noun: 'leave request' },
      },
      // Same 'rostering' PageKey as Board/Patterns/Compatibility (unlike Leave's own 'leave-approvals' key): ordinary
      // coordinator-only rostering work, so SupportWorker is already excluded with no new key needed.
      {
        to: '/rostering/completions',
        label: 'Completions',
        msIcon: 'fact_check',
        page: 'rostering',
        badge: { source: 'pendingCompletions', noun: 'shift completion' },
      },
      { to: '/staff', label: 'Staff', msIcon: 'manage_accounts', page: 'staff' },
      { to: '/qualifications', label: 'Qualifications', msIcon: 'health_and_safety', page: 'qualifications' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    msIcon: 'payments',
    children: [
      // Every participant's budget for the funding period running now, sorted by risk (budget phase 2b). Money, so its own page key: SupportWorker's allow-list does not name it and ReadOnly is refused it.
      { to: '/budgets', label: 'Budgets', msIcon: 'account_balance_wallet', page: 'budgets' },
    ],
  },
  { to: '/incidents', label: 'Incidents', msIcon: 'emergency', page: 'incidents', bar: { order: 5, audience: 'field' } },
  { to: '/settings', label: 'Settings', msIcon: 'settings', page: 'settings' },
]

export const navLeaves: NavLeaf[] = navItems.flatMap(entry => (isGroup(entry) ? entry.children : [entry]))

/** Every group id this build knows: what a saved open/closed layout is validated against. */
export const NAV_GROUP_IDS: ReadonlySet<string> = new Set(navItems.filter(isGroup).map(group => group.id))

// ── Active state ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Route matching is case-insensitive and ignores a trailing slash, as React Router's own is: /Trips/ renders Trips, so it lights it. */
function normalise(pathname: string): string {
  const lower = pathname.toLowerCase()
  return lower.length > 1 && lower.endsWith('/') ? lower.slice(0, -1) : lower
}

/** An exact path or a path-segment prefix: what a NavLink does without `end`. */
export function isRouteActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

/**
 * Whether a leaf needs an EXACT path match rather than the prefix match. It does when another leaf is nested under it
 * (/rostering has /rostering/patterns): otherwise it would stay lit on every one of its
 * children's pages next to their own entry. A leaf with no such nested sibling (/trips, whose /trips/:id is not a leaf) keeps the
 * prefix match so it stays lit on its own detail pages.
 */
export function isExactMatchOnly(to: string): boolean {
  return to === '/' || navLeaves.some(leaf => leaf.to !== to && leaf.to.startsWith(`${to}/`))
}

/** Active-state resolver for a leaf: `matchActive` takes precedence over the default matching. */
export function isLeafActive(leaf: NavLeaf, pathname: string): boolean {
  const path = normalise(pathname)
  if (leaf.matchActive) return leaf.matchActive(path)
  return isExactMatchOnly(leaf.to) ? path === leaf.to : isRouteActive(leaf.to, path)
}

export function isGroupActive(children: NavLeaf[], pathname: string): boolean {
  return children.some(child => isLeafActive(child, pathname))
}

// ── Who sees what ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The part of `usePermissions()` the menu depends on. */
export type NavAccess = {
  role: UserRole | null
  canAccessPage: (page: PageKey) => boolean
  canWrite: boolean
  canManageParticipantLifecycle: boolean
}

export function isLeafVisible(leaf: NavLeaf, access: NavAccess): boolean {
  return access.canAccessPage(leaf.page)
    && (!leaf.requiresWrite || access.canWrite)
    && (!leaf.requiresParticipantLifecycleMutation || access.canManageParticipantLifecycle)
    && !(access.role && leaf.hideForRoles?.includes(access.role))
}

export type ResolvedLink = { kind: 'link'; leaf: NavLeaf; bar?: NavBarSlot }
export type ResolvedGroup = { kind: 'group'; group: NavGroup; children: NavLeaf[] }
export type ResolvedEntry = ResolvedLink | ResolvedGroup

/**
 * The menu one role sees: leaves the role may not open are dropped, a group none of whose children survive disappears, and a group
 * with exactly one child left is a plain link to it (a header that opens onto a single row is a click for nothing). No role has such a
 * group today; it is what keeps a future role filter, or a new group holding one page, from producing one.
 */
export function resolveNav(entries: NavEntry[], access: NavAccess): ResolvedEntry[] {
  const resolved: ResolvedEntry[] = []
  for (const entry of entries) {
    if (!isGroup(entry)) {
      if (isLeafVisible(entry, access)) resolved.push({ kind: 'link', leaf: entry, bar: entry.bar })
      continue
    }
    const children = entry.children.filter(child => isLeafVisible(child, access))
    if (children.length === 0) continue
    if (children.length === 1) resolved.push({ kind: 'link', leaf: children[0], bar: entry.bar ?? children[0].bar })
    else resolved.push({ kind: 'group', group: entry, children })
  }
  return resolved
}

// ── Pending counts ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function leafCount(leaf: NavLeaf, counts: NavCounts): number {
  return leaf.badge ? counts[leaf.badge.source] : 0
}

/** A group's count is its visible children's counts added up, so a closed group still shows what waits inside it. */
export function groupCount(children: NavLeaf[], counts: NavCounts): number {
  return children.reduce((sum, child) => sum + leafCount(child, counts), 0)
}

// ── The bottom bar ───────────────────────────────────────────────────────────────────────────────────────────────────────

function barSlot(entry: ResolvedEntry): NavBarSlot | undefined {
  return entry.kind === 'group' ? entry.group.bar : entry.bar
}

/** The entries the bar shows for one audience, in bar order, at most BAR_LINK_LIMIT of them. "More" is added by the bar itself. */
export function barEntries(entries: ResolvedEntry[], audience: BarAudience): ResolvedEntry[] {
  return entries
    .filter(entry => {
      const slot = barSlot(entry)
      return !!slot && (!slot.audience || slot.audience === audience)
    })
    .sort((a, b) => barSlot(a)!.order - barSlot(b)!.order)
    .slice(0, BAR_LINK_LIMIT)
}

export type BarItem = {
  key: string
  to: string
  label: string
  msIcon: string
  active: boolean
  /** `page` for a link to the very page; `true` for a group's item, which is lit on any of the group's pages. */
  current: 'page' | 'true' | undefined
  count: number
  noun: string
}

/** A group's bar item opens its first visible page (Staff & roster: the Board) and is lit on any page of the group. */
export function toBarItem(entry: ResolvedEntry, pathname: string, counts: NavCounts): BarItem {
  if (entry.kind === 'group') {
    const active = isGroupActive(entry.children, pathname)
    return {
      key: entry.group.id,
      to: entry.children[0].to,
      label: entry.group.bar?.label ?? entry.group.label,
      msIcon: entry.group.msIcon,
      active,
      current: active ? 'true' : undefined,
      count: groupCount(entry.children, counts),
      noun: entry.group.badgeNoun ?? '',
    }
  }
  const active = isLeafActive(entry.leaf, pathname)
  return {
    key: entry.leaf.to,
    to: entry.leaf.to,
    label: entry.bar?.label ?? entry.leaf.label,
    msIcon: entry.leaf.msIcon,
    active,
    current: active ? 'page' : undefined,
    count: leafCount(entry.leaf, counts),
    noun: entry.leaf.badge?.noun ?? '',
  }
}
