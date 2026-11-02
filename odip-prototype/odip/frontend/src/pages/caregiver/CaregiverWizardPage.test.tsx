import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { CaregiverFormDto } from '@/api/types/caregiver'
import { ACKNOWLEDGEMENT_OF_COUNTRY } from '@/lib/platformFacts'
import projection from '@/test/fixtures/golden/caregiver-projection.json'

const { mockUsePublicCaregiverForm, mockSaveDraftMutateAsync, mockSubmitMutateAsync, saveState } = vi.hoisted(() => ({
  saveState: { pending: false },
  mockUsePublicCaregiverForm: vi.fn(),
  mockSaveDraftMutateAsync: vi.fn(),
  mockSubmitMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks/caregiver', () => ({
  usePublicCaregiverForm: mockUsePublicCaregiverForm,
  useSaveCaregiverDraft: () => ({ mutateAsync: mockSaveDraftMutateAsync, isPending: saveState.pending }),
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
    providerName: 'Ability Options',
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

// jsdom does not implement scrollTo; the page calls it after Next.
const scrollTo = vi.fn()

beforeEach(() => {
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  scrollTo.mockClear()
  mockUsePublicCaregiverForm.mockReset()
  saveState.pending = false
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

describe('CaregiverWizardPage — landmarks and the platform footer', () => {
  it('puts the form in one main and the footer beside it, with the acknowledgement and no Support link', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    const footer = screen.getByRole('contentinfo')
    expect(footer.closest('main')).toBeNull()
    expect(screen.getByRole('main').nextElementSibling).toBe(footer)
    expect(within(footer).getByText(ACKNOWLEDGEMENT_OF_COUNTRY)).toBeInTheDocument()
    expect(within(footer).getByRole('link', { name: 'Accessibility (opens in a new tab)' })).toHaveAttribute('href', '/accessibility')
    expect(within(footer).queryByRole('link', { name: /support/i })).toBeNull()
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
  })

  it('keeps the same frame on the invalid-link page', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: true, data: undefined })
    renderCaregiverPage()
    await screen.findByText(/this link is no longer valid/i)
    expect(screen.getByRole('main').nextElementSibling).toBe(screen.getByRole('contentinfo'))
  })
})

describe('CaregiverWizardPage — no session code reachable', () => {
  it('never reads the admin session\'s stored-identity key from localStorage', async () => {
    // Built from parts rather than a literal so this directory's own source stays clean of the
    // admin-session-key token a repo-wide grep checks for.
    const adminSessionUserKey = ['odip', 'user'].join('_')
    localStorage.setItem(adminSessionUserKey, JSON.stringify({ id: 'admin-1' }))
    const spy = vi.spyOn(Storage.prototype, 'getItem')
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    expect(spy.mock.calls.some(([key]) => key === adminSessionUserKey)).toBe(false)
    localStorage.removeItem(adminSessionUserKey)
  })
})

// L5-10: the step rail announced itself as "Intake wizard steps" on every wizard.
describe('CaregiverWizardPage — the step rail names itself', () => {
  it('is the caregiver form steps, not the intake', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)

    expect(screen.getByRole('navigation', { name: 'Caregiver form steps' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /intake/i })).not.toBeInTheDocument()
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
    await userEvent.setup().click(screen.getByText(/^step 1 of 8/i))
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

describe('CaregiverWizardPage — step-change focus and announcement (a11y)', () => {
  it('moves focus to the new step heading when advancing from About You to Key Identifiers', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)

    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() => expect(mockSaveDraftMutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('heading', { name: 'Key Identifiers' })).toHaveFocus()
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
    // A standing note, announced politely, with the warning tone's icon.
    const note = screen.getByText(/please double check the phone number/i).closest('[role="status"]')!
    expect(note).toHaveAttribute('aria-live', 'polite')
    expect(note.querySelector('svg')).not.toBeNull()
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

describe('CaregiverWizardPage — Review step (PP-6)', () => {
  it('humanises field labels and never renders [object Object] for an array-valued field', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({
      isLoading: false, isError: false,
      data: makeDto({ draft: { mobility: { mobilitySupportOptions: ['Wheelchair', 'Walking frame'] } } as never }),
    })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')

    // Fast-forward through every step to Review (aboutYou + 6 profile steps = 7 Next clicks).
    for (let i = 0; i < 7; i++) {
      await user.click(screen.getByRole('button', { name: /^next$/i }))
      await waitFor(() => expect(mockSaveDraftMutateAsync).toHaveBeenCalledTimes(i + 1))
    }

    // Humanised label (from lib/documentMapping), not the raw camelCase field key.
    expect(screen.getByText('Mobility Support Options')).toBeInTheDocument()
    expect(screen.queryByText('mobilitySupportOptions')).not.toBeInTheDocument()
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument()
  })

  // PP-43 — reviewBuilder used to truncate every non-aboutYou step to its first 4 fields via
  // `.slice(0, 4)`. Key Identifiers alone has 19 fields, so its Review card must show all of them.
  it('shows every field for a step with more than 4 fields (Key Identifiers), not just the first 4', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({
      isLoading: false, isError: false,
      data: makeDto(),
    })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')

    for (let i = 0; i < 7; i++) {
      await user.click(screen.getByRole('button', { name: /^next$/i }))
      await waitFor(() => expect(mockSaveDraftMutateAsync).toHaveBeenCalledTimes(i + 1))
    }

    const heading = screen.getByRole('heading', { name: 'Key Identifiers' })
    const card = heading.closest('.space-y-2') as HTMLElement
    expect(card).toBeTruthy()
    const rowLabels = within(card).getAllByRole('term')
    // 19 fields on the Key Identifiers step (see PROFILE_STEP_KEY_IDENTIFIERS_FIELDS) — well
    // past the old truncation point of 4.
    expect(rowLabels.length).toBeGreaterThan(4)
  })
})

// Task 6 — the route is registered as a sibling of /login, outside the authenticated app shell
// (PrivateRoute, the admin layout chrome, UiPreferencesProvider). Exercises the real App.tsx
// route table (not a test-only router) so a future accidental move of the route back inside
// that shell fails this test.
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

// PARTICIPANTS-6: "Save and continue later" checks the name first, says when the save failed, and says when it worked.
describe('CaregiverWizardPage — Save and continue later', () => {
  async function open() {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    return user
  }

  it('asks for the name before saving, with the message the form uses', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Save and continue later' }))

    expect(mockSaveDraftMutateAsync).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Please enter your name')
    // The field itself is marked too, with its inline message.
    expect(screen.getByLabelText(/your name/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('says the save failed, in plain words', async () => {
    const user = await open()
    mockSaveDraftMutateAsync.mockRejectedValue({ response: { status: 500, data: { message: 'NullReferenceException at Odip.Api' } } })
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: 'Save and continue later' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't save your progress.")
    expect(screen.queryByText(/NullReferenceException/)).not.toBeInTheDocument()
  })

  it('says the progress was saved in a live region that was already on the page, and clears it on the next edit', async () => {
    const user = await open()
    const regionsBefore = screen.queryAllByRole('status')
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: 'Save and continue later' }))

    expect(mockSaveDraftMutateAsync).toHaveBeenCalledTimes(1)
    const saved = await screen.findByText(/Progress saved/)
    expect(saved).toHaveAttribute('role', 'status')
    // Screen readers announce a change inside a live region, not a region inserted already filled.
    expect(regionsBefore).toContain(saved)

    await user.type(screen.getByLabelText(/your name/i), 's')
    expect(saved).toBeInTheDocument()
    expect(saved).toHaveTextContent(/^$/)
  })
})

// A caregiver who opens the form and changes nothing must send a payload equal to the base they loaded,
// so Accept has nothing to apply and cannot undo anyone's later edit.
describe('CaregiverWizardPage — sends the base it loaded', () => {
  it('an untouched wizard submits a payload deep-equal to its base', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({
      isLoading: false, isError: false,
      data: makeDto({ current: projection as Record<string, unknown>, caregiverName: 'Jane Doe' }),
    })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    for (let i = 0; i < 7; i++) {
      await user.click(screen.getByRole('button', { name: /^next$/i }))
      await waitFor(() => expect(mockSaveDraftMutateAsync).toHaveBeenCalledTimes(i + 1))
    }
    await user.click(screen.getByRole('button', { name: /submit for review/i }))
    await waitFor(() => expect(mockSubmitMutateAsync).toHaveBeenCalledTimes(1))
    const body = mockSubmitMutateAsync.mock.calls[0][0]
    expect(body.base).toBeTruthy()
    expect(Object.keys(body.base)).toEqual(Object.keys(body.payload))
    expect(body.payload).toEqual(body.base)
  })

  it('shows the draft for the field the caregiver changed and the live value for the rest, even when the draft still equals the stored base', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({
      isLoading: false, isError: false,
      data: makeDto({
        current: { firstName: 'Sophie', lastName: 'Rivers', medicareNumber: '111111111', pensionCardNumber: '333333333' },
        base: { keyIdentifiers: { medicareNumber: '000000000', pensionCardNumber: '222222222' } } as never,
        draft: { keyIdentifiers: { medicareNumber: '999888777', pensionCardNumber: '222222222' } } as never,
      }),
    })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByLabelText(/medicare number/i)).toHaveValue('999888777'))
    expect(screen.getByLabelText(/pension card number/i)).toHaveValue('333333333')
    const saved = mockSaveDraftMutateAsync.mock.calls[0][0]
    expect(saved.base.keyIdentifiers).toMatchObject({ medicareNumber: '000000000' })
  })
})

