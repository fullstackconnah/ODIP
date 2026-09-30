import { describe, it, expect, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AppLayout from './AppLayout'
import { TAP_AREA } from '@/components/tapArea'

// AppLayout renders the portal nav's pending-witness-count badge and the Rostering nav's
// pending-leave-count badge via TanStack Query hooks — stub just those exports (keeping the
// rest of the real module intact for TenantSwitcher/UserSwitcher, unused by these tests but
// still imported transitively) so this suite doesn't need a QueryClientProvider or a real
// network call, matching how the other hook-backed page tests in this codebase mock
// '@/api/hooks' rather than provide a live client.
const { mockUsePendingLeaveCount, mockUsePendingWitnessRequests, mockUsePendingCompletionCount } = vi.hoisted(() => ({
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
      // Participants hub at /participants — see AppLayout's navItems.
      expect(screen.getByRole('link', { name: /Participants$/ })).toBeInTheDocument()
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

  it('gives every mobile bottom-nav link a --tap-min floor each way, its content centred, so the 42px links are 44px', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/trips')
    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    for (const name of [/Dashboard$/, /Trips$/, /People$/, /Settings$/]) {
      const link = within(nav).getByRole('link', { name })
      expect(link, String(name)).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center', 'gap-1', 'min-h-[var(--tap-min)]', 'min-w-[var(--tap-min)]')
    }
  })

  it('does not use the ::before pad on the bottom-nav links: the cells tile the row, so a pad past a cell would overlap its neighbour and a floor cannot', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    for (const link of within(nav).getAllByRole('link')) expect(link.className).not.toContain('before:')
  })

  it('shares the bottom-nav row in equal-width cells with nothing else in it, so the links stay evenly spaced with the centre create action gone', () => {
    for (const [role, count] of [['Admin', 4], ['SupportWorker', 3]] as const) {
      localStorage.setItem('odip_user', JSON.stringify({ role }))
      const { unmount } = renderAt('/trips')
      const nav = screen.getByRole('navigation', { name: 'Mobile' })
      const links = within(nav).getAllByRole('link')
      expect(links, role).toHaveLength(count)
      // Every child of the row is one of the links (no spacer or placeholder where the "+" was), each an equal `flex-1`
      // cell, and the row no longer distributes free space with justify-around.
      expect(nav.childElementCount, role).toBe(count)
      for (const link of links) expect(link, `${role}: ${link.textContent}`).toHaveClass('flex-1')
      expect(nav.className).not.toContain('justify-')
      unmount()
      localStorage.clear()
    }
  })

  it('keeps the active colour on the padded links', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/trips')
    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(within(nav).getByRole('link', { name: /Trips$/ })).toHaveClass('text-[var(--color-primary)]')
    expect(within(nav).getByRole('link', { name: /Settings$/ })).toHaveClass('text-[var(--color-secondary)]')
  })
})

// Density polish (touch): the drawer's items were 28-32px, and with the drawer open "Sign Out" sat UNDER the fixed bottom
// nav (both were z-50, the nav later in the DOM), so it could not be tapped. The items take a --tap-min floor (0px on a
// mouse, 44px under `pointer: coarse`), and below lg the drawer and its scrim sit above the nav.
describe('AppLayout — the mobile drawer (touch targets and stacking)', () => {
  const FLOOR = 'min-h-[var(--tap-min)]'
  const sidebar = () => screen.getByRole('complementary') as HTMLElement

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
    const staff = within(main).getByRole('link', { name: /Staff$/ })
    expect(staff).toHaveClass(FLOOR)
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
  const sidebar = () => screen.getByRole('complementary') as HTMLElement
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

  const FULL_BOTTOM_NAV = ['/', '/trips', '/participants', '/settings']
  it.each<[string, string[]]>([
    ['SuperAdmin', FULL_BOTTOM_NAV],
    ['Admin', FULL_BOTTOM_NAV],
    ['Coordinator', FULL_BOTTOM_NAV],
    // ReadOnly had the "+" too: canWrite is true for it (the backend is what blocks the save).
    ['ReadOnly', FULL_BOTTOM_NAV],
    // A SupportWorker never had the "+" (canWrite is false) and still has no Settings (canAccessPage): three links.
    ['SupportWorker', ['/', '/trips', '/participants']],
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
      '/trips', '/schedule', '/bookings', '/accommodation', '/vehicles',
      '/rostering', '/rostering/patterns', '/rostering/compatibility', '/rostering/leave', '/rostering/completions',
      '/billing',
      '/participants', '/medications', '/caregiver-submissions',
      '/staff', '/tasks', '/incidents', '/qualifications', '/settings',
    ])
  })

  it('still hides the pages a SupportWorker may not open (Bookings, Rostering, Billing, Staff, Qualifications, Settings) from the sidebar', () => {
    signIn('SupportWorker')
    renderAt('/trips')

    expect(hrefs(mainNav())).toEqual([
      '/', '/portal',
      '/trips', '/schedule',
      '/participants', '/medications', '/caregiver-submissions',
      '/tasks', '/incidents',
    ])
  })
})
