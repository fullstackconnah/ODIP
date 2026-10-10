import { lazy } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, RouterProvider, createMemoryRouter } from 'react-router-dom'
import AppLayout from './AppLayout'
import { TAP_AREA } from '@/components/tapArea'

// AppLayout renders the portal nav's pending-witness-count badge and the Rostering nav's
// pending-leave-count badge via TanStack Query hooks — stub just those exports (keeping the
// rest of the real module intact for TenantSwitcher/UserSwitcher, unused by these tests but
// still imported transitively) so this suite doesn't need a QueryClientProvider or a real
// network call, matching how the other hook-backed page tests in this codebase mock
// '@/api/hooks' rather than provide a live client.
const { mockUsePendingLeaveCount, mockUsePendingWitnessRequests, mockUsePendingCompletionCount, mockEndSession } = vi.hoisted(() => ({
  mockEndSession: vi.fn(),
  mockUsePendingLeaveCount: vi.fn(() => 0),
  mockUsePendingWitnessRequests: vi.fn(() => ({ data: [] as unknown[], isLoading: false })),
  mockUsePendingCompletionCount: vi.fn(() => 0),
}))

vi.mock('@/api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks')>()
  return {
    ...actual,
    usePendingWitnessRequests: mockUsePendingWitnessRequests,
    usePendingLeaveCount: mockUsePendingLeaveCount,
    // Same reason as usePendingLeaveCount above — without this, AppLayout's new Completions nav
    // entry would call the real usePendingCompletionCount, which calls useQuery and needs a
    // QueryClientProvider this suite doesn't set up.
    usePendingCompletionCount: mockUsePendingCompletionCount,
  }
})

// Signing out is endSession's job (the server cookie, the Firebase user, the browser keys, the redirect); this suite only checks that the button calls it.
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), endSession: mockEndSession }))

// A SuperAdmin's header also renders the tenant switcher, whose own TanStack Query hook needs a QueryClientProvider this
// suite does not set up. It is header chrome, not navigation, so stub it: the role-by-role nav tests below cover SuperAdmin.
vi.mock('@/components/layout/TenantSwitcher', () => ({ default: () => null }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<AppLayout />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppLayout nav active state', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('marks the Rostering "Board" entry active only on exactly /rostering', () => {
    renderAt('/rostering')
    // Board's NavLink uses `end` matching, so it's active on exactly this path. The accessible
    // name includes the leading material-icon ligature text (e.g. "calendar_view_week Board"),
    // so these match on the visible label rather than the full name.
    expect(screen.getByRole('link', { name: /Board$/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Patterns$/ })).not.toHaveAttribute('aria-current')
  })

  it('activates the "Patterns" entry, not the "Board" parent, on /rostering/patterns', () => {
    renderAt('/rostering/patterns')
    expect(screen.getByRole('link', { name: /Patterns$/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Board$/ })).not.toHaveAttribute('aria-current')
  })

  it('still activates "All Trips" on a /trips/:id detail route (prefix match must not regress)', () => {
    renderAt('/trips/trip-123')
    expect(screen.getByRole('link', { name: /All Trips$/ })).toHaveAttribute('aria-current', 'page')
  })

  it('activates "All Trips" on the exact /trips path too', () => {
    renderAt('/trips')
    expect(screen.getByRole('link', { name: /All Trips$/ })).toHaveAttribute('aria-current', 'page')
  })
})

describe('AppLayout — skip link and labelled landmarks (I-4)', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('renders a skip-to-content link as the first focusable element, pointing at #main', () => {
    renderAt('/trips')
    const skipLink = screen.getByRole('link', { name: /skip to content/i })
    expect(skipLink).toHaveAttribute('href', '#main')
    expect(document.getElementById('main')?.tagName).toBe('MAIN')
  })

  it('gives the sidebar nav and the mobile bottom nav distinct aria-labels', () => {
    renderAt('/trips')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Mobile' })).toBeInTheDocument()
  })
})

describe('AppLayout — Leave nav entry (leave-2)', () => {
  afterEach(() => {
    localStorage.clear()
    mockUsePendingLeaveCount.mockReturnValue(0)
  })

  it('renders the Leave entry under Rostering, linking to /rostering/leave', () => {
    renderAt('/rostering')
    expect(screen.getByRole('link', { name: /Leave$/ })).toHaveAttribute('href', '/rostering/leave')
  })

  it('shows no badge when there are no pending leave requests', () => {
    renderAt('/rostering')
    expect(screen.getByRole('link', { name: /Leave$/ })).not.toHaveTextContent(/\d/)
  })

  it('shows a pending-count badge on the Leave entry when usePendingLeaveCount is positive', () => {
    mockUsePendingLeaveCount.mockReturnValue(3)
    renderAt('/rostering')
    expect(screen.getByRole('link', { name: /Leave$/ })).toHaveTextContent('3')
  })
})

describe('AppLayout — Completions nav entry', () => {
  afterEach(() => {
    localStorage.clear()
    mockUsePendingCompletionCount.mockReturnValue(0)
  })

  it('renders the Completions entry under Rostering, linking to /rostering/completions', () => {
    renderAt('/rostering')
    expect(screen.getByRole('link', { name: /Completions$/ })).toHaveAttribute('href', '/rostering/completions')
  })

  it('shows no badge when there are no pending completions', () => {
    renderAt('/rostering')
    expect(screen.getByRole('link', { name: /Completions$/ })).not.toHaveTextContent(/\d/)
  })

  it('shows a pending-count badge on the Completions entry when usePendingCompletionCount is positive', () => {
    mockUsePendingCompletionCount.mockReturnValue(4)
    renderAt('/rostering')
    expect(screen.getByRole('link', { name: /Completions$/ })).toHaveTextContent('4')
  })

  it('disables the poll for a role without canReviewCompletions (no user)', () => {
    renderAt('/rostering')
    expect(mockUsePendingCompletionCount).toHaveBeenCalledWith(false)
  })

  it('enables the poll for a role with canReviewCompletions (Coordinator)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    renderAt('/rostering')
    expect(mockUsePendingCompletionCount).toHaveBeenCalledWith(true)
  })
})

