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
      expect.anything(),
    )
  })
})

// PP-47 — the worker-screening "current" Check icon needs an accessible label, matching the
// labelled StatusBadge used for the expired case.
describe('StaffPage — PP-47 worker screening, now a Qualifications chip', () => {
  it('names a current worker screening in words', () => {
    mockUseStaff.mockReturnValue({
      data: [makeStaff({ id: 's1', fullName: 'Alex Rivera', workerScreeningExpiryDate: '2099-01-01' })],
      isLoading: false,
    })
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    expect(within(row).getByText('Worker screening')).toBeInTheDocument()
  })

  // Expired means the expiry day has passed (lib/deadline.ts, a calendar-day compare): a screening that expires today is still current.
  it('shows an Expired badge once the expiry day has passed, and not on the day itself', () => {
    const iso = (offset: number) => {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    mockUseStaff.mockReturnValue({
      data: [
        makeStaff({ id: 's1', fullName: 'Alex Rivera', workerScreeningExpiryDate: iso(-1) }),
        makeStaff({ id: 's2', fullName: 'Blake Nguyen', workerScreeningExpiryDate: iso(0) }),
      ],
      isLoading: false,
    })
    renderPage()

    const alex = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    const blake = screen.getByText('Blake Nguyen').closest('tr') as HTMLElement
    expect(within(alex).getByText('Screening expired')).toBeInTheDocument()
    expect(within(blake).queryByText('Screening expired')).not.toBeInTheDocument()
    expect(within(blake).getByText('Worker screening')).toBeInTheDocument()
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

// R2-01: DataTable cells no longer wrap, so the eleven-column staff table needed ~1140px against a ~1006px box at 1280. L3-04: hiding the
// Manual and Overnight flags below 1536px was no fix (the data was off the page), so no column is removed: the table scrolls in its box with
// the name and the actions pinned (DataTable's column rule), and the text columns are capped. jsdom does no layout.
describe('StaffPage — column budget', () => {
  it('keeps every column at every width; the six qualification flags are one Qualifications column', () => {
    renderPage()
    for (const name of ['Name', 'Position', 'Region', 'Qualifications', 'Status']) {
      expect(screen.getByRole('columnheader', { name }).className, name).not.toMatch(/hidden/)
    }
    for (const name of ['Driver', 'First Aid', 'Meds', 'Manual', 'Overnight', 'Worker Screening']) {
      expect(screen.queryByRole('columnheader', { name }), name).not.toBeInTheDocument()
    }
  })

  // Platform review V2-B: Position no longer cuts "Senior support worker" at 7rem; it is in words now, so it gets the default cap.
  it('caps Region, not Position, and truncates the name link on the link itself with the full name in a tooltip', () => {
    renderPage()
    const row = screen.getByRole('link', { name: 'Alex Rivera' }).closest('tr')!
    expect(within(row).getByText('Coordinator')).not.toHaveStyle('--cell-max: 7rem')
    expect(within(row).getByText('North')).toHaveStyle('--cell-max: 7rem')
    const link = screen.getByRole('link', { name: 'Alex Rivera' })
    expect(link).toHaveClass('block', 'truncate', 'md:max-w-[11rem]')
    expect(link).toHaveAttribute('title', 'Alex Rivera')
  })
})

// Restoring from the Archived list is an update, and UpdateStaff replaces the whole record: the body must be the staff member's own fields (toUpdateStaffDto),
// not the raw list row, which carries list-only fields (id, fullName, username, ...) and nulls where the server wants nothing.
describe('StaffPage — restoring an archived staff member', () => {
  it('sends the staff record\'s fields with isActive true, and none of the list-only fields', async () => {
    const user = userEvent.setup()
    mockUseStaff.mockReturnValue({
      data: [makeStaff({ id: 's9', isActive: false, mobile: '0400 111 222', driverLicenceExpiryDate: '2027-03-01', isDriverEligible: true })],
      isLoading: false,
    })
    renderPage()

    await user.click(screen.getByRole('radio', { name: 'Archived' }))
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    // The row's Restore opens a confirmation whose own button is also named Restore (the last in the DOM).
    await user.click(screen.getAllByRole('button', { name: 'Restore' }).at(-1)!)

    expect(mockUpdateMutate).toHaveBeenCalledTimes(1)
    const { id, data } = mockUpdateMutate.mock.calls[0][0]
    expect(id).toBe('s9')
    expect(data).toMatchObject({
      firstName: 'Alex', lastName: 'Rivera', email: 'alex@example.com', role: 'SupportWorker', position: 'SupportWorker', region: 'North',
      mobile: '0400 111 222', isDriverEligible: true, driverLicenceExpiryDate: '2027-03-01', isActive: true,
    })
    expect(data.notes).toBeUndefined()
    for (const listOnly of ['id', 'fullName', 'username', 'hasExpiredQualifications']) expect(data).not.toHaveProperty(listOnly)
  })
})

// STAFF-3 (owner decision 2026-10-12): ReadOnly is refused every staff write, so it gets no New Staff, no row actions and no status pill.
describe('StaffPage — write controls by role', () => {
  it('shows ReadOnly the status as text, with no New Staff, Edit or Archive', () => {
    setUserRole('ReadOnly')
    renderPage()
    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    expect(within(row).getByText('Active')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Active/ })).not.toBeInTheDocument()
    expect(within(row).queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Archive/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /New staff member/ })).not.toBeInTheDocument()
  })

  it.each(['Admin', 'Coordinator'])('offers %s the status pill and New Staff', role => {
    setUserRole(role)
    renderPage()
    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    expect(within(row).getByRole('button', { name: /Active/ })).toBeEnabled()
    expect(screen.getByRole('link', { name: /New staff member/ })).toBeInTheDocument()
  })
})

// STAFF-4 and STAFF-5: a refused status change, archive or restore closes its dialog and says why above the table.
describe('StaffPage — refused writes are shown', () => {
  const refused = { response: { status: 403, data: { message: 'You do not have permission to do that.' } } }
  type Callbacks = { onError?: (e: unknown) => void; onSettled?: () => void }
  const refuse = (mutate: typeof mockUpdateMutate) => mutate.mockImplementation((_v: unknown, o?: Callbacks) => { o?.onError?.(refused); o?.onSettled?.() })

  it('closes the Mark inactive confirm and shows the server message when the change fails', async () => {
    const user = userEvent.setup()
    refuse(mockUpdateMutate)
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^active$/i }))
    await user.click(await screen.findByRole('option', { name: /inactive/i }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /mark inactive/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('You do not have permission to do that.')).toBeInTheDocument()
  })

  it('shows the server message when reactivating fails', async () => {
    const user = userEvent.setup()
    refuse(mockUpdateMutate)
    mockUseStaff.mockReturnValue({ data: [makeStaff({ id: 's3', fullName: 'Jamie Fox', isActive: false })], isLoading: false })
    renderPage()

    const row = screen.getByText('Jamie Fox').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^inactive$/i }))
    await user.click(await screen.findByRole('option', { name: /^active$/i }))

    expect(screen.getByText('You do not have permission to do that.')).toBeInTheDocument()
  })

  it('shows the server message when archiving fails', async () => {
    const user = userEvent.setup()
    refuse(mockDeleteMutate)
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Archive' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archive' }))

    expect(screen.getByText('You do not have permission to do that.')).toBeInTheDocument()
  })
})