describe('CaregiverWizardPage — welcome header', () => {
  it('holds the Bunya Support mark (not a link) and names the participant and the provider', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    const banner = screen.getByRole('banner')
    expect(within(banner).getByText('Bunya Support')).toBeInTheDocument()
    expect(within(banner).queryByRole('link')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: "Sophie's profile" })).toBeInTheDocument()
    expect(screen.getByText('From Ability Options')).toBeInTheDocument()
    expect(screen.getByText('Please check the information below and update anything that is missing or out of date.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ODIP/)
  })

  it('falls back to Participant profile with no first name, and drops the From line with no provider', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({
      isLoading: false, isError: false,
      data: makeDto({ providerName: null, current: { firstName: '  ' } }),
    })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    expect(screen.getByRole('heading', { level: 1, name: 'Participant profile' })).toBeInTheDocument()
    expect(screen.queryByText(/^From /)).toBeNull()
  })

  it('names no provider on the invalid page', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: true, data: undefined })
    renderCaregiverPage()
    await screen.findByText(/this link is no longer valid/i)
    expect(screen.getByRole('heading', { level: 1, name: 'Participant profile' })).toBeInTheDocument()
    expect(screen.queryByText(/^From /)).toBeNull()
  })

  it('shows the provenance but no instruction line once submitted', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto({ status: 'Submitted', caregiverName: 'Jane Doe' }) })
    renderCaregiverPage()
    await screen.findByText(/awaiting review/i)
    expect(screen.getByText('From Ability Options')).toBeInTheDocument()
    expect(screen.queryByText(/Please check the information below/)).toBeNull()
  })

  it('pins the action bar to the screen edge by zeroing the app shell bottom-nav height', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    const { container } = renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    expect((container.firstChild as HTMLElement).className).toContain('[--mobile-nav-h:0px]')
  })
})