describe('AppLayout — witness-approval nav badge (leave-2, shares NavCountBadge/navBadgeLabel with the Leave badge)', () => {
  afterEach(() => {
    localStorage.clear()
    mockUsePendingWitnessRequests.mockReturnValue({ data: [], isLoading: false })
  })

  it('gives the /portal link an accessible name ending in "Portal" and announcing the pending count', () => {
    mockUsePendingWitnessRequests.mockReturnValue({ data: [{}, {}], isLoading: false })
    renderAt('/trips')
    expect(screen.getByRole('link', { name: '2 witness approvals pending, My Shifts' })).toHaveAttribute('href', '/portal')
  })
})

describe('AppLayout — pending-leave poll gated on canApproveLeave', () => {
  afterEach(() => {
    localStorage.clear()
    mockUsePendingLeaveCount.mockClear()
  })

  it('disables the poll for a role without canApproveLeave (no user, e.g. SupportWorker/ReadOnly)', () => {
    renderAt('/rostering')
    expect(mockUsePendingLeaveCount).toHaveBeenCalledWith(false)
  })

  it('enables the poll for a role with canApproveLeave (Coordinator)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    renderAt('/rostering')
    expect(mockUsePendingLeaveCount).toHaveBeenCalledWith(true)
  })
})


describe('AppLayout — participant lifecycle navigation', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('surfaces a single Participants entry and keeps Draft intake absent from the nav for lifecycle roles', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    renderAt('/participants/new')
    // The sub-group's link list is a plain, unlabelled container (no nested nav landmark — see
    // AppLayout's group rendering) — find it by its stable id rather than an ARIA landmark name.
    const journey = document.getElementById('nav-group-participants')!
    expect(Array.from(journey.querySelectorAll('a')).map(link => link.textContent?.trim())).toEqual([
      // The New inquiry button now lives inside the Participants hub PageHeader, not the
      // sidebar — Draft intake is gone from the nav. Lifecycle roles still see the hub
      // entry, Medications and Caregiver forms.
      'groupParticipants', 'pillMedications', 'checklist_rtlCaregiver forms',
    ])
    // Draft intake must NOT be present anywhere in the nav (sidebar or mobile drawer).
    expect(screen.queryByRole('link', { name: /Draft intake$/ })).not.toBeInTheDocument()
  })

  it('surfaces a single Participants entry but keeps Draft intake hidden for ReadOnly and SupportWorker', () => {
    for (const role of ['ReadOnly', 'SupportWorker']) {
      localStorage.setItem('odip_user', JSON.stringify({ role }))
      const { unmount } = renderAt('/participants')
      // Lifecycle stages (Enquiries, Onboarding, Active participants) collapsed into the
      // Participants hub at /participants — see navConfig's navItems. The bottom bar now names its item "Participants" too (it said
      // "People"), so look in the sidebar only.
      const sidebarNav = screen.getByRole('navigation', { name: 'Main' })
      expect(within(sidebarNav).getByRole('link', { name: /Participants$/ })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Enquiries$/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Onboarding$/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Active participants$/ })).not.toBeInTheDocument()
      // Draft intake must remain absent from the nav regardless of role.
      expect(screen.queryByRole('link', { name: /Draft intake$/ })).not.toBeInTheDocument()
      unmount()
      localStorage.clear()
    }
  })

  it('does not surface Draft intake in the mobile bottom nav either', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    renderAt('/participants')
    // The mobile bottom nav is its own labelled landmark with name "Mobile".
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(mobileNav.querySelector('a[href$="/participants/new"]')).toBeNull()
    expect(screen.queryByRole('link', { name: /Draft intake$/ })).not.toBeInTheDocument()
  })

  it('closes the mobile drawer on Escape and returns focus to its toggle', () => {
    renderAt('/inquiries')
    const toggle = screen.getByRole('button', { name: 'Open menu' })
    toggle.focus()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' }))
  })
})

