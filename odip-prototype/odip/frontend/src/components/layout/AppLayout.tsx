import { Link, Outlet, useLocation } from 'react-router-dom'
import { usePreviousAppPathTracker } from '@/hooks/useBackNavigation'
import { useDialogBehavior } from '@/hooks/useDialogBehavior'
import { useIsBelowLg } from '@/hooks/useIsBelowLg'
import { LogOut, Menu, X, ChevronDown } from 'lucide-react'
import { useState, useRef } from 'react'
import { TAP_AREA } from '@/components/tapArea'
import TenantSwitcher from '@/components/layout/TenantSwitcher'
import UserSwitcher from '@/components/layout/UserSwitcher'
import { NavCountBadge } from '@/components/layout/NavCountBadge'
import { navBadgeLabel } from '@/components/layout/navBadgeLabel'
import {
  barEntries, groupCount, isGroup, isGroupActive, isLeafActive, leafCount, navItems, resolveNav, toBarItem,
  type BarAudience, type BarItem, type NavCounts, type NavGroup, type NavLeaf,
} from '@/components/layout/navConfig'
import { readStoredOpenGroups, storeGroupOpen } from '@/components/layout/navOpenGroups'
import { usePermissions } from '@/lib/permissions'
import { usePendingWitnessRequests, usePendingLeaveCount, usePendingCompletionCount } from '@/api/hooks'

/**
 * Mobile bottom-nav cell: icon over label, 42px tall. The cells share the row in equal widths (`flex-1`), so however many pages the
 * role's bar holds (four and "More", whatever the role) they stay evenly spaced whatever their label widths ("Trips" is 28px,
 * "Participants" 68px), and every cell is wider than 44px (68px at 360px wide with five cells). Touch needs 44px each way, so the box
 * also gets a `--tap-min` floor (0px on a mouse, 44px under `pointer: coarse`) and centres its content.
 * A floor, not TAP_AREA's pad: the cells tile the row edge to edge, so a pad reaching past a cell would overlap the next
 * link, and a floor cannot. Nothing changes on a mouse.
 */
const MOBILE_NAV_LINK = 'flex flex-1 min-h-[var(--tap-min)] min-w-[var(--tap-min)] flex-col items-center justify-center gap-1'

/** The lit item of the sidebar, the drawer and the bar's links: Pale Sprout with near-black bold text. */
const NAV_ACTIVE = 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] font-bold'
const NAV_IDLE = 'text-[var(--color-secondary)] font-medium hover:bg-[var(--color-surface-container-high)]'

/**
 * The groups to show open: the ones already open, plus any group that holds the current page. The page you are on is never hidden
 * inside a closed group on arrival; a group you close while on it stays closed until you navigate (see U3 in SidebarGroup).
 */
function withActiveGroups(open: ReadonlySet<string>, pathname: string): Set<string> {
  const next = new Set(open)
  for (const entry of navItems) {
    if (isGroup(entry) && entry.children.some(child => isLeafActive(child, pathname))) next.add(entry.id)
  }
  return next
}

/** The announcement of a leaf that carries a pending count: "3 leave requests pending, Leave"; none when nothing is pending. */
function leafBadgeLabel(leaf: NavLeaf, counts: NavCounts): string | undefined {
  return leaf.badge ? navBadgeLabel(leafCount(leaf, counts), leaf.badge.noun, leaf.label) : undefined
}

type SidebarContext = { pathname: string; counts: NavCounts; onNavigate: () => void }

/** One page in the sidebar or drawer: a top-level row, or (`nested`) a 28px row inside a group. */
function SidebarLink({ leaf, nested = false, tabbable = true, pathname, counts, onNavigate }: SidebarContext & {
  leaf: NavLeaf
  nested?: boolean
  /** False for a row inside a closed group: out of the Tab order along with the panel (which is `aria-hidden`). */
  tabbable?: boolean
}) {
  const active = isLeafActive(leaf, pathname)
  return (
    <Link
      to={leaf.to}
      tabIndex={tabbable ? undefined : -1}
      aria-current={active ? 'page' : undefined}
      aria-label={leafBadgeLabel(leaf, counts)}
      onClick={onNavigate}
      className={`flex items-center gap-3 ${nested ? 'pl-7 pr-3 h-7' : 'px-3 py-1.5'} min-h-[var(--tap-min)] rounded-md text-sm transition-all duration-150 ${active ? NAV_ACTIVE : NAV_IDLE}`}
    >
      <span className="material-symbols-outlined shrink-0" aria-hidden="true" style={{ fontSize: '18px' }}>{leaf.msIcon}</span>
      <span className="flex-1 truncate">{leaf.label}</span>
      <NavCountBadge count={leafCount(leaf, counts)} />
    </Link>
  )
}

