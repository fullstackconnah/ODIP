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