// Density verdict, touch: the shell's compact controls reach a 44px target under `pointer: coarse` (spec §1) without
// changing size. jsdom has no layout or media queries, so these pin the class contract; the token floors are 0px
// on a mouse, so the desktop shell is unchanged.
describe('AppLayout — 44px coarse-pointer hit areas', () => {
  const pad = TAP_AREA.split(' ')

  afterEach(() => {
    localStorage.clear()
  })

  it('pads the header "Open menu" toggle (36px) and keeps the pad when it becomes "Close menu"', () => {
    renderAt('/trips')
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveClass(...pad, 'p-2', 'lg:hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveClass(...pad)
  })

  it('pads the header "Notifications" button (32px, disabled placeholder)', () => {
    renderAt('/trips')
    const bell = screen.getByRole('button', { name: 'Notifications' })
    expect(bell).toHaveClass(...pad, 'w-8', 'h-8')
    expect(bell).toBeDisabled()
  })

  it('gives every mobile bottom-nav cell, "More" included, a --tap-min floor each way, its content centred, so the 42px cells are 44px', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/trips')
    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    const cells = [
      ...[/Dashboard$/, /Trips$/, /Roster$/, /Participants$/].map(name => within(nav).getByRole('link', { name })),
      within(nav).getByRole('button', { name: /More$/ }),
    ]
    for (const cell of cells) {
      expect(cell, cell.textContent ?? '').toHaveClass('flex', 'flex-col', 'items-center', 'justify-center', 'gap-1', 'min-h-[var(--tap-min)]', 'min-w-[var(--tap-min)]')
    }
  })

  it('does not use the ::before pad on the bottom-nav cells: they tile the row, so a pad past a cell would overlap its neighbour and a floor cannot', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    for (const cell of [...within(nav).getAllByRole('link'), within(nav).getByRole('button', { name: /More$/ })]) {
      expect(cell.className).not.toContain('before:')
    }
  })

  it('shares the bottom-nav row in equal-width cells with nothing else in it: four pages and "More" for every role, evenly spaced', () => {
    for (const role of ['Admin', 'SupportWorker']) {
      localStorage.setItem('odip_user', JSON.stringify({ role }))
      const { unmount } = renderAt('/trips')
      const nav = screen.getByRole('navigation', { name: 'Mobile' })
      const cells = [...within(nav).getAllByRole('link'), within(nav).getByRole('button', { name: /More$/ })]
      expect(cells, role).toHaveLength(5)
      // Every child of the row is one of the cells (no spacer or placeholder), each an equal `flex-1` cell, and the row does not
      // distribute free space with justify-around.
      expect(nav.childElementCount, role).toBe(5)
      for (const cell of cells) expect(cell, `${role}: ${cell.textContent}`).toHaveClass('flex-1')
      expect(nav.className).not.toContain('justify-')
      unmount()
      localStorage.clear()
    }
  })

  it('sizes the bottom nav with --mobile-nav-h, the var the sticky wizard footer sits above, and main clears it by the same var', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    const { container } = renderAt('/trips')
    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(nav).toHaveClass('h-[var(--mobile-nav-h)]', 'fixed', 'bottom-0', 'lg:hidden')
    expect(container.querySelector('main')).toHaveClass('pb-[calc(var(--mobile-nav-h)+1.75rem)]', 'lg:pb-6')
  })

  it('defines --mobile-nav-h for both pointer types as exactly what the nav content needs: 12px + the taller of the 42px link and --tap-min + 12px', () => {
    // jsdom does no layout, so read the source of truth: index.css. The bottom nav's links are 42px of icon + label and take a
    // --tap-min floor (0px on a mouse, 44px under `pointer: coarse`); the nav pads 12px above and below them. If the var and
    // the content drift apart the sticky wizard footer either floats above a gap or slides under the nav (the bug this pins).
    const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8')
    const navH = [...css.matchAll(/--mobile-nav-h:\s*(\d+)px/g)].map(m => Number(m[1]))
    const tapMin = [...css.matchAll(/--tap-min:\s*(\d+)px/g)].map(m => Number(m[1]))
    expect(tapMin).toEqual([0, 44]) // fine pointer, then the coarse block
    expect(navH).toHaveLength(2)
    navH.forEach((h, i) => expect(h).toBe(12 + Math.max(42, tapMin[i]) + 12))
  })

  it('keeps the active colour on the padded cells: the lit one is olive, "More" included, and only one is lit', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    const { unmount } = renderAt('/trips')
    let nav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(within(nav).getByRole('link', { name: /Trips$/ })).toHaveClass('text-[var(--color-primary)]')
    expect(within(nav).getByRole('link', { name: /Dashboard$/ })).toHaveClass('text-[var(--color-secondary)]')
    expect(within(nav).getByRole('button', { name: /More$/ })).toHaveClass('text-[var(--color-secondary)]')
    unmount()

    // Settings has no cell of its own any more: it is behind "More", which takes the colour so the bar still says where you are.
    renderAt('/settings')
    nav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(within(nav).getByRole('button', { name: /More$/ })).toHaveClass('text-[var(--color-primary)]')
    expect(within(nav).getByRole('link', { name: /Trips$/ })).toHaveClass('text-[var(--color-secondary)]')
  })
})

// Density polish (touch): the drawer's items were 28-32px, and with the drawer open "Sign Out" sat UNDER the fixed bottom
// nav (both were z-50, the nav later in the DOM), so it could not be tapped. The items take a --tap-min floor (0px on a
// mouse, 44px under `pointer: coarse`), and below lg the drawer and its scrim sit above the nav.
describe('AppLayout — the mobile drawer (touch targets and stacking)', () => {
  const FLOOR = 'min-h-[var(--tap-min)]'
  // The <aside> is a `complementary` landmark while closed and a `dialog` while the drawer is open, so find it by tag.
  const sidebar = () => document.querySelector('aside') as HTMLElement

  afterEach(() => {
    localStorage.clear()
  })

  it('puts the drawer above the fixed bottom nav below lg, so "Sign Out" is not covered by it', () => {
    renderAt('/trips')

    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    // The nav is z-50 and the drawer used to be z-50 too, the nav coming later in the DOM: it painted over Sign Out.
    expect(nav).toHaveClass('z-50')
    expect(sidebar()).toHaveClass('z-[60]', 'fixed', 'inset-y-0', 'left-0')
    expect(sidebar().className).not.toMatch(/(^|\s)z-50(\s|$)/)
  })

  it('keeps the sidebar at z-50 from lg up, where there is no bottom nav and a Modal (z-50, later in the DOM) must cover it', () => {
    renderAt('/trips')

    expect(sidebar()).toHaveClass('lg:z-50')
    expect(screen.getByRole('navigation', { name: 'Mobile' })).toHaveClass('lg:hidden')
  })

  it('puts the scrim between the nav and the drawer, so the nav is dimmed and can not be tapped through it', () => {
    const { container } = renderAt('/trips')
    expect(container.querySelector('[class*="bg-black"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    const scrim = container.querySelector('[class*="bg-black"]') as HTMLElement
    expect(scrim).toHaveClass('fixed', 'inset-0', 'z-[55]', 'lg:hidden')
    // 50 (nav) < 55 (scrim) < 60 (drawer).
    expect(sidebar()).toHaveClass('z-[60]')
    expect(screen.getByRole('navigation', { name: 'Mobile' })).toHaveClass('z-50')
    fireEvent.click(scrim)
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('floors every drawer item at --tap-min: top-level links, group toggles, group children and Sign Out', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/trips')
    const main = within(sidebar()).getByRole('navigation', { name: 'Main' })

    const dashboard = within(main).getByRole('link', { name: /Dashboard$/ })
    expect(dashboard).toHaveClass(FLOOR, 'py-1.5', 'text-sm')
    const tripsToggle = within(main).getByRole('button', { name: /Trips$/ })
    expect(tripsToggle).toHaveClass(FLOOR, 'py-1.5', 'w-full')
    // A group child stays h-7 (28px) on a mouse; the floor lifts it to 44px on touch.
    const allTrips = within(main).getByRole('link', { name: /All Trips$/ })
    expect(allTrips).toHaveClass('h-7', FLOOR)
    // Staff lives in the Staff & roster group, closed at /trips, and a closed panel is `aria-hidden`: open it first.
    const rosterToggle = within(main).getByRole('button', { name: /Staff & roster$/ })
    expect(rosterToggle).toHaveClass(FLOOR, 'py-1.5', 'w-full')
    fireEvent.click(rosterToggle)
    const staff = within(main).getByRole('link', { name: /Staff$/ })
    expect(staff).toHaveClass('h-7', FLOOR)
    const signOut = within(sidebar()).getByRole('button', { name: /Sign Out$/ })
    expect(signOut).toHaveClass('h-8', FLOOR)
  })

  it('floors every link and button in the drawer, not just the ones asserted by name', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/trips')

    // Everything interactive in the aside: the Main nav's links and group toggles, and Sign Out. Nothing is exempt: the
    // "New Trip" call to action above the nav (a Button md, which took its own 44px token) is gone.
    const items = Array.from(sidebar().querySelectorAll('a, button'))
    expect(items.length).toBeGreaterThan(12)
    for (const item of items) expect(item, item.textContent ?? '').toHaveClass(FLOOR)
  })

  it('takes every floor from the --tap-min token: nothing here hard-codes 44px', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    const { container } = renderAt('/trips')

    expect(container.innerHTML).not.toMatch(/(?:min-h|min-w|h|w)-\[44px\]/)
  })
})

// Density polish (touch): from md up the header search is a 32px box around a 20px input. On a touch tablet that is a
// 20px target, so the box takes the --tap-min floor (the header is 48px, 44 fits) and the input stretches to fill it.
describe('AppLayout — header search field on touch', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('floors the search box at --tap-min and stretches the input to fill it under a coarse pointer', () => {
    renderAt('/trips')

    const input = screen.getByRole('textbox', { name: 'Search trips and participants' })
    const box = input.parentElement as HTMLElement
    // A mouse keeps the 32px box (h-8) and the 20px input; the floor is 0px there.
    expect(box).toHaveClass('hidden', 'md:flex', 'items-center', 'h-8', 'min-h-[var(--tap-min)]', 'w-[360px]')
    expect(input).toHaveClass('pointer-coarse:self-stretch', 'w-full')
    expect(input.className).not.toMatch(/(^|\s)(h-|min-h-|self-stretch)/)
  })
})

