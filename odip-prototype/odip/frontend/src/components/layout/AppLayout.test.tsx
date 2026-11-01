import { lazy } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, RouterProvider, createMemoryRouter } from 'react-router-dom'
import AppLayout from './AppLayout'
import { UiPreferencesProvider } from '@/hooks/useUiPreferences'

// AppLayout renders the portal nav's pending-witness-count badge and the Rostering nav's
// pending-leave-count badge via TanStack Query hooks — stub just those exports (keeping the
// rest of the real module intact for TenantSwitcher/UserSwitcher, unused by these tests but
// still imported transitively) so this suite doesn't need a QueryClientProvider or a real
// network call, matching how the other hook-backed page tests in this codebase mock
// '@/api/hooks' rather than provide a live client.
const { mockUsePendingLeaveCount, mockUsePendingWitnessRequests, mockUsePendingCompletionCount, mockUseInbox, mockEndSession, mockUseModuleVisibility } = vi.hoisted(() => ({
  mockUseModuleVisibility: vi.fn(() => ({ data: { hiddenAccommodation: false, hiddenVehicles: false }, isError: false })),
  mockEndSession: vi.fn(),
  mockUsePendingLeaveCount: vi.fn(() => 0),
  mockUsePendingWitnessRequests: vi.fn(() => ({ data: [] as unknown[], isLoading: false })),
  mockUsePendingCompletionCount: vi.fn(() => 0),
  mockUseInbox: vi.fn(() => ({ data: undefined as { items: unknown[]; unreadCount: number; hasMore: boolean } | undefined, isError: false, refetch: vi.fn() })),
}))

vi.mock('@/api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks')>()
  return {
    ...actual,
    useModuleVisibility: mockUseModuleVisibility,
    usePendingWitnessRequests: mockUsePendingWitnessRequests,
    usePendingLeaveCount: mockUsePendingLeaveCount,
    // Same reason as usePendingLeaveCount above — without this, AppLayout's new Completions nav
    // entry would call the real usePendingCompletionCount, which calls useQuery and needs a
    // QueryClientProvider this suite doesn't set up.
    usePendingCompletionCount: mockUsePendingCompletionCount,
    // The header bell (NotificationBell) polls the inbox and marks items read: stubbed for the same reason as the counts above.
    useInbox: mockUseInbox,
    useMarkInboxRead: () => ({ mutate: vi.fn() }),
    useMarkAllInboxRead: () => ({ mutate: vi.fn(), reset: vi.fn(), isError: false }),
    // The What's new button reads its feed and marks it seen: nothing new here.
    useWhatsNew: () => ({ data: { entries: [], unreadCount: 0, popup: [] }, isError: false, refetch: vi.fn() }),
    useMarkWhatsNewSeen: () => ({ mutate: vi.fn() }),
    useMarkWhatsNewPopupSeen: () => ({ mutate: vi.fn() }),
  }
})

// Signing out is endSession's job (the server cookie, the Firebase user, the browser keys, the redirect); this suite only checks that the button calls it.
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), endSession: mockEndSession }))

// A SuperAdmin's header also renders the tenant switcher, whose own TanStack Query hook needs a QueryClientProvider this
// suite does not set up. It is header chrome, not navigation, so stub it: the role-by-role nav tests below cover SuperAdmin.
vi.mock('@/components/layout/TenantSwitcher', () => ({ default: () => null }))
vi.mock('@/components/layout/UserSwitcher', () => ({ default: () => null }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<AppLayout />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('platform page finder', () => {
  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator', fullName: 'Synthetic Coordinator' }))
    mockUseModuleVisibility.mockReturnValue({ data: { hiddenAccommodation: false, hiddenVehicles: false }, isError: false })
  })

  afterEach(() => {
    localStorage.clear()
    mockUseModuleVisibility.mockReturnValue({ data: { hiddenAccommodation: false, hiddenVehicles: false }, isError: false })
  })

  it('replaces inert entity search with a filter of existing permitted page destinations', () => {
    renderAt('/')
    expect(screen.queryByRole('textbox', { name: 'Search trips and participants' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Find a page' }))
    const dialog = screen.getByRole('dialog', { name: 'Explore the platform' })
    expect(document.querySelector('header')).not.toContainElement(dialog)
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Find a page' }), { target: { value: 'medication' } })
    expect(within(dialog).getByRole('link', { name: /Medications/ })).toHaveAttribute('href', '/medications')
    expect(within(dialog).queryByRole('link', { name: /^Trips/ })).not.toBeInTheDocument()
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Find a page' }), { target: { value: 'no matching page' } })
    expect(within(dialog).getByText('No matching page. Try a different page name.')).toBeInTheDocument()
    expect(within(dialog).queryAllByRole('link')).toHaveLength(0)
  })

  it('navigates to the chosen existing page and closes the directory', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Find a page' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /^Medications/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Medications' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not advertise refused role destinations or explicitly hidden workspaces', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    mockUseModuleVisibility.mockReturnValue({ data: { hiddenAccommodation: true, hiddenVehicles: true }, isError: false })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Find a page' }))
    const dialog = screen.getByRole('dialog', { name: 'Explore the platform' })
    expect(within(dialog).getByRole('link', { name: /^Participants/ })).toHaveAttribute('href', '/participants')
    for (const name of ['Roster board', 'Leave', 'Completions', 'Budgets', 'Settings', 'Caregiver forms', 'Vehicles', 'Accommodation']) {
      expect(within(dialog).queryByRole('link', { name: new RegExp(`^${name}`) })).not.toBeInTheDocument()
    }
  })

  it('closes on Escape and opens a fresh unfiltered directory', () => {
    renderAt('/')
    const trigger = screen.getByRole('button', { name: 'Find a page' })
    fireEvent.click(trigger)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a page' }), { target: { value: 'medication' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Explore the platform' })).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.getByRole('searchbox', { name: 'Find a page' })).toHaveValue('')
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: /^Trips/ })).toBeInTheDocument()
  })

  it('keeps presentation-only workspaces discoverable when the current visibility answer fails', () => {
    mockUseModuleVisibility.mockReturnValue({ data: { hiddenAccommodation: true, hiddenVehicles: true }, isError: true })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Find a page' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('link', { name: /^Accommodation/ })).toHaveAttribute('href', '/accommodation')
    expect(within(dialog).getByRole('link', { name: /^Vehicles/ })).toHaveAttribute('href', '/vehicles')
  })

  it.each([null, 'UnknownRole'])('offers no directory destinations for an unrecognised role %s', role => {
    localStorage.setItem('odip_user', JSON.stringify({ role }))
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Find a page' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryAllByRole('link')).toHaveLength(0)
    expect(within(dialog).getByText('No platform pages are available for this account.')).toBeInTheDocument()
  })
})

