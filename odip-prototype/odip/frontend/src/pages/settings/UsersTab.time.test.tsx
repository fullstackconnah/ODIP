import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UsersTab from './UsersTab'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseAdminUsers, mockZone } = vi.hoisted(() => ({ mockUseAdminUsers: vi.fn(), mockZone: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useAdminUsers: mockUseAdminUsers,
  useProviderZone: () => mockZone(),
  useAdminTenantsSummary: () => ({ data: [] }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
  useRecordInvitesSent: () => ({ mutate: vi.fn() }),
}))

beforeEach(() => { mockZone.mockReturnValue(undefined) })
afterEach(() => {
  vi.useRealTimers()
  restoreZone()
  vi.clearAllMocks()
})

const user = (lastLoginAt: string | null) => ({
  id: 'u1', firstName: 'User', lastName: 'One', fullName: 'User One', email: 'u1@example.com.au', username: 'u1',
  role: 'Coordinator', tenantId: 't1', tenantName: 'Sample Support Co', isActive: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt,
})

// L4-02. "Last login" is a UTC instant (AuthController stamps DateTime.UtcNow). Ten minutes after a login at 15:00 Sydney the column must
// read "10m ago" in every browser zone, whether the API sends the Z (now) or sent it zone-less (before).
describe.each(['Australia/Sydney', 'UTC'])('UsersTab Last login in %s', zone => {
  it.each([
    ['with Z', '2026-10-03T05:00:00.1234567Z'],
    ['zone-less (the old wire shape)', '2026-10-03T05:00:00.1234567'],
  ])('reads a login %s as 10m ago', (_label, lastLoginAt) => {
    if (!setZone(zone)) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T05:10:30Z'))
    mockUseAdminUsers.mockReturnValue({
      data: { items: [user(lastLoginAt)], totalCount: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false, hasPrevious: false },
      isLoading: false,
    })

    render(<UsersTab onAddUser={vi.fn()} onEditUser={vi.fn()} />)

    expect(screen.getByText('10m ago')).toBeInTheDocument()
  })
})

// Standard 8: a login a month old or more prints its date in en-AU, not in whatever locale the browser (or the CI container) defaults to.
describe('UsersTab Last login a month back', () => {
  it('prints the day as dd/mm/yyyy', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T05:10:30Z'))
    mockUseAdminUsers.mockReturnValue({
      data: { items: [user('2026-08-03T05:00:00Z')], totalCount: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false, hasPrevious: false },
      isLoading: false,
    })
    render(<UsersTab onAddUser={vi.fn()} onEditUser={vi.fn()} />)
    expect(screen.getByText('03/08/2026')).toBeInTheDocument()
  })
})

// OD-ZONE2 (H110-4). The date a month-old login prints is the provider's zone, not the device's: 40 days back at 15:30 UTC is 01:30 next day in Sydney, still the same day in Perth.
describe('UsersTab Last login a month back in the provider zone', () => {
  it('prints the day in the provider zone under another device zone', () => {
    if (!setZone('Australia/Sydney')) return
    mockZone.mockReturnValue('Australia/Perth')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T05:10:30Z'))
    mockUseAdminUsers.mockReturnValue({
      data: { items: [user('2026-08-24T15:30:00Z')], totalCount: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false, hasPrevious: false },
      isLoading: false,
    })
    render(<UsersTab onAddUser={vi.fn()} onEditUser={vi.fn()} />)
    expect(screen.getByText('24/08/2026')).toBeInTheDocument() // Sydney would say 25/08/2026
  })
})
