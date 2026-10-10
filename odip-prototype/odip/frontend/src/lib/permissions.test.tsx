import { Suspense } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HomeRoute, PrivateRoute } from '../App'
import { usePermissions, type PageKey, type UserRole } from './permissions'

/** usePermissions reads localStorage synchronously and calls no React hooks itself, but it's
 * still named/typed as a hook — exercising it through a real component keeps the test honest
 * about how callers actually use it. */
function PermissionsProbe({ pages }: { pages: PageKey[] }) {
  const { canAccessPage } = usePermissions()
  return (
    <ul>
      {pages.map(page => (
        <li key={page} data-testid={`page-${page}`}>{String(canAccessPage(page))}</li>
      ))}
    </ul>
  )
}

function CapabilityProbe() {
  const { canRequestLeave, canApproveLeave, canCompleteOwnShifts, canReviewCompletions, canManageNotifications, canManageParticipantLifecycle, canManageFunding, canWrite } = usePermissions()
  return (
    <ul>
      <li data-testid="can-request-leave">{String(canRequestLeave)}</li>
      <li data-testid="can-approve-leave">{String(canApproveLeave)}</li>
      <li data-testid="can-complete-own-shifts">{String(canCompleteOwnShifts)}</li>
      <li data-testid="can-review-completions">{String(canReviewCompletions)}</li>
      <li data-testid="can-manage-notifications">{String(canManageNotifications)}</li>
      <li data-testid="can-manage-participant-lifecycle">{String(canManageParticipantLifecycle)}</li>
      <li data-testid="can-manage-funding">{String(canManageFunding)}</li>
      <li data-testid="can-write">{String(canWrite)}</li>
    </ul>
  )
}

function setUserRole(role: UserRole) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

// HomeRoute renders the Dashboard (lazy-loaded by App.tsx) for everyone but a SupportWorker: a stub keeps this suite off its queries.
vi.mock('../pages/DashboardPage', () => ({ default: () => <div>Dashboard page</div> }))

describe('usePermissions.canAccessPage', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('excludes rostering from the SupportWorker allowlist', () => {
    setUserRole('SupportWorker')
    render(<PermissionsProbe pages={['rostering']} />)
    expect(screen.getByTestId('page-rostering')).toHaveTextContent('false')
  })

  it('still allows a SupportWorker onto the pages that are on their allowlist', () => {
    setUserRole('SupportWorker')
    render(<PermissionsProbe pages={['dashboard', 'trips', 'schedule', 'participants', 'tasks', 'incidents']} />)
    for (const page of ['dashboard', 'trips', 'schedule', 'participants', 'tasks', 'incidents']) {
      expect(screen.getByTestId(`page-${page}`)).toHaveTextContent('true')
    }
  })

  it('allows a non-SupportWorker role onto rostering', () => {
    setUserRole('Coordinator')
    render(<PermissionsProbe pages={['rostering']} />)
    expect(screen.getByTestId('page-rostering')).toHaveTextContent('true')
  })

  it('allows rostering when there is no logged-in user at all', () => {
    render(<PermissionsProbe pages={['rostering']} />)
    expect(screen.getByTestId('page-rostering')).toHaveTextContent('true')
  })
})

describe('usePermissions leave capabilities', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('canRequestLeave is true for every role except ReadOnly', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator', 'SupportWorker'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-request-leave')).toHaveTextContent('true')
      unmount()
    }
  })

  it('canRequestLeave is false for ReadOnly', () => {
    setUserRole('ReadOnly')
    render(<CapabilityProbe />)
    expect(screen.getByTestId('can-request-leave')).toHaveTextContent('false')
  })

  it('canApproveLeave is true only for Admin, Coordinator and SuperAdmin', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-approve-leave')).toHaveTextContent('true')
      unmount()
    }
    for (const role of ['SupportWorker', 'ReadOnly'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-approve-leave')).toHaveTextContent('false')
      unmount()
    }
  })
})

