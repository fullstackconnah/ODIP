import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsPage from './SettingsPage'

const { mockUsePermissions, mockUseEventTemplates, settingsData, providerSettings, mockUpsertMutate, mockSyncMutate } = vi.hoisted(() => ({
  mockUsePermissions: vi.fn(),
  // The Provider Settings tab: what useProviderSettings returns (a stable reference, like a cached query) and the captured save mutation.
  providerSettings: { current: {} as Record<string, unknown> },
  mockUpsertMutate: vi.fn(),
  // The Public Holidays tab's sync mutation.
  mockSyncMutate: vi.fn(),
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
  useSyncHolidays: () => ({ mutate: mockSyncMutate, isPending: false }),
  // TemplateFormPanel (mounted unconditionally on the default 'templates' tab) and
  // UserFormPanel (mounted unconditionally at the bottom of SettingsPage) pull these in too.
  useCreateEventTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEventTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateEventTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useTrips: () => ({ data: [] }),
  useAdminTenantsSummary: () => ({ data: [] }),
  useCreateAdminUser: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAdminUser: () => ({ mutate: vi.fn(), isPending: false }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
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
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: mockUsePermissions,
}))

// The catalogue import posts straight through apiClient (preview upload, then confirm with every row), so that is the seam these tests drive.
const { mockImportPost } = vi.hoisted(() => ({ mockImportPost: vi.fn() }))
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiClient: Object.assign(Object.create(actual.apiClient), { post: mockImportPost }) }
})

