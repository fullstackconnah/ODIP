import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UsersTab from './UsersTab'

const { mockUseAdminUsers } = vi.hoisted(() => ({ mockUseAdminUsers: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useAdminUsers: mockUseAdminUsers,
  useAdminTenantsSummary: () => ({ data: [] }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
}))

const user = (i: number, lastLoginAt: string | null) => ({
  id: `u${i}`, firstName: 'User', lastName: `Number${i}`, fullName: `User Number${i}`, email: `u${i}@example.com.au`, username: `u${i}`,
  role: 'Coordinator', tenantId: 't1', tenantName: 'Sample Support Co', isActive: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt,
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('UsersTab: Last Login', () => {
  // formatRelative (compact) for the first month, then the date itself.
  it('reads never, just now, minutes, hours and days, and the date once the login is a month old', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    const monthOld = '2026-08-17T12:00:00Z'
    mockUseAdminUsers.mockReturnValue({
      data: { items: [
        user(0, null), user(1, '2026-09-30T11:59:40Z'), user(2, '2026-09-30T11:54:20Z'), user(3, '2026-09-30T10:30:00Z'),
        user(4, '2026-09-27T12:00:00Z'), user(5, '2026-09-16T12:00:00Z'), user(6, monthOld),
      ], totalCount: 7, page: 1, pageSize: 20, totalPages: 1, hasNext: false, hasPrevious: false },
      isLoading: false,
    })
    render(<UsersTab onAddUser={vi.fn()} onEditUser={vi.fn()} />)

    for (const text of ['Never', 'Just now', '5m ago', '1h ago', '3d ago', '14d ago', new Date(monthOld).toLocaleDateString()]) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })
})