// The shell used to carry a "New Trip" shortcut in two places: a full-width call to action at the top of the sidebar (one
// <aside> is both the permanent sidebar and the mobile drawer, so it was in the drawer too) and a round "+" in the centre
// of the mobile bottom nav. Both linked to /trips/new and showed for every role that can write (all but SupportWorker).
// They are gone on purpose: a trip is created from the "New Trip" button in the Trips page header (TripsPage.test.tsx).
// Everything else in the shell is gated exactly as before.
describe('AppLayout — no New Trip shortcut in the sidebar, the drawer or the bottom nav', () => {
  const ROLES = ['SuperAdmin', 'Admin', 'Coordinator', 'ReadOnly', 'SupportWorker']
  const signIn = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role }))
  // A `complementary` landmark while closed, a `dialog` while the drawer is open: find the <aside> by tag.
  const sidebar = () => document.querySelector('aside') as HTMLElement
  const mainNav = () => within(sidebar()).getByRole('navigation', { name: 'Main' })
  const hrefs = (root: HTMLElement) => Array.from(root.querySelectorAll('a')).map(a => a.getAttribute('href'))
  // Links and buttons in the sidebar outside its Main nav: only Sign Out. The CTA lived in exactly this slot, between
  // the brand and the nav, so any control added back there (whatever its label) fails.
  const controlsOutsideNav = () =>
    Array.from(sidebar().querySelectorAll('a, button'))
      .filter(el => !el.closest('nav'))
      .map(el => el.textContent?.trim())

  afterEach(() => {
    localStorage.clear()
  })

  it.each(ROLES)('renders no link to /trips/new and no "New Trip" text anywhere in the shell for %s', role => {
    signIn(role)
    const { container } = renderAt('/trips')

    expect(container.querySelector('a[href^="/trips/new"]')).toBeNull()
    expect(container).not.toHaveTextContent(/new trip/i)
  })

  it.each(ROLES)('has no call to action in the sidebar for %s: outside the Main nav its only control is Sign Out', role => {
    signIn(role)
    renderAt('/trips')

    expect(controlsOutsideNav()).toEqual(['Sign Out'])
    expect(sidebar().querySelector('a[href^="/trips/new"]')).toBeNull()
    expect(sidebar()).not.toHaveTextContent(/new trip/i)
  })

  it.each(ROLES)('has none in the opened drawer for %s either', role => {
    signIn(role)
    renderAt('/trips')

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    // Open: the same <aside> slides in, so this is the drawer a phone user sees.
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true')
    expect(sidebar()).toHaveClass('translate-x-0')
    expect(controlsOutsideNav()).toEqual(['Sign Out'])
    expect(sidebar().querySelector('a[href^="/trips/new"]')).toBeNull()
    expect(sidebar()).not.toHaveTextContent(/new trip/i)
  })

  // The bar's links, in order, then "More" (a button, so not in this list). Generated from navConfig: the office roles' bar leads with
  // the Dashboard and carries the Staff & roster group as "Roster"; a SupportWorker's leads with My Shifts and carries Incidents.
  const OFFICE_BOTTOM_NAV = ['/', '/trips', '/rostering', '/participants']
  it.each<[string, string[]]>([
    ['SuperAdmin', OFFICE_BOTTOM_NAV],
    ['Admin', OFFICE_BOTTOM_NAV],
    ['Coordinator', OFFICE_BOTTOM_NAV],
    // ReadOnly cannot open the Board (its API refuses the whole Rostering area), so its Roster cell opens Staff, the first page it can.
    ['ReadOnly', ['/', '/trips', '/staff', '/participants']],
    ['SupportWorker', ['/portal', '/trips', '/participants', '/incidents']],
  ])('has only the page links the role may open in the bottom nav for %s, none of them a create shortcut', (role, expected) => {
    signIn(role)
    renderAt('/trips')

    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(hrefs(nav)).toEqual(expected)
    expect(nav.querySelector('a[href^="/trips/new"]')).toBeNull()
    expect(nav).not.toHaveTextContent(/new trip/i)
  })

  it('still lists every sidebar link, in order, for an Admin', () => {
    signIn('Admin')
    renderAt('/trips')

    expect(hrefs(mainNav())).toEqual([
      '/', '/portal',
      '/trips', '/schedule', '/bookings', '/accommodation', '/vehicles', '/tasks',
      '/participants', '/medications', '/caregiver-submissions',
      '/rostering', '/rostering/patterns', '/rostering/compatibility', '/rostering/leave', '/rostering/completions', '/staff', '/qualifications',
      '/budgets',
      '/incidents', '/settings',
    ])
  })

  it('still hides the pages a SupportWorker may not open (Bookings, Rostering, Staff, Qualifications, Settings, Caregiver forms) from the sidebar', () => {
    signIn('SupportWorker')
    renderAt('/trips')

    // Caregiver forms used to be listed here (the link was shown to a role the route then bounces), and so did the Dashboard (a SupportWorker's
    // home is My Shifts).
    expect(hrefs(mainNav())).toEqual([
      '/portal',
      '/trips', '/schedule', '/tasks',
      '/participants', '/medications',
      '/incidents',
    ])
  })
})

