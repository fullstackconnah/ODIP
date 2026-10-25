import { Link, Outlet, useLocation } from 'react-router-dom'
import { usePreviousAppPathTracker } from '@/hooks/useBackNavigation'
import { useDialogBehavior } from '@/hooks/useDialogBehavior'
import { useIsBelowLg } from '@/hooks/useIsBelowLg'
import { LogOut, Menu, X, ChevronDown } from 'lucide-react'
import { Suspense, useCallback, useId, useState, useRef } from 'react'
import ErrorBoundary from '@/components/ErrorBoundary'
import TenantSwitcher from '@/components/layout/TenantSwitcher'
import UserSwitcher from '@/components/layout/UserSwitcher'
import NotificationBell from '@/components/layout/NotificationBell'
import { NavCountBadge } from '@/components/layout/NavCountBadge'
import { navBadgeLabel } from '@/components/layout/navBadgeLabel'
import PlatformFooter from '@/components/layout/PlatformFooter'
import { PlatformDirectoryTrigger } from '@/components/layout/PlatformDirectory'
import { platformNavigation } from '@/components/layout/platformDirectoryModel'
import {
  barEntries, groupCount, isGroup, isGroupActive, isLeafActive, leafCount, NAV_ACTIVE, NAV_IDLE, navItems, navLeaves, isLeafVisible, isWorkspaceHidden, resolveNav, toBarItem,
  type BarAudience, type BarItem, type NavCounts, type NavGroup, type NavLeaf,
} from '@/components/layout/navConfig'
import { readStoredOpenGroups, storeGroupOpen } from '@/components/layout/navOpenGroups'
import { usePermissions } from '@/lib/permissions'
import { usePendingWitnessRequests, usePendingLeaveCount, usePendingCompletionCount, useModuleVisibility } from '@/api/hooks'
import { endSession } from '@/api/client'
import { Wordmark } from '@/components/Wordmark'
import { useUiPreferences } from '@/hooks/useUiPreferences'
import { RailFlyout } from '@/components/layout/RailFlyout'
import { useRailTooltip, type RailTipProps } from '@/components/layout/RailTooltip'

/**
 * Mobile bottom-nav cell: icon over label, 42px tall. The cells share the row in equal widths (`flex-1`), so however many pages the
 * role's bar holds (four and "More", whatever the role) they stay evenly spaced whatever their label widths ("Trips" is 28px,
 * "Participants" 68px), and every cell is wider than 44px (68px at 360px wide with five cells). Touch needs 44px each way, so the box
 * also gets a `--tap-min` floor (0px on a mouse, 44px under `pointer: coarse`) and centres its content.
 * A floor, not TAP_AREA's pad: the cells tile the row edge to edge, so a pad reaching past a cell would overlap the next
 * link, and a floor cannot. Nothing changes on a mouse.
 */
const MOBILE_NAV_LINK = 'flex flex-1 min-h-[var(--tap-min)] min-w-[var(--tap-min)] flex-col items-center justify-center gap-1'

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

/** What the icon rail hands its items: the tooltip handlers, and the one open flyout (the group's id and its trigger button). */
type RailContext = {
  tip: (label: string, count: number) => RailTipProps
  flyout: { id: string; trigger: HTMLElement } | null
  toggleFlyout: (id: string, trigger: HTMLElement) => void
  closeFlyout: (focusTrigger: boolean) => void
}

/** A 40px square (44px under a coarse pointer) holding one 18px icon: every item of the icon rail. */
const RAIL_ITEM = 'flex items-center justify-center size-10 pointer-coarse:size-11 rounded-md text-sm transition-colors duration-150'

/** The wide sidebar's bottom rows (Sign out, Collapse sidebar). */
const WIDE_FOOT_ROW = 'flex items-center gap-3 px-3 py-1.5 h-8 min-h-[var(--tap-min)] rounded-md text-sm w-full transition-colors'