describe('AppLayout — the organisation name in the header', () => {
  afterEach(() => localStorage.clear())

  // Below md the bar keeps four 44px targets (menu, page finder, What's new, bell), so the name moves into the menu drawer.
  it('shows in the bar from md up, trimmed with an ellipsis, and never below md', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin', tenantName: 'Jo Care Support Services' }))
    renderAt('/trips')
    const chip = within(document.querySelector('header')!).getByText('Jo Care Support Services')
    expect(chip).toHaveClass('hidden', 'md:inline-block', 'truncate')
    expect(chip).toHaveAttribute('title', 'Jo Care Support Services')
  })

  it('shows in the menu drawer below md as one muted 13px line under the wordmark that wraps and is never truncated', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin', tenantName: 'Jo Care Support Services' }))
    renderAt('/trips')
    const line = within(document.querySelector('aside')!).getByText('Jo Care Support Services')
    expect(line).toHaveClass('md:hidden', 'text-[13px]', 'text-[var(--color-muted-foreground)]', 'break-words')
    expect(line).not.toHaveClass('truncate')
  })

  it('is not repeated in the drawer for a SuperAdmin, whose tenant switcher already names the organisation', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SuperAdmin', tenantName: 'Jo Care Support Services' }))
    renderAt('/trips')
    expect(within(document.querySelector('header')!).getByText('Jo Care Support Services')).toHaveClass('hidden', 'md:inline-block')
    expect(within(document.querySelector('aside')!).queryByText('Jo Care Support Services')).toBeNull()
  })
})

describe('AppLayout nav active state', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('marks the "Roster board" entry active only on exactly /rostering', () => {
    renderAt('/rostering')
    // Roster board's NavLink uses `end` matching, so it's active on exactly this path. The accessible
    // name includes the leading material-icon ligature text (e.g. "calendar_view_week Roster board"),
    // so these match on the visible label rather than the full name.
    expect(screen.getByRole('link', { name: /Roster board$/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Shift patterns$/ })).not.toHaveAttribute('aria-current')
  })

  it('activates the "Patterns" entry, not the "Roster board" parent, on /rostering/patterns', () => {
    renderAt('/rostering/patterns')
    expect(screen.getByRole('link', { name: /Shift patterns$/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Roster board$/ })).not.toHaveAttribute('aria-current')
  })

  it('still activates the Trips link on a /trips/:id detail route (prefix match must not regress)', () => {
    renderAt('/trips/trip-123')
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /Trips$/ })).toHaveAttribute('aria-current', 'page')
  })

  it('activates the Trips link on the exact /trips path too', () => {
    renderAt('/trips')
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /Trips$/ })).toHaveAttribute('aria-current', 'page')
  })
})

