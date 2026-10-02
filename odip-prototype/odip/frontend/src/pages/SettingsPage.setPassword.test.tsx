import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import SettingsPage from './SettingsPage'

// The seam between the Users tab, the user panel and the message that outlives the panel: a create closes the panel, so what became of
// the set-password email has to be said by the page. The panel and the toast have their own tests; this one proves they are wired together.

const { mockCreate, sendPasswordResetEmail, settingsData } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  // A stable reference, like a cached query's data: QualificationSettingsTab re-syncs from it on every new identity.
  settingsData: { qualificationWarningDays: 30 },
}))

// The same hooks the other SettingsPage tests stub, plus the ones the Users tab and the user panel call.
vi.mock('@/api/hooks', () => ({
  useEventTemplates: () => ({ data: [] }),
  useActivities: () => ({ data: [] }),
  useSettings: () => ({ data: settingsData }),
  useUpdateSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useProviderSettings: () => ({ data: {} }),
  useUpsertProviderSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useSupportCatalogue: () => ({ data: [] }),
  usePublicHolidays: () => ({ data: [] }),
  useCreatePublicHoliday: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePublicHoliday: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncHolidays: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEventTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEventTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateEventTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useTrips: () => ({ data: [] }),
  useAdminTenantsSummary: () => ({ data: [{ id: 'tenant-1', name: 'Sample Support Co' }] }),
  useAdminUsers: () => ({ data: { items: [], totalCount: 0, hasNext: false, hasPrevious: false }, isLoading: false }),
  useCreateAdminUser: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateAdminUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useNotificationPreferences: () => ({ data: { rows: [] }, isLoading: false, isError: false }),
  useUpdateNotificationPreferences: () => ({ mutate: vi.fn(), isPending: false }),
  useAdminNotifications: () => ({ data: [], isLoading: false, isError: false }),
  useRetryNotification: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSendTestEmail: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/api/hooks/admin', () => ({
  useCreateTenantWithSetup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ isSuperAdmin: true, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false }),
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({ auth: { name: 'auth-stub' } }))

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue(undefined)
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
})

describe('SettingsPage Users tab: creating a user', () => {
  it('closes the panel and then says, over the page, that the set-password email went', async () => {
    const u = userEvent.setup()
    const router = createMemoryRouter([{ path: '/settings', element: <SettingsPage /> }], { initialEntries: ['/settings'] })
    render(<RouterProvider router={router} />)

    await u.click(screen.getByRole('tab', { name: 'Users' }))
    await u.click(screen.getByRole('button', { name: '+ Add User' }))
    await u.click(screen.getByRole('button', { name: 'Tenant *' }))
    await u.click(await screen.findByRole('option', { name: 'Sample Support Co' }))
    await u.type(screen.getByLabelText(/first name/i), 'New')
    await u.type(screen.getByLabelText(/last name/i), 'Person')
    await u.type(screen.getByLabelText(/^email/i), 'new.person@example.com')
    await u.type(screen.getByLabelText(/username/i), 'newperson')
    await u.click(screen.getByRole('button', { name: 'Role *' }))
    await u.click(await screen.findByRole('option', { name: 'Coordinator' }))
    await u.click(screen.getByRole('button', { name: 'Create User' }))

    expect(
      await screen.findByText("User created. We've emailed new.person@example.com a link to set their password (check spam if it doesn't arrive)."),
    ).toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledWith({
      tenantId: 'tenant-1', firstName: 'New', lastName: 'Person', email: 'new.person@example.com', username: 'newperson', role: 'Coordinator',
      password: undefined,
    })
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({ name: 'auth-stub' }, 'new.person@example.com')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New User' })).not.toBeInTheDocument())
  })
})