// ── The nav regroup: one config feeds the sidebar, the drawer and the bar ───────────────────────────────────────────────────────

const signIn = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role }))
const mainNav = () => screen.getByRole('navigation', { name: 'Main' })
const mobileNav = () => screen.getByRole('navigation', { name: 'Mobile' })
// A `complementary` landmark while closed and a `dialog` while the drawer is open: the <aside> by tag.
const aside = () => document.querySelector('aside') as HTMLElement
const openGroupToggle = (name: RegExp | string) => within(mainNav()).getByRole('button', { name })

/**
 * The Main nav as text, whichever groups are open: a link is its label, a group is "label: child | child". Read from the DOM (not
 * the config), so a regression in the rendering shows up here and not only in the data.
 */
function navShape(): string[] {
  const label = (el: Element | null) => el?.querySelector('span.flex-1')?.textContent ?? ''
  return Array.from(mainNav().children).map(el =>
    el.tagName === 'A'
      ? label(el)
      : `${label(el.querySelector('button'))}: ${Array.from(el.querySelectorAll('a')).map(link => label(link)).join(' | ')}`,
  )
}

/** The bar's cells, left to right, as their visible text. */
const barLabels = () => Array.from(mobileNav().children).map(cell => cell.textContent)

describe('AppLayout — the menu each role sees is generated from navConfig', () => {
  afterEach(() => {
    localStorage.clear()
    mockUsePendingLeaveCount.mockReturnValue(0)
    mockUsePendingCompletionCount.mockReturnValue(0)
  })

  const FULL_MENU = [
    'Dashboard',
    'My Shifts',
    'Trips: All Trips | Schedule | Bookings | Accommodation | Vehicles | Tasks',
    'Participants: Participants | Medications | Caregiver forms',
    'Staff & roster: Board | Patterns | Compatibility | Leave | Completions | Staff | Qualifications',
    'Budgets',
    'Incidents',
    'Settings',
  ]
  // A SupportWorker starts from My Shifts, so the Dashboard is not in their menu; they never see the pages their allow-list leaves out.
  const SUPPORT_WORKER_MENU = ['My Shifts', 'Trips: All Trips | Schedule | Tasks', 'Participants: Participants | Medications', 'Incidents']
  // ReadOnly reads most of the app but its API refuses Rostering (all five pages), Budgets, Caregiver forms and
  // Settings, so the menu does not offer them: Budgets and Settings disappear, Staff & roster is down to Staff and Qualifications.
  const READ_ONLY_MENU = [
    'Dashboard',
    'My Shifts',
    'Trips: All Trips | Schedule | Bookings | Accommodation | Vehicles | Tasks',
    'Participants: Participants | Medications',
    'Staff & roster: Staff | Qualifications',
    'Incidents',
  ]

  it.each(['SuperAdmin', 'Admin', 'Coordinator'])('gives %s the full menu: Rostering, Staff and Qualifications are one Staff & roster group', role => {
    signIn(role)
    renderAt('/')
    expect(navShape()).toEqual(FULL_MENU)
  })

  it('gives a SupportWorker only the pages their role may open, and no Dashboard (their home is My Shifts)', () => {
    signIn('SupportWorker')
    renderAt('/')
    expect(navShape()).toEqual(SUPPORT_WORKER_MENU)
    expect(screen.queryByRole('link', { name: /Dashboard$/ })).not.toBeInTheDocument()
  })

  it('gives ReadOnly a menu without the pages the server refuses it', () => {
    signIn('ReadOnly')
    renderAt('/')
    expect(navShape()).toEqual(READ_ONLY_MENU)
    for (const name of [/Board$/, /Patterns$/, /Compatibility$/, /Leave$/, /Completions$/, /Budgets$/, /Caregiver forms$/, /Settings$/]) {
      expect(screen.queryByRole('link', { name }), String(name)).not.toBeInTheDocument()
    }
  })

  it('shows Caregiver forms only to a role whose route would not bounce it (the route needs write access)', () => {
    signIn('SupportWorker')
    const { unmount } = renderAt('/participants')
    expect(screen.queryByRole('link', { name: /Caregiver forms$/ })).not.toBeInTheDocument()
    unmount()
    signIn('Coordinator')
    renderAt('/participants')
    expect(screen.getByRole('link', { name: /Caregiver forms$/ })).toHaveAttribute('href', '/caregiver-submissions')
  })

  it('lights Participants on a page only its matchActive rule knows (/onboarding/:id), and says so with aria-current', () => {
    renderAt('/onboarding/p-1')
    // NavLink's own matching would not light it (the path is not under /participants), and its aria-current would have said nothing.
    expect(within(mainNav()).getByRole('link', { name: /Participants$/ })).toHaveAttribute('aria-current', 'page')
  })

  it('opens the group that holds the page you navigate to, and closes the drawer you navigated from', async () => {
    const router = createMemoryRouter([{ path: '*', element: <AppLayout /> }], { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('dialog', { name: 'Main menu' })).toBeInTheDocument()
    expect(openGroupToggle(/Staff & roster$/)).toHaveAttribute('aria-expanded', 'false')

    await act(async () => { await router.navigate('/rostering/leave') })

    expect(openGroupToggle(/Staff & roster$/)).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['SuperAdmin', 'Admin', 'Coordinator', 'ReadOnly', 'SupportWorker'])('gives every link and button in the shell an accessible name for %s (the old centre "+" had none)', role => {
    signIn(role)
    mockUsePendingLeaveCount.mockReturnValue(3)
    mockUsePendingCompletionCount.mockReturnValue(4)
    const { container } = renderAt('/')
    // Closed groups are `aria-hidden` and so are not in the accessibility tree: ask the DOM for everything, then the names of what is.
    const controls = Array.from(container.querySelectorAll<HTMLElement>('a[href], button'))
    expect(controls.length).toBeGreaterThan(10)
    for (const control of controls) {
      expect(control, `${control.tagName} ${control.textContent}`).toHaveAccessibleName()
      expect(control.getAttribute('aria-label') ?? control.textContent ?? '').not.toBe('')
    }
  })

  it('hides every icon ligature from assistive technology, so an accessible name is the label alone', () => {
    signIn('Admin')
    renderAt('/')
    const icons = Array.from(document.querySelectorAll('.material-symbols-outlined'))
    expect(icons.length).toBeGreaterThan(20)
    for (const icon of icons) expect(icon, icon.textContent ?? '').toHaveAttribute('aria-hidden', 'true')
    // The text is still there (the font draws the glyph from it); only the name no longer includes it.
    expect(within(mainNav()).getByRole('link', { name: 'Dashboard' })).toHaveTextContent('dashboard')
    expect(within(mobileNav()).getByRole('link', { name: 'Trips' })).toBeInTheDocument()
    expect(within(mainNav()).getByRole('button', { name: 'Trips' })).toBeInTheDocument()
  })
})

describe('AppLayout — open groups are remembered (U1)', () => {
  const KEY = 'odip_nav_open_groups'
  const expanded = (name: RegExp) => openGroupToggle(name).getAttribute('aria-expanded')

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('starts every group closed on a page outside them', () => {
    renderAt('/')
    for (const name of [/Trips$/, /Participants$/, /Staff & roster$/]) expect(expanded(name), String(name)).toBe('false')
  })

  it('writes the group the user opens, keyed by its id, and removes it when they close it', () => {
    renderAt('/')
    fireEvent.click(openGroupToggle(/Trips$/))
    expect(expanded(/Trips$/)).toBe('true')
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(['trips'])
    fireEvent.click(openGroupToggle(/Staff & roster$/))
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(['trips', 'staff-roster'])
    fireEvent.click(openGroupToggle(/Trips$/))
    expect(expanded(/Trips$/)).toBe('false')
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(['staff-roster'])
  })

  it('opens the saved groups on the next render, and leaves the others closed', () => {
    localStorage.setItem(KEY, JSON.stringify(['staff-roster']))
    renderAt('/')
    expect(expanded(/Staff & roster$/)).toBe('true')
    expect(expanded(/Trips$/)).toBe('false')
  })

  it('keeps a saved group open on top of the group that holds the current page', () => {
    localStorage.setItem(KEY, JSON.stringify(['trips']))
    renderAt('/staff')
    expect(expanded(/Trips$/)).toBe('true')
    expect(expanded(/Staff & roster$/)).toBe('true')
  })

  it('does not save a group that opened itself because the current page is inside it: that was never a choice', () => {
    renderAt('/rostering/leave')
    expect(expanded(/Staff & roster$/)).toBe('true')
    expect(localStorage.getItem(KEY)).toBeNull()
    // ...and opening another group saves that one only.
    fireEvent.click(openGroupToggle(/Trips$/))
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(['trips'])
  })

  it('ignores a saved id this build does not know, and junk, instead of breaking the menu', () => {
    localStorage.setItem(KEY, JSON.stringify(['gone-group', 42, 'trips']))
    const { unmount } = renderAt('/')
    expect(expanded(/Trips$/)).toBe('true')
    expect(navShape()).toHaveLength(8)
    unmount()

    localStorage.setItem(KEY, '{not json')
    renderAt('/')
    expect(navShape()).toHaveLength(8)
    expect(expanded(/Trips$/)).toBe('false')
  })

  it('still renders and toggles when localStorage throws', () => {
    const realGet = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === KEY) throw new Error('blocked')
      return realGet.call(this, key)
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string) {
      if (key === KEY) throw new Error('quota')
    })
    renderAt('/')
    expect(expanded(/Trips$/)).toBe('false')
    fireEvent.click(openGroupToggle(/Trips$/))
    expect(expanded(/Trips$/)).toBe('true')
  })
})

