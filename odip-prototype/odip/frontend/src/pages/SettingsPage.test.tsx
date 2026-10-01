import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsPage from './SettingsPage'

const { mockUsePermissions, mockUseEventTemplates, settingsData, providerSettings, mockUpsertMutate } = vi.hoisted(() => ({
  mockUsePermissions: vi.fn(),
  // The Provider Settings tab: what useProviderSettings returns (a stable reference, like a cached query) and the captured save mutation.
  providerSettings: { current: {} as Record<string, unknown> },
  mockUpsertMutate: vi.fn(),
  // Event Templates tab data; defaults to "no templates" (see beforeEach).
  mockUseEventTemplates: vi.fn((): { data: unknown[] | undefined; isLoading?: boolean } => ({ data: [] })),
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

// The Support Catalogue tab invalidates queries after an import, so it needs a QueryClient the other tabs don't.
function renderSettingsPageWithQueryClient() {
  const router = createMemoryRouter([{ path: '/settings', element: <SettingsPage /> }], { initialEntries: ['/settings'] })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

vi.mock('@/api/hooks', () => ({
  useEventTemplates: mockUseEventTemplates,
  useActivities: () => ({ data: [] }),
  useSettings: () => ({ data: settingsData }),
  useUpdateSettings: () => ({ mutate: vi.fn((_vars, opts) => opts?.onSuccess?.()), isPending: false }),
  useProviderSettings: () => ({ data: providerSettings.current }),
  useUpsertProviderSettings: () => ({ mutate: mockUpsertMutate, isPending: false }),
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
  mockUseEventTemplates.mockReturnValue({ data: [] })
  providerSettings.current = {}
  mockUpsertMutate.mockReset()
})

describe('SettingsPage — Event Templates tab', () => {
  it('shows an empty state with a single "+ New Template" action when there are no templates', async () => {
    const user = userEvent.setup()
    renderSettingsPage()

    expect(screen.getByText('No event templates yet')).toBeInTheDocument()
    // The action lives inside the empty state, not duplicated in the toolbar.
    const actions = screen.getAllByRole('button', { name: '+ New Template' })
    expect(actions).toHaveLength(1)

    await user.click(actions[0])
    expect(await screen.findByRole('heading', { name: 'New Template' })).toBeInTheDocument()
  })

  it('shows the empty state when every template is inactive', () => {
    mockUseEventTemplates.mockReturnValue({
      data: [{ id: 't1', eventName: 'Old Escape', eventCode: 'OE', isActive: false }],
    })
    renderSettingsPage()

    expect(screen.getByText('No event templates yet')).toBeInTheDocument()
    expect(screen.queryByText('Old Escape')).not.toBeInTheDocument()
  })

  it('lists active templates with the toolbar action and no empty state', () => {
    mockUseEventTemplates.mockReturnValue({
      data: [{ id: 't1', eventName: 'Beach Escape', eventCode: 'BE', isActive: true }],
    })
    renderSettingsPage()

    expect(screen.getByText('Beach Escape')).toBeInTheDocument()
    expect(screen.queryByText('No event templates yet')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '+ New Template' })).toHaveLength(1)
  })

  it('does not claim there are no templates while they are still loading', () => {
    mockUseEventTemplates.mockReturnValue({ data: undefined, isLoading: true })
    renderSettingsPage()

    expect(screen.queryByText('No event templates yet')).not.toBeInTheDocument()
  })

  it('draws the empty-state "+ New Template" as a Button at --control-h (32px, 44px on a coarse pointer), not a hand-rolled 44px link', () => {
    const { container } = renderSettingsPage()

    const action = screen.getByRole('button', { name: '+ New Template' })
    expect(action).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]')
    // EmptyState's own action slot is the only place that min-h-[44px] link-button is drawn; it is left unused here.
    expect(container.querySelector('.min-h-\\[44px\\]')).toBeNull()
  })
})

describe('SettingsPage — buttons are the Button primitive', () => {
  it('draws Save Settings as a Button at --control-h, not a hand-rolled rounded-full pill', async () => {
    const user = userEvent.setup()
    renderSettingsPage()

    await user.click(screen.getByRole('tab', { name: /qualification warnings/i }))

    const save = screen.getByRole('button', { name: 'Save Settings' })
    expect(save).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]')
    expect(save.className).not.toMatch(/rounded-full|py-2\.5/)
  })

  it('draws the Public Holidays actions as Buttons: + Add Holiday and Sync Holidays at --control-h, the add-row Save and Cancel at --control-h-sm', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isSuperAdmin: true, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false })
    renderSettingsPage()

    await user.click(screen.getByRole('tab', { name: 'Public Holidays' }))
    for (const name of ['+ Add Holiday', 'Sync Holidays']) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]')
      expect(button.className).not.toMatch(/rounded-full/)
    }

    await user.click(screen.getByRole('button', { name: '+ Add Holiday' }))
    for (const name of ['Save', 'Cancel']) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveClass('h-[var(--control-h-sm)]', 'rounded-[var(--radius-sm)]')
      expect(button.className).not.toMatch(/rounded-(lg|full)/)
    }

    // Cancel still closes the add row.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByPlaceholderText('Holiday name')).not.toBeInTheDocument()
  })

  it('opens the catalogue import from a Button, and closes it from a labelled iconOnly Close button (the bare ✕ glyph had no name)', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isSuperAdmin: true, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false })
    renderSettingsPageWithQueryClient()

    await user.click(screen.getByRole('tab', { name: 'Support Catalogue' }))
    const open = screen.getByRole('button', { name: 'Import Catalogue' })
    expect(open).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]')

    await user.click(open)
    expect(screen.getByText('Import NDIS Support Catalogue')).toBeInTheDocument()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveClass('h-[var(--control-h-sm)]', 'w-[var(--control-h-sm)]')

    await user.click(close)
    expect(screen.queryByText('Import NDIS Support Catalogue')).not.toBeInTheDocument()
  })
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

  // The single-line inputs take a fixed `--control-h` height. A textarea that reuses that class ignores `rows` (an explicit
  // height beats it) and, with `resize-none`, could not be enlarged either: Invoice Footer Notes was stuck at one line.
  it('Invoice Footer Notes keeps its 3 rows and can be resized vertically', async () => {
    const user = userEvent.setup()
    renderSettingsPage()

    await user.click(screen.getByRole('tab', { name: /provider settings/i }))
    const notes = screen.getByPlaceholderText(/NDIS Code of Conduct/i)

    expect(notes).toHaveAttribute('rows', '3')
    expect(notes.className).not.toMatch(/(^|\s)h-\[var\(--control-h\)\]/)
    expect(notes).toHaveClass('h-auto', 'min-h-[var(--control-h)]', 'resize-y')
    expect(notes).not.toHaveClass('resize-none')
  })
})