beforeEach(() => {
  mockImportPost.mockReset()
  mockUsePermissions.mockReturnValue({ isSuperAdmin: false, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false })
  mockUseEventTemplates.mockReturnValue({ data: [] })
  providerSettings.current = {}
  mockUpsertMutate.mockReset()
  mockSyncMutate.mockReset()
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
    const older: Record<string, unknown> = { ...saved }
    delete older.medicationCompetencyMode
    providerSettings.current = older
    const user = await openProviderSettings()

    expect(screen.getByRole('button', { name: /medication competency check/i })).toHaveTextContent('Warn only')
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(mockUpsertMutate.mock.calls[0][0]).not.toHaveProperty('medicationCompetencyMode')
  })

  // ── the mode is sent only when the user changed it (review 3 finding M1) ──

  it('does not send the mode when only Manager Phone was edited: an Enforce setting stays Enforce', async () => {
    providerSettings.current = { ...saved, medicationCompetencyMode: 'Enforce' }
    const user = await openProviderSettings()

    await user.type(screen.getByText('Manager Phone').nextElementSibling as HTMLInputElement, '0412000111')
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(mockUpsertMutate).toHaveBeenCalledTimes(1)
    const body = mockUpsertMutate.mock.calls[0][0]
    expect(body).toEqual(expect.objectContaining({
      registrationNumber: 'REG1', abn: '12345678901', organisationName: 'Test Org', address: '1 Test St', state: 'NSW', managerPhone: '0412000111',
    }))
    expect(body).not.toHaveProperty('medicationCompetencyMode')
    expect(screen.getByRole('button', { name: /medication competency check/i })).toHaveTextContent('Enforce')
  })

  it('does not undo another admin: the form loaded Warn, the server has since become Enforce, and an unrelated edit leaves it alone', async () => {
    providerSettings.current = saved   // this form loads Warn only
    const user = await openProviderSettings()
    providerSettings.current = { ...saved, medicationCompetencyMode: 'Enforce' }   // another admin sets Enforce; the query refetches, the open form does not reset

    await user.type(screen.getByText('Manager Phone').nextElementSibling as HTMLInputElement, '0412000111')
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(mockUpsertMutate.mock.calls[0][0]).not.toHaveProperty('medicationCompetencyMode')
  })

  it('does not send the mode when it was changed and changed back to the value that loaded', async () => {
    providerSettings.current = saved
    const user = await openProviderSettings()

    await user.click(screen.getByRole('button', { name: /medication competency check/i }))
    await user.click(screen.getByRole('option', { name: 'Enforce' }))
    await user.click(screen.getByRole('button', { name: /medication competency check/i }))
    await user.click(screen.getByRole('option', { name: 'Warn only' }))
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(mockUpsertMutate.mock.calls[0][0]).not.toHaveProperty('medicationCompetencyMode')
  })

  it('sends a change once: after it saved, a later save of something else does not send the mode again', async () => {
    providerSettings.current = saved
    mockUpsertMutate.mockImplementation((_body, opts) => opts?.onSuccess?.())
    const user = await openProviderSettings()

    await user.click(screen.getByRole('button', { name: /medication competency check/i }))
    await user.click(screen.getByRole('option', { name: 'Enforce' }))
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    await user.type(screen.getByText('Manager Phone').nextElementSibling as HTMLInputElement, '0412000111')
    await user.click(screen.getByRole('button', { name: /^save/i }))   // the label reads Saved! for two seconds after a save

    expect(mockUpsertMutate).toHaveBeenCalledTimes(2)
    expect(mockUpsertMutate.mock.calls[0][0]).toHaveProperty('medicationCompetencyMode', 'Enforce')
    expect(mockUpsertMutate.mock.calls[1][0]).not.toHaveProperty('medicationCompetencyMode')
  })

  it('still sends the change after a rejected save, so a retry is not silently dropped', async () => {
    providerSettings.current = saved
    mockUpsertMutate.mockImplementationOnce((_body, opts) => opts?.onError?.({ response: { status: 500, data: {} } }))
    const user = await openProviderSettings()

    await user.click(screen.getByRole('button', { name: /medication competency check/i }))
    await user.click(screen.getByRole('option', { name: 'Enforce' }))
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(mockUpsertMutate).toHaveBeenCalledTimes(2)
    expect(mockUpsertMutate.mock.calls[1][0]).toHaveProperty('medicationCompetencyMode', 'Enforce')
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

describe('SettingsPage — catalogue import preview', () => {
  // Rows exactly as the API sends them: defaults (false, 0) and nulls are left out of the JSON.
  const rows = [
    {
      itemNumber: '04_104_0125_6_1', description: 'Access Community Social and Rec Activ - Standard - Weekday Daytime', dayType: 'Weekday', unit: 'H',
      registrationGroup: '0125', supportCategoryNumber: 4, paceSupportCategoryNumber: 4, outcomeDomain: 6, supportPurpose: 1, catalogueType: 'Priced',
      nonFaceToFace: 'Yes', providerTravel: 'Yes', shortNoticeCancellation: 'Yes', ndiaRequestedReports: 'No', irregularSil: 'No',
      priceLimit_ACT: 73.58, priceLimit_NSW: 73.58, priceLimit_NT: 73.58, priceLimit_QLD: 73.58, priceLimit_SA: 73.58, priceLimit_TAS: 73.58,
      priceLimit_VIC: 73.58, priceLimit_WA: 73.58, priceLimit_Remote: 103.01, priceLimit_VeryRemote: 110.37,
      effectiveFrom: '2026-07-01', priceNational: 73.58, priceRemote: 103.01, priceVeryRemote: 110.37,
      sourceDocument: 'support-catalogue-2026-27.xlsx', family: 'CommunityAccess', groupCode: 'GRP_COMMUNITY_ACCESS', isNew: true,
    },
    {
      itemNumber: '01_058_0115_1_1', description: 'STA And Assistance (Inc. Respite) - 1:1 - Weekday', dayType: 'Weekday', unit: 'D', registrationGroup: '0115',
      isLegacy: true, effectiveFrom: '2026-07-01', effectiveTo: '2027-06-30', priceNational: 2178.57, sourceDocument: 'support-catalogue-2026-27.xlsx',
      family: 'Other', groupCode: 'GRP_OTHER', isNew: true,
    },
  ]
  const preview = (detectedFormat: string) => ({
    detectedVersion: '2026-27', detectedFormat, sourceDocument: 'support-catalogue-2026-27.xlsx', effectiveFrom: '2026-07-01',
    itemsToAdd: 2, itemsUnchanged: 0, legacyItems: 1, itemsToDeactivate: 4, rows,
    warnings: ['Existing item 04_212_0125_6_1 (Group Activities - Standard - Saturday - TTP) is not in the new catalogue and will be end-dated 2026-06-30.'],
  })

  async function openPreview(detectedFormat = 'NationalRemote') {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isSuperAdmin: true, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false })
    mockImportPost.mockResolvedValueOnce({ data: { data: preview(detectedFormat) } })
    renderSettingsPageWithQueryClient()

    await user.click(screen.getByRole('tab', { name: 'Support Catalogue' }))
    await user.click(screen.getByRole('button', { name: 'Import Catalogue' }))
    const file = new File(['xlsx'], 'support-catalogue-2026-27.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file)
    await screen.findByText('Catalogue Version')
    return { user, file }
  }

  it('uploads the file, then shows what it is, when it starts and what will change', async () => {
    const { file } = await openPreview()

    const [url, body, config] = mockImportPost.mock.calls[0]
    expect(url).toBe('/support-catalogue/import/preview')
    expect((body as FormData).get('file')).toBe(file)
    expect(config).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } })

    expect(screen.getByText(/support-catalogue-2026-27\.xlsx/)).toBeInTheDocument()
    expect(screen.getByText(/National \/ Remote \/ Very Remote prices/)).toBeInTheDocument()
    expect(screen.getByText(/Starts 01\/07\/2026/)).toBeInTheDocument()
    expect(screen.getByText(/2 rows, 1 legacy/)).toBeInTheDocument()
    expect(screen.getByText('New items').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Unchanged').nextSibling).toHaveTextContent('0')
    expect(screen.getByText('To end-date').nextSibling).toHaveTextContent('4')
    expect(screen.getByText(/04_212_0125_6_1 .* will be end-dated 2026-06-30/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-27')).toBeInTheDocument()   // the version proposed from the file
  })

  it('says it is the one-price-per-state layout when the 2025-26 file was uploaded', async () => {
    await openPreview('StateColumns')

    expect(screen.getByText(/One price per state/)).toBeInTheDocument()
    expect(screen.queryByText(/National \/ Remote \/ Very Remote prices/)).not.toBeInTheDocument()
  })

  it('confirms with the version the admin typed and posts every row back exactly as the preview sent it', async () => {
    const { user } = await openPreview()
    mockImportPost.mockResolvedValueOnce({ data: { success: true } })

    const version = screen.getByDisplayValue('2026-27')
    await user.clear(version)
    await user.type(version, '2026-27 NDIA')
    await user.click(screen.getByRole('button', { name: 'Confirm Import' }))

    expect(mockImportPost).toHaveBeenLastCalledWith('/support-catalogue/import/confirm', { catalogueVersion: '2026-27 NDIA', rows })
    expect(screen.queryByText('Import NDIS Support Catalogue')).not.toBeInTheDocument()   // closed after a successful import
  })

  it('shows why the server refused an upload that is not a catalogue, instead of a generic failure', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isSuperAdmin: true, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false })
    mockImportPost.mockRejectedValueOnce({ response: { status: 400, data: { success: false, errors: ['No support items found. Upload the NDIS Support Catalogue .xlsx (the 2026-27 or 2025-26 file).'] } } })
    renderSettingsPageWithQueryClient()

    await user.click(screen.getByRole('tab', { name: 'Support Catalogue' }))
    await user.click(screen.getByRole('button', { name: 'Import Catalogue' }))
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'notes.xlsx'))

    expect(await screen.findByRole('alert')).toHaveTextContent('No support items found. Upload the NDIS Support Catalogue .xlsx (the 2026-27 or 2025-26 file).')
    expect(screen.queryByText('Catalogue Version')).not.toBeInTheDocument()   // still on the upload step
  })

  it("shows the server's refusal and keeps the typed version when the confirm is rejected", async () => {
    const { user } = await openPreview()
    // The API's failure shape (ApiResponse.Fail): the explanation is in errors[0], there is no top-level message.
    mockImportPost.mockRejectedValueOnce({ response: { status: 400, data: { success: false, errors: ['Nothing was imported. 04_104_0125_6_1: the row has no start date.'] } } })

    const version = screen.getByDisplayValue('2026-27')
    await user.clear(version)
    await user.type(version, 'v2')
    await user.click(screen.getByRole('button', { name: 'Confirm Import' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was imported. 04_104_0125_6_1: the row has no start date.')
    expect(screen.getByDisplayValue('v2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm Import' })).toBeEnabled()
  })
})

