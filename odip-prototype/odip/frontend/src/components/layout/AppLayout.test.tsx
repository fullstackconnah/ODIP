import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AppLayout from './AppLayout'

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