describe('usePermissions shift-completion capabilities', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('canCompleteOwnShifts is true for every role except ReadOnly', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator', 'SupportWorker'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-complete-own-shifts')).toHaveTextContent('true')
      unmount()
    }
  })

  it('canCompleteOwnShifts is false for ReadOnly', () => {
    setUserRole('ReadOnly')
    render(<CapabilityProbe />)
    expect(screen.getByTestId('can-complete-own-shifts')).toHaveTextContent('false')
  })

  it('canReviewCompletions is true only for Admin, Coordinator and SuperAdmin', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-review-completions')).toHaveTextContent('true')
      unmount()
    }
    for (const role of ['SupportWorker', 'ReadOnly'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-review-completions')).toHaveTextContent('false')
      unmount()
    }
  })
})

describe('usePermissions.canManageNotifications', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('is true only for Admin and SuperAdmin', () => {
    for (const role of ['SuperAdmin', 'Admin'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-manage-notifications')).toHaveTextContent('true')
      unmount()
    }
    for (const role of ['Coordinator', 'SupportWorker', 'ReadOnly'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-manage-notifications')).toHaveTextContent('false')
      unmount()
    }
  })
})

describe('usePermissions.canManageFunding', () => {
  afterEach(() => {
    localStorage.clear()
  })

  // A participant's plan budget is money, and money is never visible to SupportWorker or ReadOnly: ParticipantFundingController admits SuperAdmin, Admin and Coordinator for every request,
  // reads included. canWrite is NOT that gate (ReadOnly historically satisfied it), which is why the Funding tab has a boolean of its own.
  it('is true for SuperAdmin, Admin and Coordinator only', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-manage-funding')).toHaveTextContent('true')
      unmount()
    }
    for (const role of ['SupportWorker', 'ReadOnly'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-manage-funding')).toHaveTextContent('false')
      unmount()
    }
  })

  it('is not canWrite: ReadOnly satisfies canWrite and must still never see a budget', () => {
    setUserRole('ReadOnly')
    render(<CapabilityProbe />)

    expect(screen.getByTestId('can-write')).toHaveTextContent('true')
    expect(screen.getByTestId('can-manage-funding')).toHaveTextContent('false')
  })
})

describe('usePermissions.canAccessPage — leave pages', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('includes portal-leave in the SupportWorker allowlist', () => {
    setUserRole('SupportWorker')
    render(<PermissionsProbe pages={['portal-leave']} />)
    expect(screen.getByTestId('page-portal-leave')).toHaveTextContent('true')
  })

  it('excludes leave-approvals from the SupportWorker allowlist', () => {
    setUserRole('SupportWorker')
    render(<PermissionsProbe pages={['leave-approvals']} />)
    expect(screen.getByTestId('page-leave-approvals')).toHaveTextContent('false')
  })

  it('allows a non-SupportWorker role onto leave-approvals', () => {
    setUserRole('Coordinator')
    render(<PermissionsProbe pages={['leave-approvals']} />)
    expect(screen.getByTestId('page-leave-approvals')).toHaveTextContent('true')
  })
})


describe('usePermissions.canManageParticipantLifecycle', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('mirrors ParticipantInquiriesController mutation roles', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-manage-participant-lifecycle')).toHaveTextContent('true')
      unmount()
    }
    for (const role of ['ReadOnly', 'SupportWorker'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<CapabilityProbe />)
      expect(screen.getByTestId('can-manage-participant-lifecycle')).toHaveTextContent('false')
      unmount()
    }
  })
})


