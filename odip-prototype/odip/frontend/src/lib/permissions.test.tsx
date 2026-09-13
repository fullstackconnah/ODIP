import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  const { canRequestLeave, canApproveLeave, canCompleteOwnShifts, canReviewCompletions } = usePermissions()
  return (
    <ul>
      <li data-testid="can-request-leave">{String(canRequestLeave)}</li>
      <li data-testid="can-approve-leave">{String(canApproveLeave)}</li>
      <li data-testid="can-complete-own-shifts">{String(canCompleteOwnShifts)}</li>
      <li data-testid="can-review-completions">{String(canReviewCompletions)}</li>
    </ul>
  )
}

function setUserRole(role: UserRole) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

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
