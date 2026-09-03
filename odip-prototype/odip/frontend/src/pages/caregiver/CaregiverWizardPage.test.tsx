import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { CaregiverFormDto } from '@/api/types/caregiver'

const { mockUsePublicCaregiverForm, mockSaveDraftMutateAsync, mockSubmitMutateAsync } = vi.hoisted(() => ({
  mockUsePublicCaregiverForm: vi.fn(),
  mockSaveDraftMutateAsync: vi.fn(),
  mockSubmitMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks/caregiver', () => ({
  usePublicCaregiverForm: mockUsePublicCaregiverForm,
  useSaveCaregiverDraft: () => ({ mutateAsync: mockSaveDraftMutateAsync, isPending: false }),
  useSubmitCaregiverForm: () => ({ mutateAsync: mockSubmitMutateAsync, isPending: false }),
}))

import CaregiverWizardPage from './CaregiverWizardPage'

function makeDto(overrides: Partial<CaregiverFormDto> = {}): CaregiverFormDto {
  return {
    status: 'Draft',
    caregiverName: null,
    caregiverRelationship: null,
    expiresAt: '2026-09-17T00:00:00Z',
    rejectionNote: null,
    current: { firstName: 'Sophie', lastName: 'Rivers', personalInterests: 'Reading' },
    editable: [],
    draft: null,
    ...overrides,
  }
}

function renderCaregiverPage(token = 'tok-1') {
  const router = createMemoryRouter(
    [{ path: '/caregiver/:token', element: <CaregiverWizardPage /> }],
    { initialEntries: [`/caregiver/${token}`] },
  )
  return render(<RouterProvider router={router} />)
}

function stepNav() {
  return screen.getByRole('navigation')
}

beforeEach(() => {
  mockUsePublicCaregiverForm.mockReset()
  mockSaveDraftMutateAsync.mockReset()
  mockSubmitMutateAsync.mockReset()
  mockSaveDraftMutateAsync.mockResolvedValue(undefined)
  mockSubmitMutateAsync.mockResolvedValue(undefined)
})

describe('CaregiverWizardPage — invalid link', () => {
  it('renders the neutral invalid-link page on error, with no hint about why', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: true, data: undefined })
    renderCaregiverPage()
    expect(await screen.findByText(/this link is no longer valid/i)).toBeInTheDocument()
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/revoked/i)).not.toBeInTheDocument()
  })
})

describe('CaregiverWizardPage — no session code reachable', () => {
  it('never reads odip_user from localStorage', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'admin-1' }))
    const spy = vi.spyOn(Storage.prototype, 'getItem')
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    expect(spy.mock.calls.some(([key]) => key === 'odip_user')).toBe(false)
    localStorage.removeItem('odip_user')
  })
})

describe('CaregiverWizardPage — About You name gate', () => {
  it('blocks navigation to later steps until a name is entered', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)

    // Clicking Next with no name entered must not advance past About You.
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/medicare number/i)).toBeInTheDocument())
  })

  it('the step rail disables every later step until the name is entered', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    const keyIdentifiersPill = within(stepNav()).getByRole('button', { name: /key identifiers/i })
    expect(keyIdentifiersPill).toBeDisabled()
  })
})

describe('CaregiverWizardPage — draft save', () => {
  it('saves a draft through the public client when advancing past a step', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage('tok-1')
    await screen.findByLabelText(/^your name/i)

    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(mockSaveDraftMutateAsync).toHaveBeenCalledTimes(1))
    const body = mockSaveDraftMutateAsync.mock.calls[0][0]
    expect(body.caregiverName).toBe('Jane Doe')
    expect(body.payload).toBeDefined()
  })
})

describe('CaregiverWizardPage — hydration', () => {
  it('hydrates a saved draft value into its field on load', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({
      isLoading: false, isError: false,
      data: makeDto({ draft: { keyIdentifiers: { medicareNumber: '999888777' } } as never }),
    })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByLabelText(/medicare number/i)).toHaveValue('999888777'))
  })
})

describe('CaregiverWizardPage — read-only / internal fields', () => {
  it('renders shared fields read-only and never renders an internal field', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/first name/i)).toBeDisabled()
    expect(screen.queryByLabelText(/preferred staff/i)).not.toBeInTheDocument()
    expect(document.getElementById('preferredStaffId')).toBeNull()

    // advance to Behaviour & Communication to check the other internal field
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.queryByLabelText(/behaviour risk rating/i)).not.toBeInTheDocument())
  })
})

describe('CaregiverWizardPage — submitted state', () => {
  it('renders read-only with the awaiting-review banner and no Next/Submit buttons', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto({ status: 'Submitted', caregiverName: 'Jane Doe' }) })
    renderCaregiverPage()
    expect(await screen.findByText(/awaiting review/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit for review/i })).not.toBeInTheDocument()
  })
})

describe('CaregiverWizardPage — rejected state', () => {
  it('shows the rejection note and reopens the form for editing', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({
      isLoading: false, isError: false,
      data: makeDto({ status: 'Draft', rejectionNote: 'Please double check the phone number.' }),
    })
    renderCaregiverPage()
    expect(await screen.findByText(/please double check the phone number/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your name/i)).not.toBeDisabled()
  })
})

describe('CaregiverWizardPage — submit', () => {
  it('calls the public submit endpoint and shows the submitted state', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')

    // Fast-forward through every step to Review (aboutYou + 6 profile steps = 7 Next clicks).
    for (let i = 0; i < 7; i++) {
      await user.click(screen.getByRole('button', { name: /^next$/i }))
      await waitFor(() => expect(mockSaveDraftMutateAsync).toHaveBeenCalledTimes(i + 1))
    }

    await user.click(screen.getByRole('button', { name: /submit for review/i }))
    await waitFor(() => expect(mockSubmitMutateAsync).toHaveBeenCalledTimes(1))
  })
})

// Task 6 — the route is registered as a sibling of /login, outside PrivateRoute/AppLayout/
// UiPreferencesProvider. Exercises the real App.tsx route table (not a test-only router) so a
// future accidental move of the route back inside the authenticated shell fails this test.
describe('App — /caregiver/:token route registration', () => {
  it('renders the caregiver wizard directly, with no app nav and no redirect to /login', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    window.history.pushState({}, '', '/caregiver/route-test-token')
    const { default: App } = await import('@/App')
    render(<App />)

    await screen.findByLabelText(/^your name/i)
    expect(window.location.pathname).toBe('/caregiver/route-test-token')
    expect(screen.queryByRole('navigation', { name: /main/i })).not.toBeInTheDocument()
  })
})