// Three of these tabs flash a confirmation ("Saved!", or the holiday sync's result line) and set a timer to take it down again. That timer was a
// bare setTimeout: left running past its tab it fired setState into a tree that was gone, and past the end of the test environment it threw
// "window is not defined", which fails the whole run even though every test passed. Fake timers go in only for the last step, once the user-event
// steps that need real timers are done. Each test acts twice inside the window: the second action has to cancel the first one's timer, not leave
// it running beside its own, or that first timer would outlive the tab all the same.
describe('SettingsPage — the timer that puts a confirmation away dies with its tab', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Acts twice 500 ms apart, then leaves the page; reports how many timers were pending after the second act and after leaving. */
  function actTwiceThenLeave(target: () => HTMLElement, unmount: () => void) {
    fireEvent.click(target())
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.click(target())
    const afterSecond = vi.getTimerCount()
    unmount()
    return { afterSecond, afterUnmount: vi.getTimerCount() }
  }

  it('Qualification Warnings: the "Saved!" reset', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSettingsPage()
    await user.click(screen.getByRole('tab', { name: /qualification warnings/i }))
    await user.click(screen.getByRole('button', { name: /30 days/i }))
    await user.click(await screen.findByRole('option', { name: /60 days/i }))

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = actTwiceThenLeave(() => screen.getByRole('button', { name: /^(Save Settings|Saved!)$/ }), unmount)

    expect(pending).toEqual({ afterSecond: 1, afterUnmount: 0 })
  })

  it('Provider Settings: the "Saved!" reset', async () => {
    mockUpsertMutate.mockImplementation((_body, opts) => opts?.onSuccess?.())
    const user = userEvent.setup()
    const { unmount } = renderSettingsPage()
    await user.click(screen.getByRole('tab', { name: /provider settings/i }))
    await user.type(screen.getByText('ABN').nextElementSibling as HTMLInputElement, '1')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = actTwiceThenLeave(() => screen.getByRole('button', { name: /^(Save Settings|Saved!)$/ }), unmount)

    expect(pending).toEqual({ afterSecond: 1, afterUnmount: 0 })
  })

  it('Public Holidays: the sync result line', async () => {
    mockUsePermissions.mockReturnValue({ isSuperAdmin: true, canEditProviderSettings: true, showBankDetails: true, canManageNotifications: false })
    mockSyncMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.({ holidaysAdded: 3, holidaysUpdated: 1, errors: [] }))
    const user = userEvent.setup()
    const { unmount } = renderSettingsPage()
    await user.click(screen.getByRole('tab', { name: 'Public Holidays' }))

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = actTwiceThenLeave(() => screen.getByRole('button', { name: 'Sync Holidays' }), unmount)

    expect(mockSyncMutate).toHaveBeenCalledTimes(2)
    expect(pending).toEqual({ afterSecond: 1, afterUnmount: 0 })
  })
})