// Platform review V2-B: the list printed the raw enum (SupportWorker).
describe('StaffPage — position label', () => {
  it('shows the position in words, and search finds it by those words', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Support worker')).toBeInTheDocument()
    expect(screen.queryByText('SupportWorker')).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/search staff/i), 'support worker')
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
  })
})

// Platform review V2-A (Staff 1): eight caps-labelled flag columns made each phone card ten labels long; one chip cell shows only what is true.
describe('StaffPage — Qualifications chips and the phone card', () => {
  it('shows only the qualifications a staff member holds, as chips, on desktop and phone alike', () => {
    mockUseStaff.mockReturnValue({
      data: [makeStaff({ id: 's1', fullName: 'Alex Rivera', isDriverEligible: true, isMedicationCompetent: true })],
      isLoading: false,
    })
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    const chips = within(row).getByRole('list', { name: 'Qualifications' })
    expect(within(chips).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Driver', 'Medication'])
  })

  it('leaves the cell empty for someone with none', () => {
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    expect(within(row).queryByRole('list', { name: 'Qualifications' })).not.toBeInTheDocument()
  })

  it('puts the name on the card title, the status pill beside it, and position, region and qualifications on the muted line', () => {
    mockUseStaff.mockReturnValue({ data: [makeStaff({ id: 's1', fullName: 'Alex Rivera', isDriverEligible: true })], isLoading: false })
    renderPage()

    expect(screen.getByRole('link', { name: 'Alex Rivera' }).closest('td')).toHaveAttribute('data-card', 'primary')
    expect(screen.getByRole('button', { name: /^active$/i }).closest('td')).toHaveAttribute('data-card', 'status')
    for (const text of ['Support worker', 'North', 'Driver']) expect(screen.getByText(text).closest('td'), text).toHaveAttribute('data-card', 'meta')
    // VC design review fix 2: the chips take a line of their own under the muted text.
    expect(screen.getByText('Driver').closest('td')).toHaveClass('max-md:basis-full')
  })
})

// Onboarding import (PR 3): the Staff page links to the staff import, as the Participants hub does to its own.
describe('StaffPage — import', () => {
  it('links an Admin to the staff import from the header, and not a Coordinator', () => {
    const { unmount } = renderPage()
    expect(screen.getByRole('link', { name: 'Import' })).toHaveAttribute('href', '/settings/import/staff')
    unmount()
    setUserRole('Coordinator')
    renderPage()
    expect(screen.queryByRole('link', { name: 'Import' })).toBeNull()
  })
})