/**
 * A collapsible group: a native <button aria-expanded aria-controls> above a grid panel that animates `grid-template-rows` 0fr to 1fr.
 * The panel is `aria-hidden` and its links leave the Tab order while it is closed. Two things keep a closed group honest:
 * it shows the sum of its children's pending counts (U2, so approvals do not vanish behind a closed header), and when it holds the
 * current page it takes the lit fill and `aria-current` (U3, so the page you are on is never marked by nothing).
 */
function SidebarGroup({ group, leaves, open, onToggle, pathname, counts, onNavigate }: SidebarContext & {
  group: NavGroup
  leaves: NavLeaf[]
  open: boolean
  onToggle: (id: string) => void
}) {
  const active = isGroupActive(leaves, pathname)
  const filled = active && !open
  const count = groupCount(leaves, counts)
  const panelId = `nav-group-${group.id}`
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-current={filled ? 'true' : undefined}
        aria-label={open ? undefined : navBadgeLabel(count, group.badgeNoun ?? 'item', group.label)}
        onClick={() => onToggle(group.id)}
        className={`flex items-center w-full gap-3 px-3 py-1.5 min-h-[var(--tap-min)] rounded-md text-sm transition-all duration-150 ${
          filled
            ? NAV_ACTIVE
            : active
              ? 'text-[var(--color-on-primary-fixed)] font-bold hover:bg-[var(--color-surface-container-high)]'
              : NAV_IDLE
        }`}
      >
        <span className="material-symbols-outlined shrink-0" aria-hidden="true" style={{ fontSize: '18px' }}>{group.msIcon}</span>
        <span className="flex-1 text-left truncate">{group.label}</span>
        {!open && <NavCountBadge count={count} />}
        <ChevronDown
          aria-hidden="true"
          className={`w-4 h-4 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        id={panelId}
        aria-hidden={!open}
        className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out motion-reduce:transition-none motion-reduce:duration-0 ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 space-y-0.5">
          {leaves.map(leaf => (
            <SidebarLink key={leaf.to} leaf={leaf} nested tabbable={open} pathname={pathname} counts={counts} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The mobile bottom bar, generated from the same config as the sidebar: the role's first pages in bar order, then "More", which
 * opens the drawer. "More" is lit on any page the bar does not list, so the bar always says where you are (it used to light nothing on
 * 24 of 33 routes). Gated exactly as the sidebar, so a restricted role never sees a link it cannot open.
 */
function BottomBar({ items, moreActive, menuOpen, onOpenMenu }: {
  items: BarItem[]
  moreActive: boolean
  menuOpen: boolean
  onOpenMenu: () => void
}) {
  const colour = (active: boolean) => (active ? 'text-[var(--color-primary)]' : 'text-[var(--color-secondary)]')
  return (
    <nav aria-label="Mobile" className="lg:hidden fixed bottom-0 left-0 right-0 h-[var(--mobile-nav-h)] bg-[var(--color-background)]/90 backdrop-blur-xl shadow-[0_-8px_24px_-4px_rgba(27,28,26,0.04)] px-2 flex items-center z-50">
      {items.map(item => (
        <Link
          key={item.key}
          to={item.to}
          aria-current={item.current}
          aria-label={item.count > 0 ? navBadgeLabel(item.count, item.noun, item.label) : undefined}
          className={`${MOBILE_NAV_LINK} ${colour(item.active)}`}
        >
          <span className="relative inline-flex">
            <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '22px' }}>{item.msIcon}</span>
            {item.count > 0 && (
              <span className="absolute -top-2 left-full -ml-2">
                <NavCountBadge count={item.count} />
              </span>
            )}
          </span>
          <span className="text-xs font-medium">{item.label}</span>
        </Link>
      ))}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-controls="app-menu"
        aria-current={moreActive ? 'true' : undefined}
        onClick={onOpenMenu}
        className={`${MOBILE_NAV_LINK} ${colour(moreActive)}`}
      >
        <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '22px' }}>menu</span>
        <span className="text-xs font-medium">More</span>
      </button>
    </nav>
  )
}

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  const location = useLocation()
  const permissions = usePermissions()
  // Only relevant to staff who can see the portal at all — fetching it unconditionally is fine
  // since usePendingWitnessRequests already resolves to an empty list for an unlinked account.
  const { data: pendingWitnessRequests } = usePendingWitnessRequests()
  const pendingWitnessCount = pendingWitnessRequests?.length ?? 0
  // LeaveController is Admin/Coordinator/SuperAdmin only server-side — gate the poll so a
  // SupportWorker/ReadOnly session doesn't 403-and-retry against /leave every 60s for the
  // life of the app shell.
  const pendingLeaveCount = usePendingLeaveCount(permissions.canApproveLeave)
  // RosteringController's completion endpoints are Admin/Coordinator/SuperAdmin only
  // server-side — same poll-gating rationale as pendingLeaveCount above.
  const pendingCompletionCount = usePendingCompletionCount(permissions.canReviewCompletions)
  const counts: NavCounts = { pendingLeave: pendingLeaveCount, pendingCompletions: pendingCompletionCount, pendingWitness: pendingWitnessCount }

  // Below lg the <aside> IS a drawer: a dialog while open (Escape closes it, Tab stays inside it, the page behind does not scroll,
  // focus goes back to whatever opened it). From lg up it is the permanent sidebar and none of that applies.
  const isBelowLg = useIsBelowLg()
  const drawerOpen = sidebarOpen && isBelowLg
  useDialogBehavior({ open: drawerOpen, onClose: () => setSidebarOpen(false), containerRef: drawerRef })
  // A drawer left open while the window grew past lg would open again on the way back down: forget it.
  if (!isBelowLg && sidebarOpen) setSidebarOpen(false)

  // Which groups are open: what the user chose to keep open last time, plus the group that holds the current page.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => withActiveGroups(readStoredOpenGroups(), location.pathname))
  // Navigating (a link, a Dashboard tile, the browser's Back) opens the group that now holds the page, and closes the drawer.
  const [seenPathname, setSeenPathname] = useState(location.pathname)
  if (seenPathname !== location.pathname) {
    setSeenPathname(location.pathname)
    setOpenGroups(open => withActiveGroups(open, location.pathname))
    setSidebarOpen(false)
  }

  const toggleGroup = (id: string) => {
    const willOpen = !openGroups.has(id)
    setOpenGroups(open => {
      const next = new Set(open)
      if (willOpen) next.add(id)
      else next.delete(id)
      return next
    })
    storeGroupOpen(id, willOpen)
  }

  const resolvedNav = resolveNav(navItems, permissions)
  const barAudience: BarAudience = permissions.isSupportWorker ? 'field' : 'office'
  const barItems = barEntries(resolvedNav, barAudience).map(entry => toBarItem(entry, location.pathname, counts))
  const closeDrawer = () => setSidebarOpen(false)

  const user = JSON.parse(localStorage.getItem('odip_user') || '{}')
  const isSuperAdmin = permissions.isSuperAdmin || !!localStorage.getItem('odip_superadmin_user')
  const viewingUserId = localStorage.getItem('odip_viewing_user')
  const viewingTenantId = localStorage.getItem('odip_viewing_tenant')
  const savedAdminUser = JSON.parse(localStorage.getItem('odip_superadmin_user') || '{}')

  const handleLogout = () => {
    localStorage.removeItem('odip_token')
    localStorage.removeItem('odip_user')
    localStorage.removeItem('odip_viewing_tenant')
    localStorage.removeItem('odip_viewing_user')
    localStorage.removeItem('odip_superadmin_user')
    window.location.href = '/login'
  }

  const initial = (user.fullName || 'A').charAt(0).toUpperCase()

  return (
    <div className="flex min-h-screen bg-[var(--color-background)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:bg-[var(--color-primary)] focus:text-[var(--color-primary-foreground)] focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:ring-offset-2"
      >
        Skip to content
      </a>
      {/*
        Mobile overlay. Below lg the open drawer (z-[60]) and its scrim (z-[55]) sit ABOVE the fixed bottom nav
        (z-50). They used to be z-50 and z-40: the nav comes later in the DOM, so it painted over the drawer's own
        "Sign Out" (which could not be tapped) and stayed live above the scrim. From lg up the sidebar is permanent,
        there is no bottom nav, and it keeps z-50 (`lg:z-50`) so a Modal (z-50, later in the DOM) still covers it.
      */}
      {drawerOpen && (
        <div aria-hidden="true" className="fixed inset-0 bg-black/40 z-[55] lg:hidden" onClick={closeDrawer} />
      )}

      {/*
        Sidebar / drawer. While the drawer is open it is a modal dialog ("Main menu"); closed below lg it is `invisible`, which takes its
        links out of the Tab order and the accessibility tree (they used to be 13 off-screen tab stops before the page). The
        visibility change rides the slide: opening sets it at once (a hidden element cannot take the focus the dialog moves in),
        closing waits for the slide-out to finish. At lg and up it is a plain landmark, always visible.
      */}
      <aside
        ref={drawerRef}
        id="app-menu"
        role={drawerOpen ? 'dialog' : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-label={drawerOpen ? 'Main menu' : undefined}
        tabIndex={drawerOpen ? -1 : undefined}
        className={`fixed inset-y-0 left-0 z-[60] lg:z-50 w-[232px] flex flex-col bg-[var(--color-sidebar)] pt-3 pb-3 px-3 duration-200 lg:translate-x-0 ${
          drawerOpen ? 'translate-x-0 transition-transform' : '-translate-x-full lg:translate-x-0 max-lg:invisible transition-[transform,visibility]'
        }`}
      >
        {/* Brand — ~48px tall total */}
        <div className="flex items-center gap-2.5 h-12 px-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-primary-container)] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[var(--color-primary-fixed)]" aria-hidden="true" style={{ fontSize: '16px' }}>travel_explore</span>
          </div>
          <div className="min-w-0">
            <span className="font-extrabold text-[var(--color-primary)] tracking-tight text-sm" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Odip</span>
            <p className="text-xs text-[var(--color-muted-foreground)] opacity-70 leading-none mt-0.5">NDIS Management</p>
          </div>
        </div>

        {/* Nav. Every item (group toggles, top-level links, group children, and "Sign Out" below) carries a
            `--tap-min` floor: 32px (28px for a group child) on a mouse as before, 44px under a coarse pointer, where
            this is the touch drawer (and the permanent sidebar of a touch tablet). The list scrolls inside the
            drawer when 44px items no longer fit its height. */}
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto pt-1">
          {resolvedNav.map(entry =>
            entry.kind === 'group' ? (
              <SidebarGroup
                key={entry.group.id}
                group={entry.group}
                leaves={entry.children}
                open={openGroups.has(entry.group.id)}
                onToggle={toggleGroup}
                pathname={location.pathname}
                counts={counts}
                onNavigate={closeDrawer}
              />
            ) : (
              <SidebarLink key={entry.leaf.to} leaf={entry.leaf} pathname={location.pathname} counts={counts} onNavigate={closeDrawer} />
            ),
          )}
        </nav>

        {/* Bottom */}
        <div className="pt-2 shrink-0">
          <button onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-1.5 h-8 min-h-[var(--tap-min)] rounded-md text-sm text-[var(--color-secondary)] hover:bg-[var(--color-sidebar-accent)] w-full transition-colors">
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 min-w-0 lg:ml-[232px] flex flex-col min-h-screen">
        {/* Top bar — fixed 48px */}
        <header className="sticky top-0 z-30 h-12 bg-[var(--color-background)]/80 backdrop-blur-xl shadow-[0_24px_32px_-12px_rgba(27,28,26,0.04)]">
          <div className="flex items-center justify-between h-full px-[var(--gutter,20px)]">
            <div className="flex items-center gap-4">
              <button
                className={`${TAP_AREA} lg:hidden p-2 rounded-md hover:bg-[var(--color-accent)] transition-colors`}
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title={sidebarOpen ? 'Close menu' : 'Open menu'}
                aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={sidebarOpen}
                aria-controls="app-menu"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              {user.tenantName && (
                <span className="hidden sm:inline-flex text-xs bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-2.5 py-0.5 rounded-full border border-[var(--color-primary)]/20 font-medium">
                  {user.tenantName}
                </span>
              )}
              {/* 32px on a mouse; the --tap-min floor makes the box 44px on touch (the header is 48px) and the input
                  stretches to fill it, so a tap anywhere in the field lands in the input, not just on its 20px line. */}
              <div className="hidden md:flex items-center h-8 min-h-[var(--tap-min)] bg-[var(--color-sidebar)] rounded-md px-3 gap-2 w-[360px]">
                <span className="material-symbols-outlined text-[var(--color-muted-foreground)]" aria-hidden="true" style={{ fontSize: '18px' }}>search</span>
                <input
                  className="bg-transparent border-none outline-none text-sm w-full pointer-coarse:self-stretch placeholder:text-[var(--color-muted-foreground)]/60 text-[var(--color-foreground)]"
                  placeholder="Search trips, participants..."
                  aria-label="Search trips and participants"
                  type="text"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isSuperAdmin && <TenantSwitcher />}
              {isSuperAdmin && viewingTenantId && <UserSwitcher />}
              {/* Placeholder pending the notifications feature (next on the roadmap) — disabled
                  rather than removed, so the control is honest about doing nothing right now
                  instead of silently absorbing clicks. */}
              <button
                className={`${TAP_AREA} w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--color-accent)] transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed`}
                aria-label="Notifications"
                disabled
              >
                <span className="material-symbols-outlined text-[var(--color-primary)]" aria-hidden="true" style={{ fontSize: '20px' }}>notifications</span>
              </button>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] flex items-center justify-center text-white font-bold text-sm shadow-md">
                {initial}
              </div>
            </div>
          </div>
        </header>

        {/* Impersonation banner */}
        {viewingUserId && (
          <div className="bg-[var(--color-warning-container)] border-b border-[var(--color-warning)] px-[var(--gutter,20px)] py-2 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-on-warning-container)] text-xs font-bold uppercase tracking-wide">Viewing as</span>
              <span className="text-[var(--color-on-warning-container)] text-sm font-semibold">{user.fullName}</span>
              <span className="text-[var(--color-on-warning-container)] text-xs">({user.role})</span>
            </div>
            <button
              onClick={() => {
                if (savedAdminUser.role) {
                  localStorage.setItem('odip_user', JSON.stringify(savedAdminUser))
                  localStorage.removeItem('odip_superadmin_user')
                }
                localStorage.removeItem('odip_viewing_user')
                window.location.reload()
              }}
              className="text-xs text-[var(--color-on-warning-container)] hover:opacity-80 font-medium underline underline-offset-2"
            >
              Exit view
            </button>
          </div>
        )}

        {/* Page content */}
        {/*
          Bottom padding is split out from the p-4, md:p-6, lg:p-8 shorthand on purpose: that
          shorthand sets padding-bottom too, so an unprefixed bottom padding (clearing the fixed
          mobile bottom nav below lg) got silently overridden by md:p-6's padding-bottom
          for the 768-1024px range, trapping the last roster row behind the nav with no way
          to scroll it clear. Directional px and pt utilities leave the pb-[...] and lg:pb-6 as
          the only thing ever setting padding-bottom, so it can't be clobbered by a later
          breakpoint's shorthand again. Below lg the padding is the nav's own height
          (--mobile-nav-h, the same var the nav is sized with and the sticky wizard footer
          sits above) plus 1.75rem of air: 96px on touch, exactly the old pb-24.
        */}
        <main id="main" className="flex-1 px-[var(--gutter,20px)] pt-4 pb-[calc(var(--mobile-nav-h)+1.75rem)] lg:pb-6">
          {/* Track the previous in-app pathname once at the authenticated shell so any
              page-header back control (e.g. the intake/profile wizards) can navigate to
              where the user actually came from instead of a hardcoded fallback. */}
          <BackPathTracker />
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav. Generated from the same config as the sidebar (see BottomBar), so it can never offer a link the role
          may not open or disagree with the sidebar about which page is lit. There is no create shortcut here (or in the sidebar):
          creating a trip is the "New Trip" button in the Trips page header. The cells share the row in equal widths
          (MOBILE_NAV_LINK), so the row needs no spacer or justify rule whatever pages a role's bar holds.
          The nav is exactly --mobile-nav-h tall (index.css: 66px on a mouse, 68px under `pointer:
          coarse`, where the links reach the 44px tap floor): a fixed height rather than whatever
          the content adds up to, so the sticky wizard footer (WizardNavFooter) can sit precisely
          above it by offsetting with the same var. */}
      <BottomBar
        items={barItems}
        moreActive={!barItems.some(item => item.active)}
        menuOpen={drawerOpen}
        onOpenMenu={() => setSidebarOpen(true)}
      />
    </div>
  )
}

function BackPathTracker(): null {
  // Mount the previous-path tracker at the authenticated shell so every page-header back
  // control can use real in-app history. See useBackNavigation.tsx.
  usePreviousAppPathTracker()
  return null
}
