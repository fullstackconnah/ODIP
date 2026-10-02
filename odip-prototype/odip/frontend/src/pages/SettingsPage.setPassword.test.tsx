import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import SettingsPage from './SettingsPage'

// The seam between the Users tab and the user panel: a create keeps its panel open to say what became of the set-password email, and a row
// action has no panel at all, so the tab says it in its notices above the table. The tab and the panel have their own tests; this one proves
// they are wired together inside the page.

const { mockCreate, mockEnsure, sendPasswordResetEmail, settingsData, usersPage } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockEnsure: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  // A stable reference, like a cached query's data: QualificationSettingsTab re-syncs from it on every new identity.
  settingsData: { qualificationWarningDays: 30 },
  usersPage: {
    data: {
      items: [{
        id: 'user-1', firstName: 'Ann', lastName: 'One', fullName: 'Ann One', email: 'ann@example.com', username: 'ann', role: 'Coordinator',
        tenantId: 'tenant-1', tenantName: 'Sample Support Co', isActive: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null,
      }],
      totalCount: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false, hasPrevious: false,
    },
    isLoading: false,
  },
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
  useAdminUsers: () => usersPage,
  useCreateAdminUser: () => ({ mutateAsync: mockCreate, isPending: false }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: mockEnsure }),
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
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ isSuperAdmin: true, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false }),
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({ auth: { name: 'auth-stub' } }))

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({
    id: 'new-1', fullName: 'New Person', email: 'new.person@example.com', firebaseAccount: 'created',
  })
  mockEnsure.mockReset().mockResolvedValue({ firebaseAccount: 'created' })
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
})

async function openUsersTab() {
  const u = userEvent.setup()
  const router = createMemoryRouter([{ path: '/settings', element: <SettingsPage /> }], { initialEntries: ['/settings'] })
  render(<RouterProvider router={router} />)
  await u.click(screen.getByRole('tab', { name: 'Users' }))
  return u
}

describe('SettingsPage Users tab: creating a user', () => {
  it('stays open to say the set-password email went, and Done closes the panel', async () => {
    const u = await openUsersTab()

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
      await screen.findByText("We've sent new.person@example.com a link to set their password. It can take a few minutes, so ask them to check spam."),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'User created' })).toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledWith({
      tenantId: 'tenant-1', firstName: 'New', lastName: 'Person', email: 'new.person@example.com', username: 'newperson', role: 'Coordinator',
      password: undefined,
    })
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({ name: 'auth-stub' }, 'new.person@example.com')

    await u.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('SettingsPage Users tab: Send set-password email', () => {
  it('says, in the notices above the table, that the email went', async () => {
    const u = await openUsersTab()

    await u.click(screen.getByRole('button', { name: 'Send set-password email to Ann One' }))

    expect(
      await screen.findByText("We've sent ann@example.com a link to set their password. It can take a few minutes, so ask them to check spam."),
    ).toBeInTheDocument()
    expect(mockEnsure).toHaveBeenCalledWith('user-1')
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({ name: 'auth-stub' }, 'ann@example.com')
  })

  it('says, in the notices above the table, that it could not be sent', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('auth/network-request-failed'))
    const u = await openUsersTab()

    await u.click(screen.getByRole('button', { name: 'Send set-password email to Ann One' }))

    expect(await within(screen.getByRole('status')).findByText(
      'No link was sent to ann@example.com. To try again, use Send set-password email on their row.',
    )).toBeInTheDocument()
  })
})

describe('SettingsPage Users tab: the notices survive leaving the tab', () => {
  const SENT = "We've sent ann@example.com a link to set their password. It can take a few minutes, so ask them to check spam."
  const NOT_SENT = 'No link was sent to ann@example.com. To try again, use Send set-password email on their row.'

  it('keeps an unacknowledged failure through a visit to another tab', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('auth/network-request-failed'))
    const u = await openUsersTab()
    await u.click(screen.getByRole('button', { name: 'Send set-password email to Ann One' }))
    await within(screen.getByRole('status')).findByText(NOT_SENT)

    await u.click(screen.getByRole('tab', { name: 'Appearance' }))
    expect(screen.queryByText(NOT_SENT)).not.toBeInTheDocument()
    await u.click(screen.getByRole('tab', { name: 'Users' }))

    expect(await within(screen.getByRole('status')).findByText(NOT_SENT)).toBeInTheDocument()
  })

  it('reports a send that finishes after the tab was left, instead of saying it to nobody', async () => {
    let finishSend!: () => void
    sendPasswordResetEmail.mockReturnValue(new Promise<void>(resolve => { finishSend = resolve }))
    const u = await openUsersTab()
    await u.click(screen.getByRole('button', { name: 'Send set-password email to Ann One' }))
    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1))

    await u.click(screen.getByRole('tab', { name: 'Appearance' }))
    finishSend()
    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1))
    await u.click(screen.getByRole('tab', { name: 'Users' }))

    expect(await within(screen.getByRole('status')).findByText(SENT)).toBeInTheDocument()
  })

  it('lets a dismissed notice stay dismissed after the same round trip', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('auth/network-request-failed'))
    const u = await openUsersTab()
    await u.click(screen.getByRole('button', { name: 'Send set-password email to Ann One' }))
    await u.click(await within(screen.getByRole('status')).findByRole('button', { name: 'Dismiss notice about Ann One' }))

    await u.click(screen.getByRole('tab', { name: 'Appearance' }))
    await u.click(screen.getByRole('tab', { name: 'Users' }))

    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})