describe('SettingsPage — Provider Settings: medication competency check', () => {
  const saved = {
    id: 'ps-1', registrationNumber: 'REG1', abn: '12345678901', organisationName: 'Test Org', address: '1 Test St', state: 'NSW',
    gstRegistered: false, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null,
    managerName: null, managerPhone: null, medicationCompetencyMode: 'Warn',
  }

  async function openProviderSettings() {
    const user = userEvent.setup()
    renderSettingsPage()
    await user.click(screen.getByRole('tab', { name: /provider settings/i }))
    return user
  }

  it('shows the saved mode, and saves a change to Enforce together with the rest of the form', async () => {
    providerSettings.current = saved
    const user = await openProviderSettings()

    const control = screen.getByRole('button', { name: /medication competency check/i })
    expect(control).toHaveTextContent('Warn only')
    await user.click(control)
    await user.click(screen.getByRole('option', { name: 'Enforce' }))
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(mockUpsertMutate).toHaveBeenCalledTimes(1)
    expect(mockUpsertMutate.mock.calls[0][0]).toEqual(expect.objectContaining({
      registrationNumber: 'REG1', abn: '12345678901', organisationName: 'Test Org', address: '1 Test St', state: 'NSW', medicationCompetencyMode: 'Enforce',
    }))
  })

  it('shows an Enforce setting as Enforce', async () => {
    providerSettings.current = { ...saved, medicationCompetencyMode: 'Enforce' }
    await openProviderSettings()

    expect(screen.getByRole('button', { name: /medication competency check/i })).toHaveTextContent('Enforce')
  })

  it('reads as Warn only when the server does not send the setting, and then does not send one back', async () => {
    const { medicationCompetencyMode: _omitted, ...older } = saved
    providerSettings.current = older
    const user = await openProviderSettings()

    expect(screen.getByRole('button', { name: /medication competency check/i })).toHaveTextContent('Warn only')
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(mockUpsertMutate.mock.calls[0][0]).not.toHaveProperty('medicationCompetencyMode')
  })

  it('is read-only for a role that cannot edit provider settings', async () => {
    mockUsePermissions.mockReturnValue({ isSuperAdmin: false, canEditProviderSettings: false, showBankDetails: false, canManageNotifications: false })
    providerSettings.current = saved
    await openProviderSettings()

    expect(screen.getByRole('button', { name: /medication competency check/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save Settings' })).not.toBeInTheDocument()
  })

  it('keeps the chosen mode and shows the error when the save is rejected', async () => {
    providerSettings.current = saved
    mockUpsertMutate.mockImplementation((_body, opts) => opts?.onError?.({ response: { status: 403, data: {} } }))
    const user = await openProviderSettings()

    await user.click(screen.getByRole('button', { name: /medication competency check/i }))
    await user.click(screen.getByRole('option', { name: 'Enforce' }))
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(await screen.findByText(/admin role is required/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /medication competency check/i })).toHaveTextContent('Enforce')
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