describe('AppLayout — skip link and labelled landmarks (I-4)', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('gives the header menu toggle the house keyboard focus ring', () => {
    renderAt('/inquiries')
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-[var(--color-ring)]')
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

  it('heads the sidebar with the Bunya Support wordmark, and no old Odip name', () => {
    renderAt('/trips')
    expect(screen.getByText('Bunya Support')).toBeInTheDocument()
    expect(screen.queryByText('Odip')).toBeNull()
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

describe('AppLayout — Payroll nav entry', () => {
  afterEach(() => mockUseModuleVisibility.mockReturnValue({ data: { hiddenAccommodation: false, hiddenVehicles: false }, isError: false }))

  it('hides Payroll until Employment Hero is connected', () => {
    renderAt('/rostering')
    expect(screen.queryByRole('link', { name: /Payroll$/ })).not.toBeInTheDocument()
  })

  it('shows Payroll under Rostering once connected, linking to /rostering/payroll', () => {
    mockUseModuleVisibility.mockReturnValue({ data: { hiddenAccommodation: false, hiddenVehicles: false, employmentHeroConnected: true } as never, isError: false })
    renderAt('/rostering')
    expect(screen.getByRole('link', { name: /Payroll$/ })).toHaveAttribute('href', '/rostering/payroll')
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
    expect(screen.getByRole('link', { name: '2 witness approvals pending, My shifts' })).toHaveAttribute('href', '/portal')
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
      'groupParticipants', 'verifiedAgreements', 'pillMedications', 'checklist_rtlCaregiver forms',
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
  // The header controls are 44px boxes under touch, not 36/32px boxes with an invisible pad: what is measured is what is tappable.
  const box = ['pointer-coarse:size-[var(--tap-min)]']

  afterEach(() => {
    localStorage.clear()
  })

  it('gives the header "Open menu" toggle (36px) a real 44px box under touch and keeps it when it becomes "Close menu"', () => {
    renderAt('/trips')
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveClass('size-8', 'rounded-full', 'lg:hidden', ...box)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveClass(...box)
  })

  it('gives the header "Notifications" bell (32px) a real 44px box under touch, a working button now', () => {
    renderAt('/trips')
    const bell = screen.getByRole('button', { name: 'Notifications' })
    expect(bell).toHaveClass('w-8', 'h-8', ...box)
    expect(bell).toBeEnabled()
  })

  it("puts the What's new button (32px, a real 44px box under touch) just before the bell, and hides the avatar below lg to make room", () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin', firstName: 'Sam' }))
    renderAt('/trips')
    const whatsNew = screen.getByRole('button', { name: "What's new" })
    const bell = screen.getByRole('button', { name: 'Notifications' })
    expect(whatsNew).toHaveClass('w-8', 'h-8', ...box)
    expect(whatsNew).toBeEnabled()
    expect(whatsNew.parentElement?.nextElementSibling).toBe(bell.parentElement)
    expect(bell.parentElement?.nextElementSibling).toHaveClass('max-lg:hidden')
    expect(bell.parentElement?.parentElement).toHaveClass('gap-3', 'max-lg:gap-2')
  })

  it('keeps the menu toggle and the page finder at full size at every width so the tenant chip, not they, gives way', () => {
    renderAt('/trips')
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveClass('shrink-0')
    expect(screen.getByRole('button', { name: /Find a page/ }).parentElement).toHaveClass('shrink-0')
  })

  it('hides the theme menu below lg (it stays reachable as Settings > Appearance), so the bar keeps four targets on a phone', () => {
    renderAt('/trips')
    const themeMenu = screen.getByRole('button', { name: /theme/i })
    expect(themeMenu.closest('[class~="max-lg:hidden"]')).not.toBeNull()
  })

  it('draws the page finder as a bare round icon button below md and as a field from md', () => {
    renderAt('/trips')
    const finder = screen.getByRole('button', { name: 'Find a page' })
    expect(finder).toHaveClass('size-8', 'rounded-full', 'hover:bg-[var(--color-accent)]', 'text-[var(--color-muted-foreground)]', 'pointer-coarse:min-h-[var(--tap-min)]', 'pointer-coarse:min-w-[var(--tap-min)]')
    expect(finder).toHaveClass('md:w-72', 'md:bg-[var(--color-field)]', 'md:border-[var(--color-field-border)]')
  })

  it('collapses the page finder to its icon below xl only while a SuperAdmin views a tenant, where two switchers need the room', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin', firstName: 'Sam' }))
    const { unmount } = renderAt('/trips')
    expect(screen.getByRole('button', { name: 'Find a page' })).toHaveClass('md:w-72')
    unmount()
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SuperAdmin', firstName: 'Sam' }))
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-0001')
    renderAt('/trips')
    expect(screen.getByRole('button', { name: 'Find a page' })).toHaveClass('xl:w-72')
    expect(screen.getByRole('button', { name: 'Find a page' })).toHaveAttribute('title', 'Find a page')
    expect(screen.getByRole('button', { name: 'Find a page' })).not.toHaveClass('md:w-72')
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

  it('sizes the bottom nav with --mobile-nav-h, the var the sticky wizard footer sits above, and the footer after main clears it by the same var', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    const { container } = renderAt('/trips')
    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(nav).toHaveClass('h-[var(--mobile-nav-h)]', 'fixed', 'bottom-0', 'lg:hidden', 'pb-[var(--safe-bottom)]', 'pl-[max(0.5rem,var(--safe-left))]', 'pr-[max(0.5rem,var(--safe-right))]')
    // The clearance moved from main to the platform footer, the last thing in the content column.
    const main = container.querySelector('main')!
    expect(main).toHaveClass('pb-6')
    expect(main.className).not.toContain('mobile-nav-h')
    const footer = screen.getByRole('contentinfo')
    expect(main.nextElementSibling).toBe(footer)
    expect(footer.parentElement!.lastElementChild).toBe(footer)
    expect(footer).toHaveClass('pb-[calc(var(--mobile-nav-h)+0.75rem)]', 'lg:pb-3')
    // md:p-6 once overrode the clearance between 768 and 1024px; no breakpoint below lg may set padding-bottom on either element.
    expect(footer.className).not.toMatch(/(^|\s)(sm|md):pb-/)
    expect(main.className).not.toMatch(/(^|\s)(sm|md|lg):pb-/)
  })

  it('always renders the platform footer beside main, never inside it, with its Accessibility link, for the office and the field', () => {
    for (const [role, path] of [['Admin', '/trips'], ['SupportWorker', '/portal']]) {
      localStorage.setItem('odip_user', JSON.stringify({ role }))
      const { container, unmount } = renderAt(path)
      expect(container.querySelectorAll('main'), role).toHaveLength(1)
      expect(screen.getAllByRole('contentinfo'), role).toHaveLength(1)
      const footer = screen.getByRole('contentinfo')
      expect(footer.closest('main, article, aside, nav, section'), role).toBeNull()
      expect(within(footer).getByRole('link', { name: 'Accessibility (opens in a new tab)' }), role).toHaveAttribute('href', '/accessibility')
      unmount()
      localStorage.clear()
    }
  })

  it('pads the sticky header below the notch and away from landscape side insets (safe-area tokens, 48px of content)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/trips')
    const header = document.querySelector('header')!
    expect(header).toHaveClass('h-[calc(3rem+var(--safe-top))]', 'pt-[var(--safe-top)]')
    expect(header.firstElementChild).toHaveClass('pl-[max(var(--gutter,20px),var(--safe-left))]', 'pr-[max(var(--gutter,20px),var(--safe-right))]')
  })

  it('defines --mobile-nav-h for both pointer types as exactly what the nav content needs: 12px + the taller of the 42px link and --tap-min + 12px', () => {
    // jsdom does no layout, so read the source of truth: index.css. The bottom nav's links are 42px of icon + label and take a
    // --tap-min floor (0px on a mouse, 44px under `pointer: coarse`); the nav pads 12px above and below them. If the var and
    // the content drift apart the sticky wizard footer either floats above a gap or slides under the nav (the bug this pins).
    const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8')
    const navH = [...css.matchAll(/--mobile-nav-h:\s*calc\((\d+)px \+ var\(--safe-bottom\)\)/g)].map(m => Number(m[1]))
    expect(css).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/) // the inset is counted once, inside the nav height
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

// Density polish (touch): the drawer's items were 28-32px, and with the drawer open "Sign out" sat UNDER the fixed bottom
// nav (both were z-50, the nav later in the DOM), so it could not be tapped. The items take a --tap-min floor (0px on a
// mouse, 44px under `pointer: coarse`), and below lg the drawer and its scrim sit above the nav.
describe('AppLayout — the mobile drawer (touch targets and stacking)', () => {
  const FLOOR = 'min-h-[var(--tap-min)]'
  // The <aside> is a `complementary` landmark while closed and a `dialog` while the drawer is open, so find it by tag.
  const sidebar = () => document.querySelector('aside') as HTMLElement

  afterEach(() => {
    localStorage.clear()
  })

  it('puts the drawer above the fixed bottom nav below lg, so "Sign out" is not covered by it', () => {
    renderAt('/trips')

    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    // The nav is z-50 and the drawer used to be z-50 too, the nav coming later in the DOM: it painted over Sign out.
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
    // Mounted while closed so its opacity can fade with the drawer, but invisible, hidden from AT and unable to catch a tap.
    const scrim = container.querySelector('[class*="bg-black"]') as HTMLElement
    expect(scrim).toHaveClass('opacity-0', 'pointer-events-none', 'transition-opacity', 'duration-200')
    expect(scrim).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    expect(scrim).toHaveClass('opacity-100')
    expect(scrim).not.toHaveClass('opacity-0', 'pointer-events-none')
    expect(scrim).toHaveClass('fixed', 'inset-0', 'z-[55]', 'lg:hidden')
    // 50 (nav) < 55 (scrim) < 60 (drawer).
    expect(sidebar()).toHaveClass('z-[60]')
    expect(screen.getByRole('navigation', { name: 'Mobile' })).toHaveClass('z-50')
    fireEvent.click(scrim)
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('floors every drawer item at --tap-min: top-level links, group toggles, group children and Sign out', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/trips')
    const main = within(sidebar()).getByRole('navigation', { name: 'Main' })

    const dashboard = within(main).getByRole('link', { name: /Dashboard$/ })
    expect(dashboard).toHaveClass(FLOOR, 'py-1.5', 'text-sm')
    const tripsToggle = within(main).getByRole('button', { name: /Trips$/ })
    expect(tripsToggle).toHaveClass(FLOOR, 'py-1.5', 'w-full')
    // A group child stays h-7 (28px) on a mouse; the floor lifts it to 44px on touch.
    const allTrips = within(main).getByRole('link', { name: /Trips$/ })
    expect(allTrips).toHaveClass('h-7', FLOOR)
    // Staff lives in the Staff & roster group, closed at /trips, and a closed panel is `aria-hidden`: open it first.
    const rosterToggle = within(main).getByRole('button', { name: /Staff & roster$/ })
    expect(rosterToggle).toHaveClass(FLOOR, 'py-1.5', 'w-full')
    fireEvent.click(rosterToggle)
    const staff = within(main).getByRole('link', { name: /Staff$/ })
    expect(staff).toHaveClass('h-7', FLOOR)
    const signOut = within(sidebar()).getByRole('button', { name: /Sign out$/ })
    expect(signOut).toHaveClass('h-8', FLOOR)
  })

  it('floors every link and button in the drawer, not just the ones asserted by name', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/trips')

    // Everything interactive in the aside: the Main nav's links and group toggles, and Sign out. Nothing is exempt: the
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
  // Links and buttons in the sidebar outside its Main nav: only Sign out. The CTA lived in exactly this slot, between
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

  it.each(ROLES)('has no call to action in the sidebar for %s: outside the Main nav its only control is Sign out', role => {
    signIn(role)
    renderAt('/trips')

    expect(controlsOutsideNav()).toEqual(['Sign out'])
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
    expect(controlsOutsideNav()).toEqual(['Sign out'])
    expect(sidebar().querySelector('a[href^="/trips/new"]')).toBeNull()
    expect(sidebar()).not.toHaveTextContent(/new trip/i)
  })

  // The bar's links, in order, then "More" (a button, so not in this list). Generated from navConfig: the office roles' bar leads with
  // the Dashboard and carries the Staff & roster group as "Roster"; a SupportWorker's leads with My shifts and carries Incidents.
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
      '/trips', '/schedule', '/bookings', '/accommodation', '/vehicles',
      '/participants', '/agreements', '/medications', '/caregiver-submissions',
      '/rostering', '/rostering/patterns', '/rostering/compatibility', '/rostering/leave', '/rostering/completions', '/reports', '/staff', '/qualifications',
      '/tasks', '/budgets', '/claims', '/invoices',
      '/incidents', '/complaints', '/settings',
    ])
  })

  it('still hides the pages a SupportWorker may not open (Bookings, Rostering, Staff, Qualifications, Settings, Caregiver forms) from the sidebar', () => {
    signIn('SupportWorker')
    renderAt('/trips')

    // Caregiver forms used to be listed here (the link was shown to a role the route then bounces), and so did the Dashboard (a SupportWorker's
    // home is My shifts).
    expect(hrefs(mainNav())).toEqual([
      '/portal',
      '/trips', '/schedule',
      '/participants', '/medications',
      '/tasks', '/incidents',
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
    'My shifts',
    'Trips: Trips | Schedule | Bookings | Accommodation | Vehicles',
    'Participants: Participants | Agreements | Medications | Caregiver forms',
    'Staff & roster: Roster board | Shift patterns | Compatibility | Leave | Completions | Reports | Staff | Qualifications',
    'Tasks',
    'Budgets',
    'Claims',
    'Invoices',
    'Incidents',
    'Complaints',
    'Settings',
  ]
  // A SupportWorker starts from My shifts, so the Dashboard is not in their menu; they never see the pages their allow-list leaves out.
  const SUPPORT_WORKER_MENU = ['My shifts', 'Trips: Trips | Schedule', 'Participants: Participants | Medications', 'Tasks', 'Incidents']
  // ReadOnly reads most of the app but its API refuses Rostering (all five pages), Budgets, Caregiver forms and
  // Settings, so the menu does not offer them: Budgets and Settings disappear, Staff & roster is down to Staff and Qualifications.
  const READ_ONLY_MENU = [
    'Dashboard',
    'My shifts',
    'Trips: Trips | Schedule | Bookings | Accommodation | Vehicles',
    'Participants: Participants | Medications',
    'Staff & roster: Staff | Qualifications',
    'Tasks',
    'Incidents',
  ]

  it.each(['SuperAdmin', 'Admin', 'Coordinator'])('gives %s the full menu: Rostering, Staff and Qualifications are one Staff & roster group', role => {
    signIn(role)
    renderAt('/')
    expect(navShape()).toEqual(FULL_MENU)
  })

  it('gives a SupportWorker only the pages their role may open, and no Dashboard (their home is My shifts)', () => {
    signIn('SupportWorker')
    renderAt('/')
    expect(navShape()).toEqual(SUPPORT_WORKER_MENU)
    expect(screen.queryByRole('link', { name: /Dashboard$/ })).not.toBeInTheDocument()
  })

  it('gives ReadOnly a menu without the pages the server refuses it', () => {
    signIn('ReadOnly')
    renderAt('/')
    expect(navShape()).toEqual(READ_ONLY_MENU)
    for (const name of [/Roster board$/, /Shift patterns$/, /Compatibility$/, /Leave$/, /Completions$/, /Budgets$/, /Caregiver forms$/, /Complaints$/, /Settings$/]) {
      expect(screen.queryByRole('link', { name }), String(name)).not.toBeInTheDocument()
    }
  })

  it('gives Admin and Coordinator a Complaints link after Incidents, and SupportWorker and ReadOnly none', () => {
    for (const role of ['Admin', 'Coordinator']) {
      signIn(role)
      const { unmount } = renderAt('/')
      expect(screen.getByRole('link', { name: /Complaints$/ })).toHaveAttribute('href', '/complaints')
      unmount(); localStorage.clear()
    }
    for (const role of ['SupportWorker', 'ReadOnly']) {
      signIn(role)
      const { unmount } = renderAt('/')
      expect(screen.queryByRole('link', { name: /Complaints$/ }), role).not.toBeInTheDocument()
      unmount(); localStorage.clear()
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
    expect(navShape()).toHaveLength(12)
    unmount()

    localStorage.setItem(KEY, '{not json')
    renderAt('/')
    expect(navShape()).toHaveLength(12)
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
    // Open: the child link is the lit one, and the only one (the header stays as it is).
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).not.toHaveAttribute('aria-current')
    expect(toggle).not.toHaveClass(FILL)
    expect(toggle).not.toHaveClass('font-bold')

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

  it('gives a SupportWorker a bar that starts with My shifts, and Incidents instead of the Dashboard and the roster', () => {
    signIn('SupportWorker')
    renderAt('/trips')
    expect(barLabels()).toEqual(['calendar_todayMy shifts', 'mapTrips', 'groupParticipants', 'emergencyIncidents', 'menuMore'])
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
      ['/', 'Dashboard'], ['/trips/t-1', 'Trips'], ['/schedule', 'Trips'], ['/vehicles', 'Trips'], ['/tasks', 'menuMore'],
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

  it('shows the Staff & roster count on the Roster cell and My shifts\' on a SupportWorker\'s, announced in the name', () => {
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
    expect(within(mobileNav()).getByRole('link', { name: '2 witness approvals pending, My shifts' })).toHaveTextContent('2')
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

  it('keeps Tab inside: from Sign out it wraps to the first item, and Shift+Tab from the first item wraps to Sign out', () => {
    renderAt('/trips')
    openWithHeaderToggle()
    const first = within(dialog()).getByRole('link', { name: 'Dashboard' })
    const signOut = within(dialog()).getByRole('button', { name: 'Sign out' })

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

describe('AppLayout — Sign out', () => {
  afterEach(() => {
    localStorage.clear()
    mockEndSession.mockReset()
  })

  it('ends the whole session (cookie, Firebase user and keys), not just the browser keys', () => {
    localStorage.setItem('odip_token', 'a-session')
    renderAt('/trips')

    fireEvent.click(screen.getByRole('button', { name: /Sign out$/ }))

    expect(mockEndSession).toHaveBeenCalledTimes(1)
  })
})

// V2-G: the sidebar holds one group open for the page you are on, not every group you have passed through, and the page has ONE active signal.
describe('AppLayout — only the current group and the saved ones stay open', () => {
  afterEach(() => localStorage.clear())

  it('closes a group that opened itself for the page you left when you move to a page in another group', async () => {
    const router = createMemoryRouter([{ path: '*', element: <AppLayout /> }], { initialEntries: ['/trips'] })
    render(<RouterProvider router={router} />)
    expect(openGroupToggle(/Trips$/)).toHaveAttribute('aria-expanded', 'true')

    await act(async () => { await router.navigate('/participants') })
    await act(async () => { await router.navigate('/staff') })

    expect(openGroupToggle(/Staff & roster$/)).toHaveAttribute('aria-expanded', 'true')
    expect(openGroupToggle(/Trips$/)).toHaveAttribute('aria-expanded', 'false')
    expect(openGroupToggle(/Participants$/)).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps a group the user opened open across navigation', async () => {
    const router = createMemoryRouter([{ path: '*', element: <AppLayout /> }], { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)
    fireEvent.click(openGroupToggle(/Trips$/))
    await act(async () => { await router.navigate('/staff') })
    expect(openGroupToggle(/Trips$/)).toHaveAttribute('aria-expanded', 'true')
  })

  it('lights only the page link inside an open group: the group header is not bold too', () => {
    renderAt('/rostering/leave')
    const toggle = openGroupToggle(/Staff & roster$/)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).not.toHaveClass('font-bold')
    expect(within(mainNav()).getByRole('link', { current: 'page' })).toHaveClass('font-bold')
  })
})

describe('AppLayout — the notifications bell is in the header for every role', () => {
  afterEach(() => {
    localStorage.clear()
    mockUseInbox.mockImplementation(() => ({ data: undefined, isError: false, refetch: vi.fn() }))
  })

  it.each([
    ['Admin', '/trips'],
    ['Coordinator', '/trips'],
    ['ReadOnly', '/trips'],
    ['SupportWorker', '/portal'],
  ])('%s on %s sees it, named with the unread count', (role, path) => {
    signIn(role)
    mockUseInbox.mockImplementation(() => ({ data: { items: [], unreadCount: 3, hasMore: false }, isError: false, refetch: vi.fn() }))
    renderAt(path)
    expect(within(screen.getByRole('banner')).getByRole('button', { name: '3 unread, Notifications' })).toBeInTheDocument()
  })
})


describe('optional workspace recovery', () => {
  afterEach(() => { mockUseModuleVisibility.mockReturnValue({ data: { hiddenAccommodation: false, hiddenVehicles: false }, isError: false }); localStorage.clear() })
  it('moves hidden links into a discoverable disclosure and preserves the active deep link', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    mockUseModuleVisibility.mockReturnValue({ data: { hiddenAccommodation: true, hiddenVehicles: true }, isError: false })
    renderAt('/vehicles/v-1')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const disclosure = within(nav).getByText('Other workspaces').closest('details')!
    expect(disclosure).toHaveAttribute('open')
    expect(within(disclosure).getByRole('link', { name: /Vehicles$/ })).toHaveAttribute('href', '/vehicles')
    expect(within(disclosure).getByRole('link', { name: /Vehicles$/ })).toHaveAttribute('aria-current', 'page')
    expect(within(disclosure).getByRole('link', { name: /Accommodation$/ })).toHaveAttribute('href', '/accommodation')
    expect(within(nav).getByRole('link', { name: /Schedule$/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Tasks$/ })).toBeInTheDocument()
  })
  it('fails open on settings errors and never offers a worker forbidden recovery links', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    mockUseModuleVisibility.mockReturnValue({ data: { hiddenAccommodation: true, hiddenVehicles: true }, isError: true })
    renderAt('/portal')
    expect(screen.queryByText('Other workspaces')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Vehicles$/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Incidents$/ }).length).toBeGreaterThan(0)
  })
})

describe('AppLayout — the sidebar collapses to an icon rail (from lg)', () => {
  const PREFS_KEY = 'odip_ui_prefs:u1'
  const GROUPS_KEY = 'odip_nav_open_groups'

  /** matchMedia for the three queries the shell asks: lg (min-width), a mouse (hover: hover + pointer: fine) and reduced motion. */
  function stubMedia({ lg = true, mouse = true, reduce = false } = {}) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width') ? lg : query.includes('hover') ? mouse : query.includes('reduced-motion') ? reduce : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
  }
  function renderRail(path: string, saved?: Record<string, unknown>) {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1', role: 'Admin' }))
    if (saved) localStorage.setItem(PREFS_KEY, JSON.stringify(saved))
    return render(
      <UiPreferencesProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="*" element={<AppLayout />} />
          </Routes>
        </MemoryRouter>
      </UiPreferencesProvider>,
    )
  }
  const stored = () => JSON.parse(localStorage.getItem(PREFS_KEY)!)
  const trigger = (name: RegExp | string) => within(mainNav()).getByRole('button', { name })
  const panel = (name: string) => screen.queryByRole('group', { name })
  const tooltip = () => document.querySelector('[data-testid="rail-tooltip"]')
  const dashboard = () => within(mainNav()).getByRole('link', { name: /Dashboard$/ })

  // This jsdom has no PointerEvent, so a fired pointerenter would carry no pointerType.
  class TestPointerEvent extends MouseEvent {
    pointerType: string
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerType = init.pointerType ?? ''
    }
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('PointerEvent', TestPointerEvent)
    stubMedia()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.clear()
    Reflect.deleteProperty(window, 'matchMedia')
    mockUsePendingLeaveCount.mockReturnValue(0)
  })

  it('T1 paints the rail on the very first render when the choice was saved (no wide-then-collapse)', () => {
    renderRail('/', { sidebarCollapsed: true })
    expect(aside()).toHaveClass('lg:w-16')
    expect(dashboard()).toHaveClass('size-10')
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('T2 the toggle collapses and expands, keeps its focus, and saves beside the other preferences', () => {
    renderRail('/', { tableVerticalDividers: true, theme: 'dark', sidebarCollapsed: false })
    expect(aside()).not.toHaveClass('lg:w-16')
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(toggle).not.toHaveAttribute('aria-expanded')
    toggle.focus()
    fireEvent.click(toggle)
    expect(stored()).toEqual({ tableVerticalDividers: true, theme: 'dark', sidebarCollapsed: true })
    const same = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(same).toBe(toggle)
    expect(document.activeElement).toBe(toggle)
    expect(aside()).toHaveClass('lg:w-16')
    // The foot rows go square at once; the nav follows at 80ms (jsdom never fires transitionend, and there is no handler for it).
    expect(toggle).toHaveClass('size-10')
    expect(aside()).toHaveAttribute('data-folding')
    expect(dashboard()).not.toHaveClass('size-10')
    act(() => { vi.advanceTimersByTime(79) })
    expect(dashboard()).not.toHaveClass('size-10')
    expect(aside()).toHaveAttribute('data-folding')
    act(() => { vi.advanceTimersByTime(1) })
    expect(dashboard()).toHaveClass('size-10')
    expect(aside()).not.toHaveAttribute('data-folding')
    fireEvent.click(same)
    expect(stored().sidebarCollapsed).toBe(false)
    expect(dashboard()).not.toHaveClass('size-10')
    // The foot rows stay square until the edge has passed the wide toggle's ring (110ms).
    expect(toggle).toHaveClass('size-10')
    act(() => { vi.advanceTimersByTime(109) })
    expect(toggle).toHaveClass('size-10')
    act(() => { vi.advanceTimersByTime(1) })
    expect(toggle).not.toHaveClass('size-10')
    expect(toggle).toHaveClass('h-8')
    expect(document.activeElement).toBe(toggle)
  })

  it('T2b reduced motion switches the nav and the foot rows at once, both ways, with no folding', () => {
    stubMedia({ reduce: true })
    renderRail('/')
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
    fireEvent.click(toggle)
    expect(dashboard()).toHaveClass('size-10')
    expect(toggle).toHaveClass('size-10')
    expect(aside()).not.toHaveAttribute('data-folding')
    fireEvent.click(toggle)
    expect(dashboard()).not.toHaveClass('size-10')
    expect(toggle).not.toHaveClass('size-10')
    expect(aside()).not.toHaveAttribute('data-folding')
  })

  it('T2c a click works without WAAPI, and a second click mid-fold reverses it for good', () => {
    expect(Element.prototype.animate).toBeUndefined()
    renderRail('/', { sidebarCollapsed: false })
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
    fireEvent.click(toggle)
    expect(aside()).toHaveClass('lg:w-16')
    act(() => { vi.advanceTimersByTime(40) })
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(aside()).not.toHaveClass('lg:w-16')
    expect(aside()).not.toHaveAttribute('data-folding')
    act(() => { vi.advanceTimersByTime(200) })
    expect(dashboard()).not.toHaveClass('size-10')
    expect(toggle).not.toHaveClass('size-10')
  })

  it('T2d no folding element carries its own transition (the unlayered fold rule would override it and snap the group)', () => {
    renderRail('/', { sidebarCollapsed: false })
    fireEvent.click(trigger(/Trips$/))
    expect(trigger(/Trips$/)).toHaveAttribute('aria-expanded', 'true')
    const folds = Array.from(aside().querySelectorAll('[data-fold]'))
    expect(folds.length).toBeGreaterThan(0)
    expect(folds.filter(el => (el.getAttribute('class') ?? '').includes('transition-'))).toEqual([])
  })

  describe('the brand: the wordmark folds into its "b"', () => {
    const tile = () => aside().querySelectorAll('[data-brand-tile]')
    const marks = () => aside().querySelectorAll('[data-glide="brand-mark"]')

    it('A1 expanded: one hidden tile (off), one glide mark inside the wordmark, the name once', () => {
      renderRail('/', { sidebarCollapsed: false })
      expect(tile()).toHaveLength(1)
      expect(tile()[0]).toHaveAttribute('aria-hidden', 'true')
      expect(tile()[0]).not.toHaveAttribute('data-on')
      expect(marks()).toHaveLength(1)
      expect(marks()[0].closest('[aria-hidden="true"]')!.textContent).toBe('bunyasupport')
      expect(within(aside()).getAllByText('Bunya Support')).toHaveLength(1)
    })

    it('A2 collapsed: the tile is on, the rail "b" is 26px live text, no word, the name once', () => {
      renderRail('/', { sidebarCollapsed: true })
      expect(tile()[0]).toHaveAttribute('data-on')
      expect(marks()).toHaveLength(1)
      expect(marks()[0].textContent).toBe('b')
      expect((marks()[0] as HTMLElement).style.fontSize).toBe('26px')
      expect(marks()[0]).toHaveAttribute('aria-hidden', 'true')
      expect(within(aside()).queryByText(/support/)).toBeNull()
      expect(within(aside()).getAllByText('Bunya Support')).toHaveLength(1)
    })

    it('A3 reduced motion: the tile and the "b" switch at once, both ways', () => {
      stubMedia({ reduce: true })
      renderRail('/', { sidebarCollapsed: false })
      fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
      expect(tile()[0]).toHaveAttribute('data-on')
      expect((marks()[0] as HTMLElement).style.fontSize).toBe('26px')
      fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
      expect(tile()[0]).not.toHaveAttribute('data-on')
      expect(aside().querySelector('[data-fold="word"]')).not.toBeNull()
    })
  })

  describe('with WAAPI', () => {
    const animate = vi.fn(() => ({ cancel() {}, finished: Promise.resolve() }))
    beforeEach(() => {
      animate.mockClear()
      Object.assign(Element.prototype, { animate, getAnimations: () => [] })
    })
    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'animate')
      Reflect.deleteProperty(Element.prototype, 'getAnimations')
    })
    const collapseAndSettle = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
      act(() => { vi.advanceTimersByTime(200) })
    }

    it('T2e collapsing animates', () => {
      renderRail('/', { sidebarCollapsed: false })
      collapseAndSettle()
      expect(animate).toHaveBeenCalled()
    })

    it('A4 the "b" glides and grows between the wordmark and the rail; the tail and the tile do not use WAAPI keyframes of their own', () => {
      const calls: { el: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = []
      Object.assign(Element.prototype, {
        animate(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
          calls.push({ el: this, keyframes, options })
          return { cancel() {}, finished: Promise.resolve() }
        },
      })
      const rect = (left: number, top: number, height: number) => ({ left, top, height, width: 0, right: left, bottom: top + height, x: left, y: top, toJSON() {} })
      const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const el = this as HTMLElement
        if (el.dataset.glide !== 'brand-mark') return rect(0, 0, 40) as DOMRect
        return (el.style.fontSize === '26px' ? rect(23.3, 22, 26) : rect(22, 25.5, 21)) as DOMRect
      })
      const nums = (t: string) => (t.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
      try {
        renderRail('/', { sidebarCollapsed: false })
        fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
        act(() => { vi.advanceTimersByTime(80) })
        const glide = calls.filter(c => c.el.dataset.glide === 'brand-mark')
        expect(glide).toHaveLength(1)
        const [dx, dy, s] = nums(String(glide[0].keyframes[0].transform))
        expect(dx).toBeCloseTo(-1.3, 1)
        expect(dy).toBeCloseTo(3.5, 1)
        expect(s).toBeCloseTo(0.808, 2)
        expect(glide[0].options).toMatchObject({ id: 'sb-glide', duration: 100 })
        expect(calls.filter(c => JSON.stringify(c.keyframes).includes('scale(')).every(c => c.el.dataset.glide === 'brand-mark')).toBe(true)
        expect(calls.filter(c => c.el.hasAttribute('data-brand-tile'))).toHaveLength(0)

        calls.length = 0
        fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
        const back = calls.filter(c => c.el.dataset.glide === 'brand-mark')
        expect(nums(String(back[0].keyframes[0].transform))[2]).toBeCloseTo(1.238, 2)
        const tail = calls.filter(c => c.el.dataset.fold === 'word')
        expect(tail).toHaveLength(1)
        expect(tail[0].keyframes).toEqual([{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'none' }])
        expect(tail[0].options).toMatchObject({ duration: 100, delay: 20 })
      } finally {
        spy.mockRestore()
      }
    })

    it('T2f reduced motion animates nothing', () => {
      stubMedia({ reduce: true })
      renderRail('/', { sidebarCollapsed: false })
      collapseAndSettle()
      fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
      expect(animate).not.toHaveBeenCalled()
    })
  })

  it('T3 every rail link keeps its accessible name, and a group keeps its count in the name', () => {
    mockUsePendingLeaveCount.mockReturnValue(3)
    renderRail('/', { sidebarCollapsed: true })
    expect(dashboard()).toBeInTheDocument()
    expect(trigger(/pending, Staff & roster$/)).toBeInTheDocument()
    expect(trigger(/Trips$/)).toHaveAttribute('aria-expanded', 'false')
  })

  it('T4 a group opens a flyout: focus goes to its first link, Escape closes it and returns focus to the group', () => {
    renderRail('/', { sidebarCollapsed: true })
    const trips = trigger(/Trips$/)
    fireEvent.click(trips)
    expect(trips).toHaveAttribute('aria-expanded', 'true')
    const flyout = panel('Trips')!
    expect(flyout).toBeInTheDocument()
    expect(document.activeElement).toBe(within(flyout).getAllByRole('link')[0])
    // Not a saved open group.
    expect(localStorage.getItem(GROUPS_KEY)).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(panel('Trips')).not.toBeInTheDocument()
    expect(trips).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(trips)
  })

  it('T4b only one flyout is open at a time; an outside click closes it; the toggle closes it', () => {
    renderRail('/', { sidebarCollapsed: true })
    fireEvent.click(trigger(/Trips$/))
    fireEvent.click(trigger(/Participants$/))
    expect(panel('Trips')).not.toBeInTheDocument()
    expect(panel('Participants')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(panel('Participants')).not.toBeInTheDocument()
    fireEvent.click(trigger(/Trips$/))
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(panel('Trips')).not.toBeInTheDocument()
  })

  it('T4c choosing a page closes the flyout and leaves focus on its group; the group holding the page is marked', () => {
    renderRail('/', { sidebarCollapsed: true })
    expect(trigger(/Trips$/)).not.toHaveAttribute('aria-current')
    fireEvent.click(trigger(/Trips$/))
    fireEvent.click(within(panel('Trips')!).getAllByRole('link')[0])
    expect(panel('Trips')).not.toBeInTheDocument()
    expect(trigger(/Trips$/)).toHaveAttribute('aria-current', 'true')
    expect(document.activeElement).toBe(trigger(/Trips$/))
  })

  it('T4d Tab from the last link closes the flyout and moves on to the next rail control', () => {
    renderRail('/', { sidebarCollapsed: true })
    fireEvent.click(trigger(/Trips$/))
    const links = within(panel('Trips')!).getAllByRole('link')
    const last = links[links.length - 1]
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(panel('Trips')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger(/Participants$/))
  })

  it('T5 below lg the drawer keeps its wide rows and has no collapse button, whatever was saved', () => {
    stubMedia({ lg: false })
    renderRail('/', { sidebarCollapsed: true })
    expect(screen.queryByRole('button', { name: /(Collapse|Expand) sidebar/ })).not.toBeInTheDocument()
    expect(aside()).not.toHaveClass('lg:w-16')
    expect(dashboard()).not.toHaveClass('size-10')
  })

  it('shows a tooltip after 500ms for a mouse, never for touch, and Escape hides it', () => {
    renderRail('/', { sidebarCollapsed: true })
    fireEvent.pointerEnter(dashboard(), { pointerType: 'touch' })
    act(() => { vi.advanceTimersByTime(700) })
    expect(tooltip()).toBeNull()
    fireEvent.pointerEnter(dashboard(), { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(400) })
    expect(tooltip()).toBeNull()
    act(() => { vi.advanceTimersByTime(150) })
    expect(tooltip()).toHaveTextContent('Dashboard')
    expect(tooltip()).toHaveAttribute('aria-hidden', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(tooltip()).toBeNull()
  })

  it('a second item shows its tooltip at once while one is showing', () => {
    renderRail('/', { sidebarCollapsed: true })
    fireEvent.pointerEnter(dashboard(), { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(550) })
    fireEvent.pointerLeave(dashboard(), { pointerType: 'mouse' })
    fireEvent.pointerEnter(trigger(/Trips$/), { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(1) })
    expect(tooltip()).toHaveTextContent('Trips')
  })

  it('a wide sidebar has no tooltips', () => {
    renderRail('/')
    fireEvent.pointerEnter(dashboard(), { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(700) })
    expect(tooltip()).toBeNull()
  })

  it('shows no tooltip when its item unmounts during the 500ms delay (it would strand at the corner)', () => {
    renderRail('/', { sidebarCollapsed: true })
    const item = dashboard()
    fireEvent.pointerEnter(item, { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(300) })
    item.remove()
    act(() => { vi.advanceTimersByTime(300) })
    expect(tooltip()).toBeNull()
  })

  it('opens a flyout with its header level with the trigger icon (trigger top + 2px)', () => {
    renderRail('/', { sidebarCollapsed: true })
    const group = trigger(/Trips$/)
    group.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 12, right: 52, width: 40, height: 40, x: 12, y: 100, toJSON: () => ({}) })
    fireEvent.click(group)
    expect(panel('Trips')!.style.top).toBe('102px')
  })

  it('the wide Sign out icon sits in an 18px slot so its label lines up with the nav labels; the rail one does not', () => {
    const { unmount } = renderRail('/')
    const icon = () => within(aside()).getByRole('button', { name: /Sign out$/ }).querySelector('svg')!
    expect(icon().parentElement).toHaveClass('w-[18px]')
    unmount()
    renderRail('/', { sidebarCollapsed: true })
    expect(icon().parentElement).not.toHaveClass('w-[18px]')
  })

  it('the width and margin transitions are off under reduced motion', () => {
    renderRail('/')
    expect(aside().className).toContain('motion-reduce:lg:transition-none')
    expect(document.getElementById('main')!.parentElement!.className).toContain('motion-reduce:lg:transition-none')
  })
})