describe('AppLayout — a closed group shows what is pending inside it (U2)', () => {
  beforeEach(() => {
    signIn('Coordinator')
    mockUsePendingLeaveCount.mockReturnValue(3)
    mockUsePendingCompletionCount.mockReturnValue(4)
  })
  afterEach(() => {
    localStorage.clear()
    mockUsePendingLeaveCount.mockReturnValue(0)
    mockUsePendingCompletionCount.mockReturnValue(0)
  })

  it('adds up the children\'s counts on the closed header and announces them: "7 approvals pending, Staff & roster"', () => {
    renderAt('/')
    const toggle = openGroupToggle('7 approvals pending, Staff & roster')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('7')
  })

  it('drops the sum once the group is open, because the children carry their own counts', () => {
    renderAt('/')
    fireEvent.click(openGroupToggle(/Staff & roster$/))
    const toggle = openGroupToggle('Staff & roster')
    expect(toggle).not.toHaveTextContent(/\d/)
    expect(within(mainNav()).getByRole('link', { name: '3 leave requests pending, Leave' })).toHaveTextContent('3')
    expect(within(mainNav()).getByRole('link', { name: '4 shift completions pending, Completions' })).toHaveTextContent('4')
  })

  it('shows no badge, and the plain name, when nothing is pending', () => {
    mockUsePendingLeaveCount.mockReturnValue(0)
    mockUsePendingCompletionCount.mockReturnValue(0)
    renderAt('/')
    expect(openGroupToggle('Staff & roster')).not.toHaveTextContent(/\d/)
  })

  it('puts no badge on a group that has no pending source', () => {
    renderAt('/')
    expect(openGroupToggle('Trips')).not.toHaveTextContent(/\d/)
    expect(openGroupToggle('Participants')).not.toHaveTextContent(/\d/)
  })
})