function renderLifecycleRoute(role: UserRole) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
  localStorage.setItem('odip_token', 'test-token')
  return render(
    <MemoryRouter initialEntries={['/participants/new']}>
      <Routes>
        <Route path="/" element={<div>Redirected</div>} />
        <Route path="/participants/new" element={
          <PrivateRoute page="participants" requiresParticipantLifecycleMutation>
            <div>Draft intake route</div>
          </PrivateRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PrivateRoute participant lifecycle admission', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('admits Admin, Coordinator, and SuperAdmin to Draft intake', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator'] as UserRole[]) {
      const { unmount } = renderLifecycleRoute(role)
      expect(screen.getByText('Draft intake route')).toBeInTheDocument()
      unmount()
      localStorage.clear()
    }
  })

  it('redirects ReadOnly and SupportWorker away from Draft intake', () => {
    for (const role of ['ReadOnly', 'SupportWorker'] as UserRole[]) {
      const { unmount } = renderLifecycleRoute(role)
      expect(screen.getByText('Redirected')).toBeInTheDocument()
      unmount()
      localStorage.clear()
    }
  })
})


describe('usePermissions.canAccessPage — ReadOnly', () => {
  afterEach(() => {
    localStorage.clear()
  })

  // Each of these sits behind a controller that admits only SuperAdmin, Admin and Coordinator, reads included: see READ_ONLY_REFUSED_PAGES.
  const REFUSED: PageKey[] = ['rostering', 'leave-approvals', 'claims', 'settings', 'caregiver-submissions', 'agreement-drafts', 'budgets']
  const ALLOWED: PageKey[] = [
    'dashboard', 'portal', 'portal-leave', 'trips', 'schedule', 'participants', 'accommodation', 'vehicles', 'staff', 'tasks', 'incidents', 'bookings',
    'qualifications', 'medications',
  ]

  it('refuses ReadOnly the pages its API refuses (rostering, leave, claims, caregiver forms, settings, agreement drafts, the Budgets list)', () => {
    setUserRole('ReadOnly')
    render(<PermissionsProbe pages={REFUSED} />)
    for (const page of REFUSED) expect(screen.getByTestId(`page-${page}`), page).toHaveTextContent('false')
  })

  it('still lets ReadOnly read everything else the app shows it', () => {
    setUserRole('ReadOnly')
    render(<PermissionsProbe pages={ALLOWED} />)
    for (const page of ALLOWED) expect(screen.getByTestId(`page-${page}`), page).toHaveTextContent('true')
  })

  it('leaves the management roles, and no user at all, with every page including the ones ReadOnly loses', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator'] as UserRole[]) {
      setUserRole(role)
      const { unmount } = render(<PermissionsProbe pages={[...REFUSED, ...ALLOWED]} />)
      for (const page of [...REFUSED, ...ALLOWED]) expect(screen.getByTestId(`page-${page}`), `${role} ${page}`).toHaveTextContent('true')
      unmount()
    }
    localStorage.clear()
    render(<PermissionsProbe pages={REFUSED} />)
    for (const page of REFUSED) expect(screen.getByTestId(`page-${page}`), `no user ${page}`).toHaveTextContent('true')
  })

  // Round 1b (review F18, decided): a service agreement draft carries money, and money is never visible to SupportWorker or ReadOnly: the API refuses them every GET of it.
  it("keeps the agreement drafts off a SupportWorker's pages too: their allow-list does not name them, as it does not name the other pages that carry money", () => {
    setUserRole('SupportWorker')
    render(<PermissionsProbe pages={['agreement-drafts', 'claims', 'participants']} />)
    expect(screen.getByTestId('page-agreement-drafts')).toHaveTextContent('false')
    expect(screen.getByTestId('page-claims')).toHaveTextContent('false')
    expect(screen.getByTestId('page-participants')).toHaveTextContent('true')
  })

  // Budget phase 2b: the Budgets list is every participant's money, behind a controller that admits only SuperAdmin, Admin and Coordinator (canManageFunding is its rule), so neither SupportWorker nor ReadOnly is offered it.
  it('keeps the Budgets list off a SupportWorker (it is not on their allow-list) and a ReadOnly viewer, and offers it to the three management roles', () => {
    setUserRole('SupportWorker')
    const { unmount } = render(<PermissionsProbe pages={['budgets', 'participants']} />)
    expect(screen.getByTestId('page-budgets')).toHaveTextContent('false')
    expect(screen.getByTestId('page-participants')).toHaveTextContent('true')
    unmount()
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator'] as UserRole[]) {
      setUserRole(role)
      const view = render(<PermissionsProbe pages={['budgets']} />)
      expect(screen.getByTestId('page-budgets'), role).toHaveTextContent('true')
      view.unmount()
    }
  })

  it("keeps Caregiver forms off a SupportWorker's pages too, as it was (their allow-list does not name it)", () => {
    setUserRole('SupportWorker')
    render(<PermissionsProbe pages={['caregiver-submissions', 'participants']} />)
    expect(screen.getByTestId('page-caregiver-submissions')).toHaveTextContent('false')
    expect(screen.getByTestId('page-participants')).toHaveTextContent('true')
  })
})

