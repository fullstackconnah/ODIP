import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import StaffPage from './StaffPage'
import type { StaffListDto } from '@/api/types/staff'

const { mockUseStaff, mockDeleteMutate, mockUpdateMutate } = vi.hoisted(() => ({
  mockUseStaff: vi.fn(),
  mockDeleteMutate: vi.fn(),
  mockUpdateMutate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useStaff: mockUseStaff,
  useDeleteStaff: () => ({ mutate: mockDeleteMutate, isPending: false }),
  useUpdateStaff: () => ({ mutate: mockUpdateMutate, isPending: false }),
}))

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

function makeStaff(overrides: Partial<StaffListDto> = {}): StaffListDto {
  return {
    id: 's1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', username: 'alex',
    role: 'SupportWorker', position: 'SupportWorker', email: 'alex@example.com', mobile: null,
    region: 'North', isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
    isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true,
    firstAidExpiryDate: null, driverLicenceExpiryDate: null, manualHandlingExpiryDate: null,
    medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null,
    hasExpiredQualifications: false, notes: null,
    ...overrides,
  } as StaffListDto
}

function renderPage() {
  return render(
    <MemoryRouter>
      <StaffPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseStaff.mockReset()
  mockDeleteMutate.mockReset()
  mockUpdateMutate.mockReset()
  mockUseStaff.mockReturnValue({
    data: [
      makeStaff({ id: 's1', fullName: 'Alex Rivera', position: 'Coordinator', region: 'North' }),
      makeStaff({ id: 's2', fullName: 'Sam Lee', position: 'SupportWorker', region: 'South' }),
    ],
    isLoading: false,
  })
  setUserRole('Admin')
})

afterEach(() => {
  localStorage.clear()
})

// PP-45 — a search box, threaded client-side (the backend's GetAll has no text-search param),
// filters the staff table by name/position/region.
describe('StaffPage — PP-45 search', () => {
  it('renders a search input and filters the table to matching staff', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/search staff/i), 'sam')

    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
  })

  it('also matches on position/region, not just name', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText(/search staff/i), 'coordinator')

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument()
  })

  it('shows a "no match" empty state with a Clear search action when nothing matches', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText(/search staff/i), 'zzz-no-match')

    expect(screen.getByText(/no staff match your search/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear search/i }))
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
  })
})

// Connection map item 12 — the staff name links to the new staff hub, same "name links to the
// detail page" convention ParticipantsPage already uses.
describe('StaffPage — staff detail link', () => {
  it('links each staff name to their staff detail page', () => {
    renderPage()

    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', '/staff/s1')
    expect(screen.getByRole('link', { name: 'Sam Lee' })).toHaveAttribute('href', '/staff/s2')
  })
})

// PP-46 — the Active -> Inactive transition on the status dropdown is staged behind a
// ConfirmDialog; Active (re-activation) still fires immediately.
describe('StaffPage — PP-46 deactivate confirm', () => {
  it('does not call the mutation until the Inactive transition is confirmed', async () => {
    const user = userEvent.setup()
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^active$/i }))
    await user.click(await screen.findByRole('option', { name: /inactive/i }))

    expect(mockUpdateMutate).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: /mark staff member as inactive/i })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /mark inactive/i }))
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', data: expect.objectContaining({ isActive: false }) }),
      expect.anything(),
    )
  })

  it('cancelling the dialog does not call the mutation', async () => {
    const user = userEvent.setup()
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^active$/i }))
    await user.click(await screen.findByRole('option', { name: /inactive/i }))

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(mockUpdateMutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('an Inactive -> Active transition fires immediately with no confirm dialog', async () => {
    const user = userEvent.setup()
    mockUseStaff.mockReturnValue({
      data: [makeStaff({ id: 's3', fullName: 'Jamie Fox', isActive: false })],
      isLoading: false,
    })
    renderPage()

    const row = screen.getByText('Jamie Fox').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^inactive$/i }))
    await user.click(await screen.findByRole('option', { name: /^active$/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's3', data: expect.objectContaining({ isActive: true }) }),
    )
  })
})

