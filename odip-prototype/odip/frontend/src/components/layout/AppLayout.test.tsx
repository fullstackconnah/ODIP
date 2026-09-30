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

  it('does not use the ::before pad on the bottom-nav links: a floor cannot overlap its neighbours in the justify-around row', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    for (const link of within(nav).getAllByRole('link')) expect(link.className).not.toContain('before:')
  })

  it('keeps the active colour on the padded links', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderAt('/trips')
    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(within(nav).getByRole('link', { name: /Trips$/ })).toHaveClass('text-[var(--color-primary)]')
    expect(within(nav).getByRole('link', { name: /Settings$/ })).toHaveClass('text-[var(--color-secondary)]')
  })
})