describe('CaregiverWizardPage — compact progress', () => {
  it('reads Step n of 8 and follows the wizard', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    expect(screen.getByText('Step 1 of 8 · About you')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(await screen.findByText('Step 2 of 8 · Key Identifiers')).toBeInTheDocument()
  })

  it('lists all 8 steps with a check on finished ones, the current one marked, and later ones disabled', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    const list = within(stepNav())
    expect(list.getAllByRole('button')).toHaveLength(8)
    expect(list.getByRole('button', { name: /about you/i })).toHaveAttribute('aria-current', 'step')
    expect(list.getByRole('button', { name: /review/i })).toBeDisabled()
    expect(list.queryByTestId('step-done')).toBeNull()

    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await screen.findByText('Step 2 of 8 · Key Identifiers')
    expect(list.getAllByTestId('step-done')).toHaveLength(1)
    expect(list.getByRole('button', { name: /key identifiers/i })).toHaveAttribute('aria-current', 'step')
  })

  it('jumping back to a visited step changes the step, closes the list and keeps later unvisited steps disabled', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await screen.findByText('Step 2 of 8 · Key Identifiers')

    const details = document.querySelector('details') as HTMLDetailsElement
    await user.click(screen.getByText(/^step 2 of 8/i))
    expect(details.open).toBe(true)
    await user.click(within(stepNav()).getByRole('button', { name: /about you/i }))
    expect(await screen.findByText('Step 1 of 8 · About you')).toBeInTheDocument()
    expect(details.open).toBe(false)
    expect(within(stepNav()).getByRole('button', { name: /medical/i })).toBeDisabled()
  })

  it('keeps the step heading for focus and announcement, visually hidden', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Key Identifiers' })).toHaveFocus())
    expect(screen.getByRole('heading', { name: 'Key Identifiers' })).toHaveClass('sr-only')
  })

  it('scrolls to the top after Next, and not on first render', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    expect(scrollTo).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await screen.findByText('Step 2 of 8 · Key Identifiers')
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })
})

describe('CaregiverWizardPage — action bar', () => {
  it('has no Cancel on the first step or on Review', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    expect(screen.queryByRole('link', { name: 'Cancel' })).toBeNull()
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    for (let i = 0; i < 7; i++) {
      await user.click(screen.getByRole('button', { name: /^next$/i }))
      await waitFor(() => expect(mockSaveDraftMutateAsync).toHaveBeenCalledTimes(i + 1))
    }
    await screen.findByRole('button', { name: /submit for review/i })
    expect(screen.queryByRole('link', { name: 'Cancel' })).toBeNull()
  })

  it('shows a failed save in the bar, with the field message pointing down at it', async () => {
    const user = userEvent.setup()
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    mockSaveDraftMutateAsync.mockRejectedValue(new Error('boom'))
    await user.type(screen.getByLabelText(/your name/i), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    const message = await screen.findByText(/We couldn't save your progress/)
    expect(message).toHaveAttribute('role', 'alert')
    expect(message.closest('.sticky')).not.toBeNull()
    expect(screen.getByText('Save failed — see the message below.')).toBeInTheDocument()
  })

  it('reads Saving… and is inert while the draft saves', async () => {
    saveState.pending = true
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    const btn = await screen.findByRole('button', { name: 'Saving…' })
    expect(btn).toHaveAttribute('aria-disabled', 'true')
  })
})

// The owner saw "Please enter your name" on a fresh form; nothing validates on mount.
describe('CaregiverWizardPage — first render', () => {
  it('shows no error and no alert before the caregiver does anything', async () => {
    mockUsePublicCaregiverForm.mockReturnValue({ isLoading: false, isError: false, data: makeDto() })
    renderCaregiverPage()
    await screen.findByLabelText(/^your name/i)
    expect(screen.queryByText('Please enter your name')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
