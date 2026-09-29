import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import SettingsPage from './SettingsPage'

const { mockUsePermissions, settingsData } = vi.hoisted(() => ({
  mockUsePermissions: vi.fn(),
  // A stable object reference, matching what TanStack Query actually hands a real useSettings()
  // call across re-renders (same cached `data` identity until it's refetched) — an inline object
  // literal in the mock factory would give QualificationSettingsTab's
  // `useEffect(() => {...}, [settings])` a new reference every render and re-sync warningDays
  // away from the user's edit on every keystroke.
  settingsData: { qualificationWarningDays: 30 },
}))

// SettingsPage's Qualification Warnings and Provider Settings tabs now call
// useUnsavedChangesWarning (PP-77), which uses react-router 7's useBlocker — that throws under
// a plain declarative <MemoryRouter>/<Routes>, so this needs a data router (same pattern
// StaffCreatePage.test.tsx documents).
function renderSettingsPage() {
  const router = createMemoryRouter(
    [
      { path: '/settings', element: <SettingsPage /> },
      { path: '/elsewhere', element: <div>Elsewhere page</div> },
    ],
    { initialEntries: ['/settings'] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

vi.mock('@/api/hooks', () => ({
  useEventTemplates: () => ({ data: [] }),
  useActivities: () => ({ data: [] }),
  useSettings: () => ({ data: settingsData }),
  useUpdateSettings: () => ({ mutate: vi.fn((_vars, opts) => opts?.onSuccess?.()), isPending: false }),
  useProviderSettings: () => ({ data: {} }),
  useUpsertProviderSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useSupportCatalogue: () => ({ data: [] }),
  usePublicHolidays: () => ({ data: [] }),
  useCreatePublicHoliday: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePublicHoliday: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncHolidays: () => ({ mutate: vi.fn(), isPending: false }),
  // TemplateFormPanel (mounted unconditionally on the default 'templates' tab) and
  // UserFormPanel (mounted unconditionally at the bottom of SettingsPage) pull these in too.
  useCreateEventTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEventTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateEventTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useTrips: () => ({ data: [] }),
  useAdminTenantsSummary: () => ({ data: [] }),
  useCreateAdminUser: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAdminUser: () => ({ mutate: vi.fn(), isPending: false }),
  // NotificationPreferencesTab (mounted whenever the Notifications tab is selected) and
  // AdminNotificationsTab (Failed Sends, canManageNotifications-gated).
  useNotificationPreferences: () => ({ data: { rows: [] }, isLoading: false, isError: false }),
  useUpdateNotificationPreferences: () => ({ mutate: vi.fn(), isPending: false }),
  useAdminNotifications: () => ({ data: [], isLoading: false, isError: false }),
  useRetryNotification: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSendTestEmail: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

// TenantFormPanel (also mounted unconditionally) imports its mutations from this sibling
// module path directly rather than the '@/api/hooks' barrel above.
vi.mock('@/api/hooks/admin', () => ({
  useCreateTenantWithSetup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: mockUsePermissions,
}))

beforeEach(() => {
  mockUsePermissions.mockReturnValue({ isSuperAdmin: false, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false })
})

describe('SettingsPage — unsaved-changes warning (PP-77)', () => {
  it('warns before navigating away from an edited Qualification Warning window', async () => {
    const user = userEvent.setup()
    const { router } = renderSettingsPage()

    await user.click(screen.getByRole('tab', { name: /qualification warnings/i }))
    await user.click(screen.getByRole('button', { name: /30 days/i }))
    await user.click(await screen.findByRole('option', { name: /60 days/i }))

    await act(async () => { router.navigate('/elsewhere') })

    expect(await screen.findByText(/leave without saving\?/i)).toBeInTheDocument()
  })

  it('does not warn when the Qualification Warning window is untouched', async () => {
    const user = userEvent.setup()
    const { router } = renderSettingsPage()

    await user.click(screen.getByRole('tab', { name: /qualification warnings/i }))
    await act(async () => { router.navigate('/elsewhere') })

    expect(await screen.findByText(/elsewhere page/i)).toBeInTheDocument()
    expect(screen.queryByText(/leave without saving\?/i)).not.toBeInTheDocument()
  })

  it('warns before navigating away from an edited Provider Settings form', async () => {
    const user = userEvent.setup()
    const { router } = renderSettingsPage()

    await user.click(screen.getByRole('tab', { name: /provider settings/i }))
    // ProviderSettingsTab's labels aren't associated via htmlFor/id, so select the input
    // relative to its label text instead of by accessible label.
    const abnInput = screen.getByText('ABN').nextElementSibling as HTMLInputElement
    await user.type(abnInput, '12345678901')

    await act(async () => { router.navigate('/elsewhere') })

    expect(await screen.findByText(/leave without saving\?/i)).toBeInTheDocument()
  })
})

describe('SettingsPage — Notifications tabs', () => {
  it('shows the Notifications tab to every signed-in user, and hides Failed Sends without canManageNotifications', () => {
    mockUsePermissions.mockReturnValue({ isSuperAdmin: false, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false })
    renderSettingsPage()

    expect(screen.getByRole('tab', { name: /^notifications$/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /failed sends/i })).not.toBeInTheDocument()
  })

  it('shows the Failed Sends tab when canManageNotifications is true', async () => {
    mockUsePermissions.mockReturnValue({ isSuperAdmin: false, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: true })
    const user = userEvent.setup()
    renderSettingsPage()

    const failedSendsTab = screen.getByRole('tab', { name: /failed sends/i })
    expect(failedSendsTab).toBeInTheDocument()

    await user.click(failedSendsTab)
    expect(screen.getByText(/notification outbox/i)).toBeInTheDocument()
  })

  it('renders the notification preference grid on the Notifications tab', async () => {
    const user = userEvent.setup()
    renderSettingsPage()

    await user.click(screen.getByRole('tab', { name: /^notifications$/i }))
    expect(screen.getByText(/notification preferences/i)).toBeInTheDocument()
  })
})