function renderGuarded(role: UserRole, path: string, route: { page: PageKey; requiresWrite?: boolean }) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
  localStorage.setItem('odip_token', 'test-token')
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>Redirected</div>} />
        <Route path={path} element={<PrivateRoute page={route.page} requiresWrite={route.requiresWrite}><div>The page</div></PrivateRoute>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PrivateRoute — pages ReadOnly is refused', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it.each<[string, PageKey, boolean]>([
    ['/rostering', 'rostering', false],
    ['/rostering/leave', 'leave-approvals', false],
    ['/claims/c-1', 'claims', false],
    ['/settings', 'settings', false],
    ['/caregiver-submissions', 'caregiver-submissions', true],
    ['/participants/p-1/agreement-draft', 'agreement-drafts', false],
    ['/budgets', 'budgets', false],
  ])('sends ReadOnly away from %s, and still admits a Coordinator', (path, page, requiresWrite) => {
    const { unmount } = renderGuarded('ReadOnly', path, { page, requiresWrite })
    expect(screen.getByText('Redirected')).toBeInTheDocument()
    unmount()
    renderGuarded('Coordinator', path, { page, requiresWrite })
    expect(screen.getByText('The page')).toBeInTheDocument()
  })

  // The route used to be page="participants" with requiresWrite, and ReadOnly satisfies canWrite: it opened the draft page, which now meets a 403 on the list.
  it('admits SuperAdmin, Admin and Coordinator to the agreement draft and sends ReadOnly and SupportWorker away from it', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator'] as UserRole[]) {
      const { unmount } = renderGuarded(role, '/participants/p-1/agreement-draft', { page: 'agreement-drafts' })
      expect(screen.getByText('The page'), role).toBeInTheDocument()
      unmount()
      localStorage.clear()
    }
    for (const role of ['ReadOnly', 'SupportWorker'] as UserRole[]) {
      const { unmount } = renderGuarded(role, '/participants/p-1/agreement-draft', { page: 'agreement-drafts' })
      expect(screen.getByText('Redirected'), role).toBeInTheDocument()
      unmount()
      localStorage.clear()
    }
  })
})

describe('HomeRoute', () => {
  afterEach(() => {
    localStorage.clear()
  })

  function renderHome() {
    localStorage.setItem('odip_token', 'test-token')
    return render(
      <MemoryRouter initialEntries={['/']}>
        <Suspense fallback={<div>Loading</div>}>
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/portal" element={<div>My Shifts page</div>} />
          </Routes>
        </Suspense>
      </MemoryRouter>,
    )
  }

  it('sends a SupportWorker from / to My Shifts, replacing the entry so Back does not bounce them again', () => {
    setUserRole('SupportWorker')
    renderHome()
    expect(screen.getByText('My Shifts page')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument()
  })

  it.each(['SuperAdmin', 'Admin', 'Coordinator', 'ReadOnly'] as UserRole[])("keeps the Dashboard as %s's home", async role => {
    setUserRole(role)
    renderHome()
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()
    expect(screen.queryByText('My Shifts page')).not.toBeInTheDocument()
  })

  it('still sends someone with no token to the login route (the shell guard is the first hop; PrivateRoute is the second)', () => {
    setUserRole('Coordinator')
    localStorage.removeItem('odip_token')
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })
})