describe('AppLayout — a closed group that holds the current page stays marked (U3)', () => {
  const FILL = 'bg-[var(--color-primary-fixed)]'

  afterEach(() => {
    localStorage.clear()
  })

  it('takes the lit fill and aria-current when the user closes the group they are in, and loses both when it opens', () => {
    renderAt('/rostering/leave')
    const toggle = openGroupToggle(/Staff & roster$/)
    // Open: the child link is the lit one, the header only turns bold.
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).not.toHaveAttribute('aria-current')
    expect(toggle).not.toHaveClass(FILL)
    expect(toggle).toHaveClass('font-bold')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-current', 'true')
    expect(toggle).toHaveClass(FILL, 'font-bold')

    fireEvent.click(toggle)
    expect(toggle).not.toHaveAttribute('aria-current')
    expect(toggle).not.toHaveClass(FILL)
  })

  it('never marks a closed group that does not hold the page', () => {
    renderAt('/trips')
    for (const name of [/Participants$/, /Staff & roster$/]) {
      const toggle = openGroupToggle(name)
      expect(toggle, String(name)).not.toHaveAttribute('aria-current')
      expect(toggle, String(name)).not.toHaveClass(FILL)
    }
  })
})

describe('AppLayout — the bottom bar is generated from the same config (U6)', () => {
  const moreButton = () => within(mobileNav()).getByRole('button', { name: /More$/ })
  const lit = () => Array.from(mobileNav().children).filter(cell => cell.className.includes('text-[var(--color-primary)]')).map(cell => cell.textContent)

  afterEach(() => {
    localStorage.clear()
    mockUsePendingLeaveCount.mockReturnValue(0)
    mockUsePendingCompletionCount.mockReturnValue(0)
    mockUsePendingWitnessRequests.mockReturnValue({ data: [], isLoading: false })
  })

  it.each(['SuperAdmin', 'Admin', 'Coordinator', 'ReadOnly'])('gives %s the Dashboard, Trips, Roster and Participants, then More (it said People, and had Settings)', role => {
    signIn(role)
    renderAt('/trips')
    expect(barLabels()).toEqual(['dashboardDashboard', 'mapTrips', 'calendar_view_weekRoster', 'groupParticipants', 'menuMore'])
  })

  it('gives a SupportWorker a bar that starts with My Shifts, and Incidents instead of the Dashboard and the roster', () => {
    signIn('SupportWorker')
    renderAt('/trips')
    expect(barLabels()).toEqual(['calendar_todayMy Shifts', 'mapTrips', 'groupParticipants', 'emergencyIncidents', 'menuMore'])
  })

  it('gives ReadOnly a Roster cell that opens Staff (the Board is refused it), still lit on its pages', () => {
    signIn('ReadOnly')
    renderAt('/qualifications')
    expect(within(mobileNav()).getByRole('link', { name: 'Roster' })).toHaveAttribute('href', '/staff')
    expect(lit()).toEqual(['calendar_view_weekRoster'])
  })

  it('names each cell by its label alone and links it to the first page of its section', () => {
    signIn('Coordinator')
    renderAt('/')
    const bar = within(mobileNav())
    expect(bar.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/')
    expect(bar.getByRole('link', { name: 'Trips' })).toHaveAttribute('href', '/trips')
    expect(bar.getByRole('link', { name: 'Roster' })).toHaveAttribute('href', '/rostering')
    expect(bar.getByRole('link', { name: 'Participants' })).toHaveAttribute('href', '/participants')
  })

  it('lights the cell of the section that holds the page, not only the cell that links to it exactly', () => {
    signIn('Coordinator')
    for (const [path, expected] of [
      ['/', 'Dashboard'], ['/trips/t-1', 'Trips'], ['/schedule', 'Trips'], ['/vehicles', 'Trips'], ['/tasks', 'Trips'],
      ['/rostering/leave', 'Roster'], ['/staff', 'Roster'], ['/qualifications', 'Roster'],
      ['/participants/p-1', 'Participants'], ['/onboarding/p-1', 'Participants'], ['/medications', 'Participants'],
    ] as const) {
      const { unmount } = renderAt(path)
      expect(lit(), path).toEqual([expect.stringContaining(expected)])
      unmount()
    }
  })

  it('lights More on a page the bar does not list, and only then', () => {
    signIn('Coordinator')
    for (const path of ['/budgets', '/incidents', '/settings', '/portal']) {
      const { unmount } = renderAt(path)
      expect(lit(), path).toEqual(['menuMore'])
      expect(moreButton(), path).toHaveAttribute('aria-current', 'true')
      unmount()
    }
    renderAt('/trips')
    expect(moreButton()).not.toHaveAttribute('aria-current')
  })

  it('marks the lit cell aria-current: "page" for a page that is the link, "true" for a section that holds the page', () => {
    signIn('Coordinator')
    const { unmount } = renderAt('/')
    expect(within(mobileNav()).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(within(mobileNav()).getByRole('link', { name: 'Trips' })).not.toHaveAttribute('aria-current')
    unmount()
    renderAt('/schedule')
    expect(within(mobileNav()).getByRole('link', { name: 'Trips' })).toHaveAttribute('aria-current', 'true')
  })

  it('shows the Staff & roster count on the Roster cell and My Shifts\' on a SupportWorker\'s, announced in the name', () => {
    signIn('Coordinator')
    mockUsePendingLeaveCount.mockReturnValue(3)
    mockUsePendingCompletionCount.mockReturnValue(4)
    const { unmount } = renderAt('/')
    expect(within(mobileNav()).getByRole('link', { name: '7 approvals pending, Roster' })).toHaveTextContent('7')
    unmount()

    localStorage.clear()
    signIn('SupportWorker')
    mockUsePendingWitnessRequests.mockReturnValue({ data: [{}, {}], isLoading: false })
    renderAt('/')
    expect(within(mobileNav()).getByRole('link', { name: '2 witness approvals pending, My Shifts' })).toHaveTextContent('2')
  })

  it('opens the drawer from More, the same one as the header toggle', () => {
    signIn('Coordinator')
    renderAt('/')
    expect(moreButton()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(moreButton())
    expect(screen.getByRole('dialog', { name: 'Main menu' })).toBe(aside())
    expect(moreButton()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('AppLayout — the drawer is a dialog while it is a drawer (below lg)', () => {
  /** matchMedia for `(min-width: 64rem)` that can change width, with its change listeners (jsdom has no matchMedia). */
  function stubViewport(wide: boolean) {
    let isWide = wide
    const listeners = new Set<() => void>()
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() { return isWide },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })) as unknown as typeof window.matchMedia
    return { resize: (nextWide: boolean) => { isWide = nextWide; act(() => listeners.forEach(listener => listener())) } }
  }
  const openWithHeaderToggle = () => fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  const dialog = () => screen.getByRole('dialog', { name: 'Main menu' })

  beforeEach(() => signIn('Admin'))
  afterEach(() => {
    localStorage.clear()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('is a plain landmark, taken out of the tab order below lg, while closed', () => {
    renderAt('/trips')
    expect(screen.getByRole('complementary')).toBe(aside())
    expect(aside()).not.toHaveAttribute('role')
    expect(aside()).not.toHaveAttribute('aria-modal')
    // `inert` takes its links out of the Tab order and the accessibility tree (they were 13 off-screen tab stops before the page).
    // Not `invisible`: that is inherited, and the nav items' `transition-all` makes each link start hidden, so the focus the dialog moves
    // in on opening was refused for the first frames (found in a real browser, not in jsdom).
    expect(aside()).toHaveAttribute('inert')
    expect(aside()).toHaveClass('-translate-x-full')
    expect(aside().className).not.toContain('invisible')
  })

  it('becomes a modal dialog named "Main menu" while open: visible at once, with focus moved onto its first item', () => {
    renderAt('/trips')
    openWithHeaderToggle()
    expect(dialog()).toBe(aside())
    expect(dialog()).toHaveAttribute('aria-modal', 'true')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    // An inert element cannot take the focus the dialog moves in, so opening drops `inert` in the same commit.
    expect(dialog()).toHaveClass('translate-x-0')
    expect(dialog()).not.toHaveAttribute('inert')
    expect(document.activeElement).toBe(within(dialog()).getByRole('link', { name: 'Dashboard' }))
  })

  it('keeps Tab inside: from Sign Out it wraps to the first item, and Shift+Tab from the first item wraps to Sign Out', () => {
    renderAt('/trips')
    openWithHeaderToggle()
    const first = within(dialog()).getByRole('link', { name: 'Dashboard' })
    const signOut = within(dialog()).getByRole('button', { name: 'Sign Out' })

    signOut.focus()
    fireEvent.keyDown(signOut, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(signOut)
  })

  it('locks the page scroll while open and releases it when it closes', () => {
    renderAt('/trips')
    expect(document.body.style.overflow).toBe('')
    openWithHeaderToggle()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.style.overflow).toBe('')
  })

  it('closes on Escape and gives focus back to whatever opened it: the header toggle, or "More"', () => {
    renderAt('/trips')
    for (const opener of [screen.getByRole('button', { name: 'Open menu' }), within(mobileNav()).getByRole('button', { name: /More$/ })]) {
      opener.focus()
      fireEvent.click(opener)
      expect(dialog()).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(document.activeElement, opener.textContent ?? '').toBe(opener)
    }
  })

  it('closes when a link in it is followed', () => {
    renderAt('/trips')
    openWithHeaderToggle()
    fireEvent.click(within(dialog()).getByRole('link', { name: 'Dashboard' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('is not a dialog from lg up, whatever the state says: no role, not inert, no scroll lock, no scrim', () => {
    stubViewport(true)
    renderAt('/trips')
    expect(aside()).not.toHaveAttribute('inert')
    openWithHeaderToggle()
    expect(aside()).not.toHaveAttribute('inert')
    expect(screen.getByRole('complementary')).toBe(aside())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(document.querySelector('[class*="bg-black"]')).toBeNull()
  })

  it('stops being a dialog when the window grows past lg while it is open, and does not come back when it shrinks again', () => {
    const viewport = stubViewport(false)
    renderAt('/trips')
    openWithHeaderToggle()
    expect(dialog()).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')

    viewport.resize(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(aside()).not.toHaveAttribute('inert')

    viewport.resize(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false')
    expect(aside()).toHaveAttribute('inert')
  })
})


// A page that throws takes the page area down, not the shell: the nav is how the user leaves it. A page that is still loading does the
// same: it suspends inside the shell, not at the app's root boundary.
describe('AppLayout — a page that throws, or is still loading, leaves the shell standing', () => {
  function Boom(): never {
    throw new Error('page exploded')
  }
  function renderRoutes(initialPath: string) {
    const router = createMemoryRouter(
      [{ element: <AppLayout />, children: [{ path: '/boom', element: <Boom /> }, { path: '*', element: <div>A working page</div> }] }],
      { initialEntries: [initialPath] },
    )
    render(<RouterProvider router={router} />)
    return router
  }

  beforeEach(() => {
    signIn('Coordinator')
    // React and the boundary both log the caught error.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('shows the error in the page area with the sidebar, the header and the bottom bar still there', () => {
    renderRoutes('/boom')
    const main = document.getElementById('main') as HTMLElement
    expect(within(main).getByText('Something went wrong')).toBeInTheDocument()
    expect(within(main).getByText('page exploded')).toBeInTheDocument()
    expect(mainNav()).toBeInTheDocument()
    expect(mobileNav()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    // The error fills the page area, not the viewport: the shell around it is not pushed off screen.
    expect(main.querySelector('.min-h-screen')).toBeNull()
  })

  it('keeps the shell on screen, with a loading status in the page area, while a lazy page loads', () => {
    // The root boundary would replace the whole app with "Loading..." for a frame, dropping the focus the drawer had just returned.
    const Pending = lazy(() => new Promise<{ default: () => null }>(() => {}))
    const router = createMemoryRouter([{ element: <AppLayout />, children: [{ path: '*', element: <Pending /> }] }], { initialEntries: ['/trips'] })
    render(<RouterProvider router={router} />)
    expect(within(document.getElementById('main') as HTMLElement).getByRole('status')).toHaveTextContent('Loading...')
    expect(mainNav()).toBeInTheDocument()
    expect(mobileNav()).toBeInTheDocument()
  })

  it('recovers when the user follows a nav link away from the broken page', () => {
    renderRoutes('/boom')
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    fireEvent.click(within(mainNav()).getByRole('link', { name: 'Dashboard' }))
    expect(screen.getByText('A working page')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})

describe('AppLayout — Sign Out', () => {
  afterEach(() => {
    localStorage.clear()
    mockEndSession.mockReset()
  })

  it('ends the whole session (cookie, Firebase user and keys), not just the browser keys', () => {
    localStorage.setItem('odip_token', 'a-session')
    renderAt('/trips')

    fireEvent.click(screen.getByRole('button', { name: /Sign Out$/ }))

    expect(mockEndSession).toHaveBeenCalledTimes(1)
  })
})