/** The icon of a rail item with its count on it, placed exactly as the bottom bar places it. The announcement stays on the item's name. */
function RailIcon({ msIcon, count }: { msIcon: string; count: number }) {
  return (
    <span className="relative inline-flex">
      <span className="material-symbols-outlined shrink-0" aria-hidden="true" style={{ fontSize: '18px' }}>{msIcon}</span>
      {count > 0 && (
        <span className="absolute -top-2 left-full -ml-2">
          <NavCountBadge count={count} />
        </span>
      )}
    </span>
  )
}

/** One page in the sidebar or drawer: a top-level row, or (`nested`) a 28px row inside a group. In the rail (`rail`) a top-level page is an icon square. */
function SidebarLink({ leaf, nested = false, tabbable = true, rail, pathname, counts, onNavigate }: SidebarContext & {
  leaf: NavLeaf
  nested?: boolean
  /** False for a row inside a closed group: out of the Tab order along with the panel (which is `aria-hidden`). */
  tabbable?: boolean
  rail?: RailContext
}) {
  const active = isLeafActive(leaf, pathname)
  if (rail) {
    const count = leafCount(leaf, counts)
    return (
      <Link
        to={leaf.to}
        aria-current={active ? 'page' : undefined}
        aria-label={leafBadgeLabel(leaf, counts)}
        onClick={onNavigate}
        className={`${RAIL_ITEM} ${active ? NAV_ACTIVE : NAV_IDLE}`}
        {...rail.tip(leaf.label, count)}
      >
        <RailIcon msIcon={leaf.msIcon} count={count} />
        <span className="sr-only">{leaf.label}</span>
      </Link>
    )
  }
  return (
    <Link
      to={leaf.to}
      tabIndex={tabbable ? undefined : -1}
      aria-current={active ? 'page' : undefined}
      aria-label={leafBadgeLabel(leaf, counts)}
      onClick={onNavigate}
      className={`flex items-center gap-3 ${nested ? 'pl-7 pr-3 h-7' : 'px-3 py-1.5'} min-h-[var(--tap-min)] rounded-md text-sm transition-colors duration-150 ${active ? NAV_ACTIVE : NAV_IDLE}`}
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
        // One active signal: the open group's lit child. The header is lit only when closed over the current page (U3).
        className={`flex items-center w-full gap-3 px-3 py-1.5 min-h-[var(--tap-min)] rounded-md text-sm transition-colors duration-150 ${filled ? NAV_ACTIVE : NAV_IDLE}`}
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
 * A group in the icon rail: one 40px button that opens its pages in a flyout beside the rail (a disclosure, like the bell's popover).
 * The pages stay ordinary links. The group is lit, with `aria-current`, whenever it holds the current page, because the rail cannot
 * show it open inline. The saved open groups of the wide sidebar are not touched.
 */
function RailGroup({ id, label, msIcon, noun, leaves, rail, pathname, counts, onNavigate }: SidebarContext & {
  id: string
  label: string
  msIcon: string
  noun: string
  leaves: NavLeaf[]
  rail: RailContext
}) {
  const panelId = useId()
  const active = isGroupActive(leaves, pathname)
  const count = groupCount(leaves, counts)
  const open = rail.flyout?.id === id
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-current={active ? 'true' : undefined}
        aria-label={navBadgeLabel(count, noun, label)}
        onClick={e => rail.toggleFlyout(id, e.currentTarget)}
        onKeyDown={e => {
          if (e.key !== 'ArrowDown') return
          e.preventDefault()
          if (!open) rail.toggleFlyout(id, e.currentTarget)
        }}
        className={`${RAIL_ITEM} ${active ? NAV_ACTIVE : open ? 'bg-[var(--color-surface-container-high)] text-[var(--color-secondary)] font-medium' : NAV_IDLE}`}
        {...(open ? {} : rail.tip(label, count))}
      >
        <RailIcon msIcon={msIcon} count={count} />
        <span className="sr-only">{label}</span>
      </button>
      {open && rail.flyout && (
        <RailFlyout id={panelId} label={label} trigger={rail.flyout.trigger} onClose={rail.closeFlyout}>
          {leaves.map(leaf => (
            <SidebarLink
              key={leaf.to}
              leaf={leaf}
              pathname={pathname}
              counts={counts}
              onNavigate={() => {
                onNavigate()
                rail.closeFlyout(true)
              }}
            />
          ))}
        </RailFlyout>
      )}
    </>
  )
}

/** The brand in the rail: the favicon's "b" on a primary tile. Not a link, like the wordmark; assistive tech still reads the name. */
function BrandTile() {
  return (
    <span className="inline-flex">
      <span className="sr-only">Bunya Support</span>
      <svg aria-hidden="true" viewBox="0 0 32 32" className="size-8">
        <rect width="32" height="32" rx="8" style={{ fill: 'var(--color-primary)' }} />
        <g style={{ fill: 'var(--color-primary-foreground)' }}>
          <rect x="8.4" y="5.5" width="4.2" height="20.8" rx="0.6" />
          <path fillRule="evenodd" d="M16.9 12.7a6.8 6.8 0 1 1 0 13.6a6.8 6.8 0 1 1 0-13.6zm0 3.6a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 1 0 0-6.4z" />
        </g>
      </svg>
    </span>
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
    <nav aria-label="Mobile" className="lg:hidden fixed bottom-0 left-0 right-0 h-[var(--mobile-nav-h)] bg-[var(--color-background)]/90 backdrop-blur-xl shadow-[var(--shadow-hairline-up)] px-2 flex items-center z-50">
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
  const { prefs, setPref } = useUiPreferences()
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
  // Closed below lg the drawer is off screen: `inert` takes its links out of the Tab order and the accessibility tree.
  const drawerInert = isBelowLg && !drawerOpen

  // The icon rail (from lg up only; the drawer always has wide rows). `collapsed` is the saved choice and drives the width at once;
  // `railLayout` drives the item layout. It lags on the way in, so the labels are clipped by the shrinking edge rather than re-flowed
  // into squares mid-slide, and switches on the aside's transitionend (or a timeout, since reduced motion and jsdom never fire it).
  const collapsed = prefs.sidebarCollapsed && !isBelowLg
  const [railLayoutSaved, setRailLayout] = useState(prefs.sidebarCollapsed)
  const railLayout = railLayoutSaved && !isBelowLg
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const railTip = useRailTooltip()
  const [openFlyout, setOpenFlyout] = useState<{ id: string; trigger: HTMLElement } | null>(null)
  // Stable between renders so RailFlyout's document listeners are not torn down and re-added on every parent render.
  const closeFlyout = useCallback((focusTrigger: boolean) => {
    setOpenFlyout(null)
    if (focusTrigger) openFlyout?.trigger.focus()
  }, [openFlyout])
  const hideTip = railTip.hide
  const toggleFlyout = useCallback((id: string, trigger: HTMLElement) => {
    hideTip()
    setOpenFlyout(openFlyout?.id === id ? null : { id, trigger })
  }, [hideTip, openFlyout])
  // A flyout left open when the window shrank below lg has no rail to hang from.
  if (isBelowLg && openFlyout) setOpenFlyout(null)
  const toggleCollapsed = () => {
    const next = !prefs.sidebarCollapsed
    setPref('sidebarCollapsed', next)
    closeFlyout(false)
    railTip.hide()
    clearTimeout(settleTimer.current)
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!next || reduce) setRailLayout(next)
    else settleTimer.current = setTimeout(() => setRailLayout(true), 260)
  }
  const rail: RailContext | undefined = railLayout
    ? { tip: railTip.bind, flyout: openFlyout, toggleFlyout, closeFlyout }
    : undefined

  // Which groups are open: what the user chose to keep open last time, plus the group that holds the current page.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => withActiveGroups(readStoredOpenGroups(), location.pathname))
  // Navigating (a link, a Dashboard tile, the browser's Back) opens the group that now holds the page, and closes the drawer. It starts again
  // from the saved choices, so a group that only opened itself for the page you left closes again (V2-G: passing through Trips, Participants
  // and Staff used to leave all three open, filling the sidebar).
  // shortcut: with localStorage blocked, a toggle made this session is forgotten on the next navigation; keep a session set if that matters.
  const [seenPathname, setSeenPathname] = useState(location.pathname)
  if (seenPathname !== location.pathname) {
    setSeenPathname(location.pathname)
    setOpenGroups(withActiveGroups(readStoredOpenGroups(), location.pathname))
    setSidebarOpen(false)
    setOpenFlyout(null)
    railTip.hide()
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

  const visibility = useModuleVisibility()
  // An unavailable current-tenant answer must never hide work using a previous or failed answer.
  const savedVisibility = visibility.isError ? undefined : visibility.data
  const resolvedNav = resolveNav(navItems, permissions, savedVisibility)
  const otherWorkspaces = navLeaves.filter(leaf => isLeafVisible(leaf, permissions) && isWorkspaceHidden(leaf, savedVisibility))
  const barAudience: BarAudience = permissions.isSupportWorker ? 'field' : 'office'
  const barItems = barEntries(resolvedNav, barAudience).map(entry => toBarItem(entry, location.pathname, counts))
  const closeDrawer = () => setSidebarOpen(false)

  const user = JSON.parse(localStorage.getItem('odip_user') || '{}')
  const isSuperAdmin = permissions.isSuperAdmin || !!localStorage.getItem('odip_superadmin_user')
  const viewingUserId = localStorage.getItem('odip_viewing_user')
  const viewingTenantId = localStorage.getItem('odip_viewing_tenant')
  const savedAdminUser = JSON.parse(localStorage.getItem('odip_superadmin_user') || '{}')

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
        "Sign out" (which could not be tapped) and stayed live above the scrim. From lg up the sidebar is permanent,
        there is no bottom nav, and it keeps z-50 (`lg:z-50`) so a Modal (z-50, later in the DOM) still covers it.
      */}
      {drawerOpen && (
        <div aria-hidden="true" className="fixed inset-0 bg-black/40 z-[55] lg:hidden" onClick={closeDrawer} />
      )}

      {/*
        Sidebar / drawer. While the drawer is open it is a modal dialog ("Main menu"); closed below lg it is `inert`, which takes its links
        out of the Tab order and the accessibility tree (they used to be 13 off-screen tab stops before the page). Not `visibility:
        hidden`: that is inherited, every nav item has `transition-all`, and a visibility transition starts hidden, so the first
        frame after opening would still have every link hidden and the focus the dialog moves in would be refused. At lg and up it is a
        plain landmark, always on screen.
      */}
      <aside
        ref={drawerRef}
        id="app-menu"
        role={drawerOpen ? 'dialog' : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-label={drawerOpen ? 'Main menu' : undefined}
        tabIndex={drawerOpen ? -1 : undefined}
        inert={drawerInert}
        onTransitionEnd={e => {
          if (e.target === e.currentTarget && e.propertyName === 'width') {
            clearTimeout(settleTimer.current)
            setRailLayout(prefs.sidebarCollapsed)
          }
        }}
        className={`fixed inset-y-0 left-0 z-[60] lg:z-50 w-[232px] ${collapsed ? 'lg:w-16' : ''} overflow-hidden bg-[var(--color-sidebar)] transition-transform duration-200 lg:translate-x-0 lg:transition-[width] lg:ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:lg:transition-none ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* A fixed-width layer inside the clipping aside: the moving edge reveals or hides it, it never re-flows. */}
        <div className={`flex h-full flex-col pt-3 pb-3 ${railLayout ? 'w-16 px-3 pointer-coarse:px-2.5' : 'w-[232px] px-3'}`}>
        {/* Brand — ~48px tall total */}
        <div className={`flex items-center h-12 shrink-0 ${railLayout ? 'justify-center' : 'px-2.5'}`}>
          {railLayout ? <BrandTile /> : <Wordmark size={21} />}
        </div>

        {/* Nav. In the rail it bleeds to the aside edges (and pads back), so the nav's scroll clip does not cut a count badge or a focus ring. Every item (group toggles, top-level links, group children, and "Sign Out" below) carries a
            `--tap-min` floor: 32px (28px for a group child) on a mouse as before, 44px under a coarse pointer, where
            this is the touch drawer (and the permanent sidebar of a touch tablet). The list scrolls inside the
            drawer when 44px items no longer fit its height. */}
        <nav aria-label="Main" className={`flex-1 space-y-0.5 overflow-y-auto pt-1 ${railLayout ? '-mx-3 px-3 pointer-coarse:-mx-2.5 pointer-coarse:px-2.5 [scrollbar-width:none]' : ''}`}>
          {resolvedNav.map(entry =>
            entry.kind === 'group' && rail ? (
              <RailGroup
                key={entry.group.id}
                id={entry.group.id}
                label={entry.group.label}
                msIcon={entry.group.msIcon}
                noun={entry.group.badgeNoun ?? 'item'}
                leaves={entry.children}
                rail={rail}
                pathname={location.pathname}
                counts={counts}
                onNavigate={closeDrawer}
              />
            ) : entry.kind === 'group' ? (
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
              <SidebarLink key={entry.leaf.to} leaf={entry.leaf} rail={rail} pathname={location.pathname} counts={counts} onNavigate={closeDrawer} />
            ),
          )}
          {otherWorkspaces.length > 0 && rail && (
            <RailGroup
              id="other"
              label="Other workspaces"
              msIcon="apps"
              noun="item"
              leaves={otherWorkspaces}
              rail={rail}
              pathname={location.pathname}
              counts={counts}
              onNavigate={closeDrawer}
            />
          )}
          {otherWorkspaces.length > 0 && !rail && (
            <details open={otherWorkspaces.some(leaf => isLeafActive(leaf, location.pathname)) || undefined} className="mt-2">
              <summary className={`cursor-pointer rounded-md px-3 py-1.5 min-h-[var(--tap-min)] text-sm ${NAV_IDLE}`}>Other workspaces</summary>
              {otherWorkspaces.map(leaf => <SidebarLink key={leaf.to} leaf={leaf} pathname={location.pathname} counts={counts} onNavigate={closeDrawer} />)}
            </details>
          )}
        </nav>

        {/* Bottom */}
        <div className={`pt-2 shrink-0 ${rail ? 'space-y-0.5' : ''}`}>
          <button onClick={endSession}
            className={`${rail ? RAIL_ITEM : WIDE_FOOT_ROW} text-[var(--color-secondary)] hover:bg-[var(--color-sidebar-accent)]`}
            {...(rail ? rail.tip('Sign out', 0) : {})}>
            {/* The wide icon sits in an 18px slot so Sign out's label starts at x=54 like the nav labels. */}
            {rail ? <LogOut className="w-4 h-4" /> : <span className="inline-flex w-[18px] justify-center"><LogOut className="w-4 h-4" /></span>}
            {rail ? <span className="sr-only">Sign out</span> : 'Sign out'}
          </button>
          {/* Collapse / expand: one button in both states (it keeps its focus across the toggle), named for what it will do. */}
          {!isBelowLg && (
            <button
              type="button"
              aria-controls="app-menu"
              onClick={toggleCollapsed}
              className={`${rail ? RAIL_ITEM : WIDE_FOOT_ROW} text-[var(--color-secondary)] hover:bg-[var(--color-sidebar-accent)]`}
              {...(rail ? rail.tip('Expand sidebar', 0) : {})}
            >
              <span className="material-symbols-outlined shrink-0" aria-hidden="true" style={{ fontSize: '18px' }}>
                {collapsed ? 'left_panel_open' : 'left_panel_close'}
              </span>
              <span className={rail ? 'sr-only' : undefined}>{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
            </button>
          )}
        </div>
        </div>
      </aside>

      {/* Main area */}
      <div className={`flex-1 min-w-0 ${collapsed ? 'lg:ml-16' : 'lg:ml-[232px]'} lg:transition-[margin-left] lg:duration-200 lg:ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:lg:transition-none flex flex-col min-h-screen`}>
        {/* Top bar — fixed 48px */}
        <header className="sticky top-0 z-30 h-12 bg-[var(--color-background)]/80 backdrop-blur-xl shadow-[var(--shadow-hairline)]">
          <div className="flex items-center justify-between h-full px-[var(--gutter,20px)]">
            <div className="flex min-w-0 items-center gap-4">
              <button
                className="flex items-center justify-center lg:hidden p-2 pointer-coarse:size-[var(--tap-min)] pointer-coarse:p-0 rounded-md hover:bg-[var(--color-accent)] transition-colors"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title={sidebarOpen ? 'Close menu' : 'Open menu'}
                aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={sidebarOpen}
                aria-controls="app-menu"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              {user.tenantName && (
                <span title={user.tenantName} className={`${isSuperAdmin ? 'hidden sm:inline-block' : 'inline-block'} max-w-[7.5rem] truncate sm:max-w-none text-xs bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-2.5 py-0.5 rounded-full border border-[var(--color-primary)]/20 font-medium`}>
                  {user.tenantName}
                </span>
              )}
              {/* Page navigation only: the old entity-search field had no query or results behaviour. */}
              <PlatformDirectoryTrigger compact entries={platformNavigation(permissions, savedVisibility)} />
            </div>
            <div className="flex items-center gap-3">
              {isSuperAdmin && <TenantSwitcher />}
              {isSuperAdmin && viewingTenantId && <UserSwitcher />}
              <NotificationBell />
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] flex items-center justify-center text-[var(--color-primary-foreground)] font-bold text-sm shadow-md">
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
          Bottom padding is split out from the p-4, md:p-6, lg:p-8 shorthand on purpose: that shorthand sets padding-bottom too, and
          md:p-6 once overrode the nav clearance between 768 and 1024px, trapping the last roster row behind the nav. Directional px
          and pt utilities leave pb-6 as the only thing setting it. The clearance for the fixed mobile bottom nav is not here any more:
          PlatformFooter (variant="shell"), the last thing in this column, carries it below lg (--mobile-nav-h, the safe area and
          0.75rem). The footer always renders, because its Accessibility link is unconditional, so nothing can end up behind the nav.
        */}
        <main id="main" className="flex-1 px-[var(--gutter,20px)] pt-4 pb-6">
          {/* Track the previous in-app pathname once at the authenticated shell so any
              page-header back control (e.g. the intake/profile wizards) can navigate to
              where the user actually came from instead of a hardcoded fallback. */}
          <BackPathTracker />
          {/* A page that throws takes the page area down, not the shell: the nav stays on screen so the user can leave the broken
              page. The error clears when the pathname changes (App.tsx keeps its own boundary around the shell for a crash in the shell).
              The same goes for a page that is still loading: its lazy chunk suspends HERE, not at the app's root boundary, which would
              replace the whole shell with "Loading..." for a frame and drop the focus (the drawer's link, the bar's More) with it. */}
          <ErrorBoundary inline resetKey={location.pathname}>
            <Suspense fallback={<div role="status" className="flex items-center justify-center py-16 text-sm text-[var(--color-muted-foreground)]">Loading...</div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
        <PlatformFooter variant="shell" />
      </div>

      {/* Mobile bottom nav. Generated from the same config as the sidebar (see BottomBar), so it can never offer a link the role
          may not open or disagree with the sidebar about which page is lit. There is no create shortcut here (or in the sidebar):
          creating a trip is the "New Trip" button in the Trips page header. The cells share the row in equal widths
          (MOBILE_NAV_LINK), so the row needs no spacer or justify rule whatever pages a role's bar holds.
          The nav is exactly --mobile-nav-h tall (index.css: 66px on a mouse, 68px under `pointer:
          coarse`, where the links reach the 44px tap floor): a fixed height rather than whatever
          the content adds up to, so the sticky wizard footer (WizardNavFooter) can sit precisely
          above it by offsetting with the same var. */}
      {railTip.tooltip}
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
