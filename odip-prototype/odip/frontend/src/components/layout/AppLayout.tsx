import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import { usePreviousAppPathTracker } from '@/hooks/useBackNavigation'
import {
  LayoutDashboard, Map, CalendarRange, Users, Building2, Truck, UserCog,
  ListChecks, Settings, LogOut, Menu, X, ClipboardList, AlertTriangle, Plus, ChevronDown, Receipt,
  CalendarClock, Pill, CalendarCheck2, ClipboardCheck, CalendarOff, FileCheck
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/Button'
import TenantSwitcher from '@/components/layout/TenantSwitcher'
import UserSwitcher from '@/components/layout/UserSwitcher'
import { NavCountBadge } from '@/components/layout/NavCountBadge'
import { navBadgeLabel } from '@/components/layout/navBadgeLabel'
import { usePermissions, type PageKey } from '@/lib/permissions'
import { usePendingWitnessRequests, usePendingLeaveCount, usePendingCompletionCount } from '@/api/hooks'

type NavLeaf = { to: string; icon: React.ElementType; label: string; msIcon: string; page: PageKey; requiresParticipantLifecycleMutation?: boolean }
/**
 * Optional alternative active-match predicate for a leaf. When present, it OVERRIDES the
 * default NavLink `isActive` (which would otherwise be exact/prefix matching). The Participants
 * hub at /participants needs to highlight when the user is also on /inquiries or /onboarding,
 * so the standalone routes for those lifecycle stages feel "owned" by the hub entry.
 */
type NavLeafMatch = (pathname: string) => boolean
type NavLeafWithMatch = NavLeaf & { matchActive?: NavLeafMatch }
type NavParent = { label: string; icon: React.ElementType; msIcon: string; children: NavLeafWithMatch[] }
type NavEntry = NavLeaf | NavParent

const navItems: NavEntry[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', msIcon: 'dashboard', page: 'dashboard' },
  { to: '/portal', icon: CalendarCheck2, label: 'My Shifts', msIcon: 'calendar_today', page: 'portal' },
  {
    label: 'Trips',
    icon: Map,
    msIcon: 'map',
    children: [
      { to: '/trips', icon: Map, label: 'All Trips', msIcon: 'map', page: 'trips' },
      { to: '/schedule', icon: CalendarRange, label: 'Schedule', msIcon: 'calendar_month', page: 'schedule' },
      { to: '/bookings', icon: ClipboardList, label: 'Bookings', msIcon: 'description', page: 'bookings' },
      { to: '/accommodation', icon: Building2, label: 'Accommodation', msIcon: 'home_work', page: 'accommodation' },
      { to: '/vehicles', icon: Truck, label: 'Vehicles', msIcon: 'directions_car', page: 'vehicles' },
    ],
  },
  {
    label: 'Rostering',
    icon: CalendarClock,
    msIcon: 'calendar_view_week',
    children: [
      { to: '/rostering', icon: CalendarClock, label: 'Board', msIcon: 'calendar_view_week', page: 'rostering' },
      { to: '/rostering/patterns', icon: CalendarClock, label: 'Patterns', msIcon: 'event_repeat', page: 'rostering' },
      { to: '/rostering/compatibility', icon: CalendarClock, label: 'Compatibility', msIcon: 'join_inner', page: 'rostering' },
      { to: '/rostering/leave', icon: CalendarOff, label: 'Leave', msIcon: 'event_busy', page: 'leave-approvals' },
      // Same 'rostering' PageKey as Board/Patterns/Compatibility (unlike Leave's own
      // 'leave-approvals' key) — this is ordinary coordinator-only rostering work, so
      // SupportWorker is already excluded via canAccessPage('rostering') with no new key needed.
      { to: '/rostering/completions', icon: FileCheck, label: 'Completions', msIcon: 'fact_check', page: 'rostering' },
    ],
  },
  { to: '/billing', icon: Receipt, label: 'Billing', msIcon: 'receipt_long', page: 'billing' },
  {
    label: 'Participants',
    icon: Users,
    msIcon: 'group',
    children: [
      // The Participants hub at /participants owns the Enquiries, Onboarding and Active stages
      // behind a single tab strip, so the sidebar surfaces one Participants entry. Anything
      // nested under /participants/ (detail, intake, profile, agreement-draft, edit, etc.) and
      // the standalone /onboarding/:id checklist still light up this nav item.
      {
        to: '/participants',
        icon: Users,
        label: 'Participants',
        msIcon: 'group',
        page: 'participants',
        matchActive: (pathname) =>
          pathname === '/participants'
          || pathname.startsWith('/participants/')
          || pathname.startsWith('/onboarding/'),
      },
      { to: '/medications', icon: Pill, label: 'Medications', msIcon: 'pill', page: 'medications' },
      // cg04 — gated identically to "All Participants": same PageKey, so canAccessPage('participants')
      // decides visibility for both (the route itself further requires write access — see App.tsx).
      { to: '/caregiver-submissions', icon: ClipboardCheck, label: 'Caregiver forms', msIcon: 'checklist_rtl', page: 'participants' },
    ],
  },
  { to: '/staff', icon: UserCog, label: 'Staff', msIcon: 'manage_accounts', page: 'staff' },
  { to: '/tasks', icon: ListChecks, label: 'Tasks', msIcon: 'checklist', page: 'tasks' },
  { to: '/incidents', icon: AlertTriangle, label: 'Incidents', msIcon: 'emergency', page: 'incidents' },
  { to: '/qualifications', icon: Settings, label: 'Qualifications', msIcon: 'health_and_safety', page: 'qualifications' },
  { to: '/settings', icon: Settings, label: 'Settings', msIcon: 'settings', page: 'settings' },
]

/** Mirrors NavLink's default (non-`end`) active matching: exact path or a path segment prefix. */
function isRouteActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

const allNavLeaves: NavLeaf[] = navItems.flatMap(item => ('children' in item ? item.children : [item]))

/**
 * Whether a leaf's NavLink should require an exact path match (React Router's `end`) rather
 * than the default prefix match. A leaf needs `end` only when another nav entry's path is
 * nested more specifically under it (e.g. /rostering has sibling entries /rostering/patterns
 * and /rostering/compatibility) — otherwise it would stay "active" on every child route
 * alongside that more specific entry's own leaf. A leaf with no such nested sibling (e.g.
 * /trips, whose detail route /trips/:id isn't itself a nav entry) keeps the normal prefix
 * match so it stays active on its own detail/child routes.
 */
function isExactMatchOnly(to: string): boolean {
  return to === '/' || allNavLeaves.some(leaf => leaf.to !== to && leaf.to.startsWith(`${to}/`))
}

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
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
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    navItems.forEach(item => {
      if ('children' in item && item.children.some(child => isLeafActive(child, location.pathname))) {
        initial.add(item.label)
      }
    })
    return initial
  })

  useEffect(() => {
    if (!sidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [sidebarOpen])

  useEffect(() => {
    navItems.forEach(item => {
      if ('children' in item && item.children.some(child => isLeafActive(child, location.pathname))) {
        setOpenGroups(prev => (prev.has(item.label) ? prev : new Set(prev).add(item.label)))
      }
    })
  }, [location.pathname])

/** Active-state resolver for nav leaves — matchActive takes precedence over default prefix matching. */
function isLeafActive(leaf: NavLeafWithMatch, pathname: string): boolean {
  if (leaf.matchActive) return leaf.matchActive(pathname)
  return isRouteActive(leaf.to, pathname)
}

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

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
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-[232px] flex flex-col bg-[var(--color-sidebar)] pt-3 pb-3 px-3 transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Brand — ~48px tall total */}
        <div className="flex items-center gap-2.5 h-12 px-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-primary-container)] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[var(--color-primary-fixed)]" style={{ fontSize: '16px' }}>travel_explore</span>
          </div>
          <div className="min-w-0">
            <span className="font-extrabold text-[var(--color-primary)] tracking-tight text-sm" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Odip</span>
            <p className="text-[10px] text-[var(--color-muted-foreground)] opacity-70 leading-none mt-0.5">NDIS Management</p>
          </div>
        </div>

        {/* New Trip CTA — top of nav, below brand */}
        {permissions.canWrite && (
          <div className="px-1 pt-2 pb-1 shrink-0">
            <Button to="/trips/new" size="md" className="w-full">
              <Plus className="w-4 h-4" />
              New Trip
            </Button>
          </div>
        )}

        {/* Nav */}
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto pt-1">
          {navItems.map(item => {
            if ('children' in item) {
              const visibleChildren = item.children.filter(child =>
                permissions.canAccessPage(child.page)
                && (!child.requiresParticipantLifecycleMutation || permissions.canManageParticipantLifecycle),
              )
              if (visibleChildren.length === 0) return null

              const isOpen = openGroups.has(item.label)
              const isGroupActive = visibleChildren.some(child => isLeafActive(child, location.pathname))
              const groupId = `nav-group-${item.label.toLowerCase().replace(/\s+/g, '-')}`

              return (
                <div key={item.label}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={groupId}
                    onClick={() => toggleGroup(item.label)}
                    className={`flex items-center w-full gap-3 px-3 py-1.5 rounded-md text-sm transition-all duration-150 ${
                      isGroupActive
                        ? 'text-[var(--color-on-primary-fixed)] font-bold hover:bg-[var(--color-surface-container-high)]'
                        : 'text-[var(--color-secondary)] font-medium hover:bg-[var(--color-surface-container-high)]'
                    }`}
                  >
                    <span className="material-symbols-outlined shrink-0" style={{ fontSize: '18px' }}>{item.msIcon}</span>
                    <span className="flex-1 text-left truncate">{item.label}</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`w-4 h-4 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <div
                    id={groupId}
                    aria-hidden={!isOpen}
                    className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out motion-reduce:transition-none motion-reduce:duration-0 ${
                      isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="min-h-0 space-y-0.5">
                      {visibleChildren.map(({ to, label, msIcon, matchActive }) => {
                        const showLeaveBadge = to === '/rostering/leave' && pendingLeaveCount > 0
                        const showCompletionBadge = to === '/rostering/completions' && pendingCompletionCount > 0
                        const badgeCount = showLeaveBadge ? pendingLeaveCount : showCompletionBadge ? pendingCompletionCount : 0
                        const badgeNoun = showLeaveBadge ? 'leave request' : 'shift completion'
                        // matchActive overrides NavLink's default active matcher when supplied
                        // (see NavLeafMatch). Falls back to the standard exact/prefix logic.
                        const computeActive = (navLinkActive: boolean) => matchActive
                          ? matchActive(location.pathname)
                          : navLinkActive
                        return (
                          <NavLink key={to} to={to} end={isExactMatchOnly(to)}
                            tabIndex={isOpen ? undefined : -1}
                            aria-label={badgeCount > 0 ? navBadgeLabel(badgeCount, badgeNoun, label) : undefined}
                            className={({ isActive }) =>
                              `flex items-center gap-3 pl-7 pr-3 h-7 rounded-md text-sm transition-all duration-150 ${
                                computeActive(isActive)
                                  ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] font-bold'
                                  : 'text-[var(--color-secondary)] font-medium hover:bg-[var(--color-surface-container-high)]'
                              }`
                            }
                            onClick={() => setSidebarOpen(false)}
                          >
                            <span className="material-symbols-outlined shrink-0" style={{ fontSize: '18px' }}>{msIcon}</span>
                            <span className="flex-1 truncate">{label}</span>
                            {badgeCount > 0 && <NavCountBadge count={badgeCount} />}
                          </NavLink>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            }

            if (!permissions.canAccessPage(item.page)) return null
            const { to, label, msIcon } = item

            const showWitnessBadge = to === '/portal' && pendingWitnessCount > 0
            return (
              <NavLink key={to} to={to} end={isExactMatchOnly(to)}
                aria-label={showWitnessBadge ? navBadgeLabel(pendingWitnessCount, 'witness approval', label) : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-all duration-150 ${
                    isActive
                      ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] font-bold'
                      : 'text-[var(--color-secondary)] font-medium hover:bg-[var(--color-surface-container-high)]'
                  }`
                }
                onClick={() => setSidebarOpen(false)}
              >
                <span className="material-symbols-outlined shrink-0" style={{ fontSize: '18px' }}>{msIcon}</span>
                <span className="flex-1 truncate">{label}</span>
                {showWitnessBadge && <NavCountBadge count={pendingWitnessCount} />}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom */}
        <div className="pt-2 shrink-0">
          <button onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-1.5 h-8 rounded-md text-sm text-[var(--color-secondary)] hover:bg-[var(--color-sidebar-accent)] w-full transition-colors">
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
                ref={menuButtonRef}
                className="lg:hidden p-2 rounded-md hover:bg-[var(--color-accent)] transition-colors"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title={sidebarOpen ? 'Close menu' : 'Open menu'}
                aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={sidebarOpen}
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              {user.tenantName && (
                <span className="hidden sm:inline-flex text-xs bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-2.5 py-0.5 rounded-full border border-[var(--color-primary)]/20 font-medium">
                  {user.tenantName}
                </span>
              )}
              <div className="hidden md:flex items-center h-8 bg-[var(--color-sidebar)] rounded-md px-3 gap-2 w-[360px]">
                <span className="material-symbols-outlined text-[var(--color-muted-foreground)]" aria-hidden="true" style={{ fontSize: '18px' }}>search</span>
                <input
                  className="bg-transparent border-none outline-none text-sm w-full placeholder:text-[var(--color-muted-foreground)]/60 text-[var(--color-foreground)]"
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
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--color-accent)] transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                aria-label="Notifications"
                disabled
              >
                <span className="material-symbols-outlined text-[var(--color-primary)]" style={{ fontSize: '20px' }}>notifications</span>
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
              <span className="text-[var(--color-warning)] text-xs font-bold uppercase tracking-wide">Viewing as</span>
              <span className="text-[var(--color-on-warning-container)] text-sm font-semibold">{user.fullName}</span>
              <span className="text-[var(--color-warning)] text-xs">({user.role})</span>
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
          shorthand sets padding-bottom too, so an unprefixed pb-24 (clearing the fixed
          mobile bottom nav below lg) got silently overridden by md:p-6's padding-bottom
          for the 768-1024px range, trapping the last roster row behind the nav with no way
          to scroll it clear. Directional px and pt utilities leave pb-24 and lg:pb-8 as the
          only thing ever setting padding-bottom, so it can't be clobbered by a later
          breakpoint's shorthand again.
        */}
        <main id="main" className="flex-1 px-[var(--gutter,20px)] pt-4 pb-24 lg:pb-6">
          {/* Track the previous in-app pathname once at the authenticated shell so any
              page-header back control (e.g. the intake/profile wizards) can navigate to
              where the user actually came from instead of a hardcoded fallback. */}
          <BackPathTracker />
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav — items and the FAB are gated the same as the sidebar (same
          canAccessPage/canWrite helper), so a ReadOnly or restricted role never sees a link or
          a create action it doesn't have access to. */}
      <nav aria-label="Mobile" className="lg:hidden fixed bottom-0 left-0 right-0 bg-[var(--color-background)]/90 backdrop-blur-xl shadow-[0_-8px_24px_-4px_rgba(27,28,26,0.04)] px-6 py-3 flex justify-around items-center z-50">
        {permissions.canAccessPage('dashboard') && (
          <NavLink to="/" end className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-secondary)]'}`}>
            <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>dashboard</span>
            <span className="text-[10px] font-medium">Dashboard</span>
          </NavLink>
        )}
        {permissions.canAccessPage('trips') && (
          <NavLink to="/trips" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-secondary)]'}`}>
            <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>map</span>
            <span className="text-[10px] font-medium">Trips</span>
          </NavLink>
        )}
        {permissions.canWrite && (
          <Link to="/trips/new" className="relative -top-5">
            <div className="w-14 h-14 bg-[var(--color-primary)] text-white rounded-full shadow-2xl shadow-[var(--color-primary)]/40 flex items-center justify-center">
              <Plus className="w-6 h-6" />
            </div>
          </Link>
        )}
        {permissions.canAccessPage('participants') && (
          // Match the desktop Participants entry's matchActive predicate: anything under
          // /participants/* plus the standalone /onboarding/:id checklist still light up the
          // mobile nav item, since the hub owns all three lifecycle stages.
          <NavLink to="/participants" end className={({ isActive }) => `flex flex-col items-center gap-1 ${
            isActive
            || location.pathname.startsWith('/participants/')
            || location.pathname.startsWith('/onboarding/')
              ? 'text-[var(--color-primary)]'
              : 'text-[var(--color-secondary)]'
          }`}>
            <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>group</span>
            <span className="text-[10px] font-medium">People</span>
          </NavLink>
        )}
        {permissions.canAccessPage('settings') && (
          <NavLink to="/settings" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-secondary)]'}`}>
            <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>settings</span>
            <span className="text-[10px] font-medium">Settings</span>
          </NavLink>
        )}
      </nav>
    </div>
  )
}

function BackPathTracker(): null {
  // Mount the previous-path tracker at the authenticated shell so every page-header back
  // control can use real in-app history. See useBackNavigation.tsx.
  usePreviousAppPathTracker()
  return null
}