// PP-47 — the worker-screening "current" Check icon needs an accessible label, matching the
// labelled StatusBadge used for the expired case.
describe('StaffPage — PP-47 worker screening icon label', () => {
  it('labels the current worker-screening icon', () => {
    mockUseStaff.mockReturnValue({
      data: [makeStaff({ id: 's1', fullName: 'Alex Rivera', workerScreeningExpiryDate: '2099-01-01' })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByLabelText('Worker screening current')).toBeInTheDocument()
  })
})

describe('StaffPage — cross-domain links', () => {
  it('links each row to that staff member\'s leave & availability for a role with leave-approvals access', () => {
    setUserRole('Admin')
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    expect(within(row).getByRole('link', { name: /leave.*availability/i })).toHaveAttribute('href', '/rostering/leave?userId=s1')
  })

  it('hides the leave & availability link for a role without leave-approvals access (SupportWorker)', () => {
    setUserRole('SupportWorker')
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    expect(within(row).queryByRole('link', { name: /leave.*availability/i })).not.toBeInTheDocument()
  })
})

// Density review — table rows land on --row-h only if nothing inside them is taller than 24px:
// the row actions and the status pill are all --control-h-sm, and the actions appear on hover/focus.
describe('StaffPage — density row actions', () => {
  it('pins the Active/Inactive status pill to the 24px --control-h-sm token and keeps it always visible', () => {
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    const pill = within(row).getByRole('button', { name: /^active$/i })
    expect(pill).toHaveClass('h-[var(--control-h-sm)]')
    // A status is information, not an action: nothing above it in the row fades it out.
    expect(pill.closest('[class*="group-hover/row:opacity-100"]')).toBeNull()
  })

  it('renders the leave link as a 24px icon square inside the hover/focus-revealed action cluster', () => {
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    const leave = within(row).getByRole('link', { name: /leave.*availability/i })
    expect(leave).toHaveClass('h-[var(--control-h-sm)]', 'w-[var(--control-h-sm)]', 'p-0')

    const cluster = leave.parentElement as HTMLElement
    expect(cluster).toHaveClass('opacity-0', 'group-hover/row:opacity-100', 'group-focus-within/row:opacity-100', '[@media(pointer:coarse)]:opacity-100')
    // Opacity only — the actions stay in the tab order and the accessibility tree.
    expect(cluster.className).not.toMatch(/(^|\s)(hidden|invisible)(\s|$)/)
    // The archive-flow Edit/Archive icons are in the same cluster, so they reveal together.
    expect(within(cluster).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/staff/s1/edit')
    expect(within(cluster).getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  })

  it('keeps the title row and the filter row in one block-flow wrapper so the header is 72px, not gap-spaced', () => {
    renderPage()

    const h1 = screen.getByRole('heading', { level: 1, name: 'Staff' })
    const search = screen.getByPlaceholderText(/search staff/i)
    const wrapper = h1.parentElement?.parentElement?.parentElement as HTMLElement
    // The wrapper is a plain <div> (block flow): PageHeader's rows are 32 + 8 + 32px. Directly
    // inside the page's flex column the section gap would open between them (88px).
    expect(wrapper).toContainElement(search)
    expect(wrapper.tagName).toBe('DIV')
    expect(wrapper.className).toBe('')
  })
})

// R2-01: DataTable cells no longer wrap, so the eleven-column staff table needed ~1140px against a ~1006px box at 1280 and pushed Status
// and the row actions off-screen (more with long names and regions). jsdom does no layout (the Playwright overflow audit measures it), so
// this pins the budget: the two least-asked qualification flags give way below 1536px, and the text columns are capped.
describe('StaffPage — column budget', () => {
  it('hides the Manual and Overnight flags below 1536px and keeps every other column', () => {
    renderPage()
    expect(screen.getByRole('columnheader', { name: 'Manual' })).toHaveClass('md:max-2xl:hidden')
    expect(screen.getByRole('columnheader', { name: 'Overnight' })).toHaveClass('md:max-2xl:hidden')
    for (const name of ['Name', 'Position', 'Region', 'Driver', 'First Aid', 'Meds', 'Worker Screening', 'Status']) {
      expect(screen.getByRole('columnheader', { name }).className, name).not.toMatch(/max-(xl|2xl)|max-\[1792px\]/)
    }
  })

  it('caps Position and Region, and truncates the name link on the link itself with the full name in a tooltip', () => {
    renderPage()
    const row = screen.getByRole('link', { name: 'Alex Rivera' }).closest('tr')!
    expect(within(row).getByText('Coordinator')).toHaveStyle('--cell-max: 7rem')
    expect(within(row).getByText('North')).toHaveStyle('--cell-max: 7rem')
    const link = screen.getByRole('link', { name: 'Alex Rivera' })
    expect(link).toHaveClass('block', 'truncate', 'md:max-w-[11rem]')
    expect(link).toHaveAttribute('title', 'Alex Rivera')
  })
})
