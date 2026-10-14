import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render as renderInDom, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PatternSlideOver } from './PatternSlideOver'
import type { ShiftPatternDto } from '@/api/types'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'

// The panel links to the agreement page (Open the agreement, Open the revision), so every render is inside a router.
const render = (ui: ReactElement) => renderInDom(ui, { wrapper: MemoryRouter })

const { mockCreateMutateAsync, mockUpdateMutateAsync, mockDeleteMutateAsync, mockChangeMutateAsync } = vi.hoisted(() => ({
  mockChangeMutateAsync: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — FormField, Dropdown, SearchableSelect, ConfirmDialog are the
// real components, so this exercises the actual Default staff field wiring.
vi.mock('@/api/hooks', () => ({
  useCreatePattern: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdatePattern: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeletePattern: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
  usePatternChange: () => ({ mutateAsync: mockChangeMutateAsync, isPending: false }),
}))

function noop() {}

function makePattern(overrides: Partial<ShiftPatternDto> = {}): ShiftPatternDto {
  return {
    id: 'pattern-1',
    participantId: 'participant-1',
    participantName: 'Mia Chen',
    defaultStaffId: 'staff-1',
    defaultStaffName: 'Alex Rivera',
    dayOfWeek: 'Monday',
    startTime: '09:00:00',
    endTime: '17:00:00',
    endsNextDay: false,
    ratio: 'OneToOne',
    nightType: 'None',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true,
    notes: null,
    ...overrides,
  }
}

const participantOptions = [{ value: 'participant-1', label: 'Mia Chen' }]
const staffOptions = [
  { value: 'staff-1', label: 'Alex Rivera' },
  { value: 'staff-2', label: 'Jordan Smith' },
  { value: 'staff-3', label: 'Bianca Novak' },
]

beforeEach(() => {
  mockCreateMutateAsync.mockClear()
  mockUpdateMutateAsync.mockClear()
  mockDeleteMutateAsync.mockClear()
  mockChangeMutateAsync.mockReset()
})

describe('PatternSlideOver Default staff field — SearchableSelect (DS-01/UX-01 migration)', () => {
  it('renders the field as a combobox showing the current default staff label', () => {
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern() }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    expect(field).toHaveValue('Alex Rivera')
  })

  it('shows "Unassigned" as the first option and current value when no default staff is set', async () => {
    const user = userEvent.setup()
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern({ defaultStaffId: null, defaultStaffName: null }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    expect(field).toHaveValue('Unassigned')

    await user.click(field)
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Unassigned')
    expect(options).toHaveLength(4)
  })

  it('narrows the option list as the user types', async () => {
    const user = userEvent.setup()
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern({ defaultStaffId: null, defaultStaffName: null }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    await user.click(field)
    await user.type(field, 'bianca')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Bianca Novak')
  })

  it('selects a new default staff member by clicking an option, and saves it', async () => {
    const user = userEvent.setup()
    mockUpdateMutateAsync.mockResolvedValue(undefined)
    const pattern = makePattern({ defaultStaffId: null, defaultStaffName: null })
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    await user.click(field)
    await user.click(screen.getByRole('option', { name: 'Jordan Smith' }))

    expect(field).toHaveValue('Jordan Smith')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: pattern.id,
      data: expect.objectContaining({ defaultStaffId: 'staff-2' }),
    }))
  })

  it('selects via keyboard (arrow down + enter)', async () => {
    const user = userEvent.setup()
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern({ defaultStaffId: null, defaultStaffName: null }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    await user.click(field)
    // Unassigned, Alex Rivera, Jordan Smith, Bianca Novak — three ArrowDowns lands on Jordan Smith.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')

    expect(field).toHaveValue('Jordan Smith')
    expect(field).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape closes the popup and discards an unsubmitted query, keeping the prior selection', async () => {
    const user = userEvent.setup()
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern() }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    expect(field).toHaveValue('Alex Rivera')

    await user.click(field)
    await user.type(field, 'nomatch')
    expect(screen.getByText('No results found')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(field).toHaveAttribute('aria-expanded', 'false')
    expect(field).toHaveValue('Alex Rivera')
  })

  it('is disabled when canWrite is false', () => {
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern() }}
        onClose={noop}
        canWrite={false}
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Default staff' })).toBeDisabled()
  })
})

// ── The server's refusal (readiness Enforce mode) ────────────────────────────────────────────────────────────────────
// In Enforce mode the API answers a pattern write for a participant who is not ready with a 400 carrying
// "Participant is not ready for booking or rostering." The panel used to swallow it behind a generic line.
const NOT_READY_MESSAGE = 'Participant is not ready for booking or rostering.'
const GENERIC_PATTERN_ERROR = 'Something went wrong saving this pattern. Please try again.'

/** What axios rejects with for a 400 carrying the API's ApiResponse envelope. */
function badRequest(...errors: string[]) {
  return { response: { status: 400, data: { success: false, errors } } }
}

describe('PatternSlideOver — the server\'s refusal reaches the user', () => {
  it('edit: shows the server\'s own message, not the generic line, keeps the edited values, and sent the full body', async () => {
    const user = userEvent.setup()
    mockUpdateMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    const onClose = vi.fn()
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern() }}
        onClose={onClose}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.type(screen.getByLabelText('Notes'), 'Fortnightly review')
    await user.click(screen.getByLabelText('Ends the next day'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
      id: 'pattern-1',
      data: {
        participantId: 'participant-1',
        defaultStaffId: 'staff-1',
        dayOfWeek: 'Monday',
        startTime: '09:00',
        endTime: '17:00',
        endsNextDay: true,
        ratio: 'OneToOne',
        nightType: 'None',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
        notes: 'Fortnightly review',
      },
    })
    const message = await screen.findByText(NOT_READY_MESSAGE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(screen.queryByText(GENERIC_PATTERN_ERROR)).not.toBeInTheDocument()
    // The panel stays open and the form is as the user left it.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Notes')).toHaveValue('Fortnightly review')
    expect(screen.getByLabelText('Ends the next day')).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('create: shows the server\'s own message and sent the full body', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    render(
      <PatternSlideOver
        target={{ mode: 'create' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByLabelText(/^participant/i))
    await user.click(screen.getByRole('option', { name: 'Mia Chen' }))
    await user.type(screen.getByLabelText(/effective from/i), '2026-10-05')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      defaultStaffId: null,
      dayOfWeek: 'Monday',
      startTime: '09:00',
      endTime: '10:00',
      endsNextDay: false,
      ratio: 'OneToOne',
      nightType: 'None',
      effectiveFrom: '2026-10-05',
      effectiveTo: null,
      isActive: true,
      notes: null,
    })
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(GENERIC_PATTERN_ERROR)).not.toBeInTheDocument()
  })

  it.each([
    ['a network failure with no response', new Error('Network Error')],
    ['a 500 with an empty body', { response: { status: 500, data: {} } }],
  ])('falls back to the generic line for %s', async (_label, failure) => {
    const user = userEvent.setup()
    mockUpdateMutateAsync.mockRejectedValueOnce(failure)
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern() }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(GENERIC_PATTERN_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })
})

describe('PatternSlideOver as a dialog', () => {
  const props = { canWrite: true, participantOptions, staffOptions }

  it('is a modal dialog named "New pattern" or "Edit pattern"', () => {
    const { unmount } = render(<PatternSlideOver {...props} target={{ mode: 'create' }} onClose={noop} />)
    expect(screen.getByRole('dialog', { name: 'New pattern' })).toHaveAttribute('aria-modal', 'true')
    unmount()
    render(<PatternSlideOver {...props} target={{ mode: 'edit', pattern: makePattern() }} onClose={noop} />)
    expect(screen.getByRole('dialog', { name: 'Edit pattern' })).toBeInTheDocument()
  })

  it('Escape closes an untouched panel straight away', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PatternSlideOver {...props} target={{ mode: 'edit', pattern: makePattern() }} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape after an edit asks before closing; Keep editing keeps the edit', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PatternSlideOver {...props} target={{ mode: 'edit', pattern: makePattern() }} onClose={onClose} />)
    await user.type(screen.getByLabelText('Notes'), 'Fortnightly')
    await user.keyboard('{Escape}')
    const prompt = screen.getByRole('alertdialog', { name: 'Discard changes?' })
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(prompt).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('dialog', { name: 'Edit pattern' })).toBeInTheDocument()
    expect(screen.getByLabelText('Notes')).toHaveValue('Fortnightly')
  })

  it('Delete opens a confirm dialog; Escape closes only that dialog and leaves the panel open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PatternSlideOver {...props} target={{ mode: 'edit', pattern: makePattern() }} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete pattern' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit pattern' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
  })
})

// Agreement PR 1: a pattern an approved agreement made changes through the agreement. A new day, time, ratio or night type is checked and priced, then saved as the next revision for approval; the
// pattern changes only when that revision is approved. Its dates are the agreement's. Default staff and notes are the coordinator's own and save on the pattern, as before.
describe('PatternSlideOver — a pattern an agreement made', () => {
  const agreementPattern = (overrides: Partial<ShiftPatternDto> = {}) => makePattern({
    sourceDraftId: 'draft-2', sourceBlockKey: 'mornings', sourceDraftVersion: 2, workerSlot: 1, notes: 'From agreement v2: Community access, community',
    effectiveFrom: '2026-10-12', effectiveTo: '2026-12-20', requirements: { workerGender: 'Female', driver: true, skills: ['FirstAid'] }, ...overrides,
  })
  const checked = { version: 3, agreementStartDate: '2026-10-19', agreementEndDate: '2026-12-20', oldTotal: 7358, newTotal: 7725.9, difference: 367.9, needsReview: false }
  const PRICE = "Price from Mon 19 Oct 2026 to Sun 20 Dec 2026: $7,358.00 as it is at today's prices, $7,725.90 with the change (+$367.90)."
  const STORED = {
    participantId: 'participant-1', defaultStaffId: 'staff-1', dayOfWeek: 'Monday', startTime: '09:00', endTime: '17:00', endsNextDay: false, ratio: 'OneToOne', nightType: 'None',
    effectiveFrom: '2026-10-12', effectiveTo: '2026-12-20', isActive: true,
  }

  const open = (pattern: ShiftPatternDto | null, blockDays?: string[]) => render(
    <PatternSlideOver target={pattern ? { mode: 'edit', pattern } : { mode: 'create' }} onClose={noop} canWrite participantOptions={participantOptions} staffOptions={staffOptions} blockDays={blockDays} />,
  )
  /** A start an hour later, from Monday 19 October: the change the tests check and create. */
  const startLater = () => {
    fireEvent.change(screen.getByLabelText(/Start time/), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText(/Change starts/), { target: { value: '2026-10-19' } })
  }
  const body = (preview: boolean, allDays = false) => ({
    participantId: 'participant-1', draftId: 'draft-2',
    data: { patternId: 'pattern-1', dayOfWeek: 'Monday', startTime: '10:00', endTime: '17:00', endsNextDay: false, ratio: 'OneToOne', nightType: 'None', allDays, fromDate: '2026-10-19', preview },
  })

  it('opens with a quiet line that says where it came from, its dates read-only and no Delete: it ends through the agreement', () => {
    open(agreementPattern())

    expect(screen.getByRole('status')).toHaveTextContent('From agreement v2.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Effective from/)).toBeDisabled()
    expect(screen.getByLabelText(/Effective to/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it.each([
    ['the start time', () => fireEvent.change(screen.getByLabelText(/Start time/), { target: { value: '10:00' } })],
    ['the end time', () => fireEvent.change(screen.getByLabelText(/End time/), { target: { value: '18:00' } })],
  ])("a change to %s shows the notice in the agreement's words and offers Check the change", (_, change) => {
    open(agreementPattern())

    change()
    fireEvent.change(screen.getByLabelText(/Change starts/), { target: { value: '2026-10-19' } })

    expect(screen.getByText('This changes the service agreement. Saving creates revision v3 from Mon 19 Oct 2026, re-priced, for approval.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check the change' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByText(/the roster will differ/)).not.toBeInTheDocument()                 // the old drift warning is gone
  })

  it('takes the notice back when the change is put back', () => {
    open(agreementPattern())

    fireEvent.change(screen.getByLabelText(/Start time/), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText(/Start time/), { target: { value: '09:00' } })

    expect(screen.queryByText(/This changes the service agreement/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('From agreement v2.')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })


  it('notes alone save on the pattern as before, with no notice and no revision', async () => {
    const user = userEvent.setup()
    mockUpdateMutateAsync.mockResolvedValue({})
    open(agreementPattern())

    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Ring the bell twice' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'pattern-1', data: { ...STORED, notes: 'Ring the bell twice' } })
    expect(mockChangeMutateAsync).not.toHaveBeenCalled()
  })

  it('Check the change asks the server with every field and preview, then shows the price and offers Create revision v3', async () => {
    const user = userEvent.setup()
    mockChangeMutateAsync.mockResolvedValueOnce(checked)
    open(agreementPattern())

    startLater()
    await user.click(screen.getByRole('button', { name: 'Check the change' }))

    expect(mockChangeMutateAsync).toHaveBeenCalledWith(body(true))
    expect(await screen.findByText(PRICE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create revision v3' })).toBeEnabled()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
  })

  it('Create revision saves it, says so with its price, offers Open the revision, and leaves the pattern as it is', async () => {
    const user = userEvent.setup()
    mockChangeMutateAsync.mockResolvedValueOnce(checked).mockResolvedValueOnce({ ...checked, draftId: 'draft-3' })
    open(agreementPattern())

    startLater()
    await user.click(screen.getByRole('button', { name: 'Check the change' }))
    await user.click(await screen.findByRole('button', { name: 'Create revision v3' }))

    expect(mockChangeMutateAsync).toHaveBeenLastCalledWith(body(false))
    expect(await screen.findByText('Revision v3 saved')).toBeInTheDocument()
    expect(screen.getByText(`It starts on Mon 19 Oct 2026. ${PRICE} The pattern and the roster change when it is approved.`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the revision' })).toHaveAttribute('href', '/participants/participant-1/agreement-draft')
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
  })

  it('a change after a check asks for a new check: the price was for what was checked', async () => {
    const user = userEvent.setup()
    mockChangeMutateAsync.mockResolvedValueOnce(checked)
    open(agreementPattern())

    startLater()
    await user.click(screen.getByRole('button', { name: 'Check the change' }))
    await screen.findByText(PRICE)
    fireEvent.change(screen.getByLabelText(/End time/), { target: { value: '16:00' } })

    expect(screen.queryByText(PRICE)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check the change' })).toBeInTheDocument()
  })

  it('a mixed edit saves the notes with the stored times, then the change; a refused change keeps every value', async () => {
    const user = userEvent.setup()
    const conflict = { response: { status: 409, data: { success: false, code: 'draft-version-conflict', data: { currentVersion: 3 }, errors: ['This agreement has a newer revision, v3. Open the agreement and make the change there.'] } } }
    mockUpdateMutateAsync.mockResolvedValue({})
    mockChangeMutateAsync.mockResolvedValueOnce(checked).mockRejectedValueOnce(conflict)
    open(agreementPattern())

    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Ring the bell twice' } })
    startLater()
    await user.click(screen.getByRole('button', { name: 'Check the change' }))
    await user.click(await screen.findByRole('button', { name: 'Create revision v3' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'pattern-1', data: { ...STORED, notes: 'Ring the bell twice' } })
    expect(mockChangeMutateAsync).toHaveBeenLastCalledWith(body(false))
    expect(mockUpdateMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(mockChangeMutateAsync.mock.invocationCallOrder[1])   // the notes first, then the revision
    expect(await screen.findByText('This agreement has a newer revision, v3. Open the agreement and make the change there.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Start time/)).toHaveValue('10:00')
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Ring the bell twice')
    expect(screen.getByLabelText(/Change starts/)).toHaveValue('2026-10-19')
    expect(screen.queryByText('Revision v3 saved')).not.toBeInTheDocument()
  })


  it("a refused check shows the server's words and keeps the edits", async () => {
    const user = userEvent.setup()
    mockChangeMutateAsync.mockRejectedValueOnce(badRequest('A change cannot start before today (2026-10-20).'))
    open(agreementPattern())

    startLater()
    await user.click(screen.getByRole('button', { name: 'Check the change' }))

    expect(await screen.findByText('A change cannot start before today (2026-10-20).')).toBeInTheDocument()
    expect(screen.getByLabelText(/Start time/)).toHaveValue('10:00')
    expect(screen.getByRole('button', { name: 'Check the change' })).toBeEnabled()
  })

  it('offers every day of the support only for a block of several days, and sends it as allDays', async () => {
    const user = userEvent.setup()
    mockChangeMutateAsync.mockResolvedValueOnce(checked)
    const { unmount } = open(agreementPattern(), ['Monday'])
    fireEvent.change(screen.getByLabelText(/Start time/), { target: { value: '10:00' } })
    expect(screen.queryByLabelText(/Change every day/)).not.toBeInTheDocument()
    unmount()

    open(agreementPattern(), ['Monday', 'Wednesday', 'Friday'])
    startLater()
    await user.click(screen.getByLabelText('Change every day of this support (Mon, Wed, Fri)'))
    await user.click(screen.getByRole('button', { name: 'Check the change' }))

    expect(mockChangeMutateAsync).toHaveBeenCalledWith(body(true, true))
  })

  it('starts a change to an agreement that has not begun on its first day, and says "a new revision" when the version is not known', () => {
    open(agreementPattern({ effectiveFrom: '2099-01-05', effectiveTo: null, sourceDraftVersion: undefined }))
    expect(screen.getByRole('status')).toHaveTextContent('From an agreement.')                   // a version it does not know is never made up

    fireEvent.change(screen.getByLabelText(/Start time/), { target: { value: '10:00' } })

    expect(screen.getByLabelText(/Change starts/)).toHaveValue('2099-01-05')
    expect(screen.getByText('This changes the service agreement. Saving creates a new revision from Mon 5 Jan 2099, re-priced, for approval.')).toBeInTheDocument()
  })

  it('says nothing of the kind about a hand-made pattern, or when making a new one, and a hand-made one keeps Delete', () => {
    const { unmount } = open(makePattern())
    expect(screen.queryByText(/From agreement|From an agreement|This changes the service agreement/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    unmount()

    open(null)
    expect(screen.queryByText(/From agreement|From an agreement/)).not.toBeInTheDocument()
  })

  it('shows what the agreement asks of a worker as chips, which are information and not a field to change', () => {
    open(agreementPattern())

    const chips = within(screen.getByRole('list', { name: 'Asks for' }))
    expect(chips.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Female worker', 'Driver', 'First aid'])
  })

  it('brings the notice into view when it appears, and a refused check: both can be far from the field that caused them', async () => {
    const user = userEvent.setup()
    const scrolled: string[] = []
    // jsdom has no scrollIntoView: put one in for this test and take it out again.
    const proto = Element.prototype as { scrollIntoView?: (arg?: boolean | ScrollIntoViewOptions) => void }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
      scrolled.push(this.textContent ?? '')
      expect(arg).toEqual({ block: 'nearest' })
    }
    try {
      mockChangeMutateAsync.mockRejectedValueOnce(badRequest('A change cannot start before today (2026-10-20).'))
      open(agreementPattern())
      expect(scrolled).toHaveLength(0)                                                        // nothing changed yet: nothing to show

      startLater()
      expect(scrolled).toHaveLength(1)
      expect(scrolled[0]).toMatch(/This changes the service agreement/)
      fireEvent.change(screen.getByLabelText(/End time/), { target: { value: '16:00' } })      // already there: the panel is left where it is
      expect(scrolled).toHaveLength(1)

      await user.click(screen.getByRole('button', { name: 'Check the change' }))
      await screen.findByText('A change cannot start before today (2026-10-20).')
      expect(scrolled.at(-1)).toBe('A change cannot start before today (2026-10-20).')
    } finally {
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
  })
})

// ── The length of a pattern's shift (phase 3 review N2): the same rule as the shift panel ─────────────────────────────
describe('PatternSlideOver — the length of the shift it makes', () => {
  const NO_LENGTH = "The shift must end after it starts. Tick 'Ends the next day' for an overnight shift."
  const endTimeField = () => screen.getByLabelText(/^End time/)
  const openNew = () => render(<PatternSlideOver target={{ mode: 'create' }} onClose={noop} canWrite participantOptions={participantOptions} staffOptions={staffOptions} />)

  it('opens a new pattern with an end an hour after the start, and no alert', () => {
    openNew()

    expect(screen.getByLabelText(/^Start time/)).toHaveValue('09:00')
    expect(endTimeField()).toHaveValue('10:00')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says under End time, as the field’s own error, when the end is at or before the start, and not once the next day is ticked', async () => {
    const user = userEvent.setup()
    openNew()

    await user.clear(endTimeField())
    await user.type(endTimeField(), '09:00')

    expect(await screen.findByText(NO_LENGTH)).toBeInTheDocument()
    expect(endTimeField()).toBeInvalid()
    expect(endTimeField()).toHaveAccessibleDescription(NO_LENGTH)

    await user.click(screen.getByLabelText('Ends the next day'))

    expect(screen.queryByText(NO_LENGTH)).not.toBeInTheDocument()
  })

  it('shows the server’s 400 for no length under End time too, not in the alert at the foot, and clears it when the time is fixed', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockRejectedValueOnce(badRequest(NO_LENGTH))
    openNew()
    await user.click(screen.getByLabelText(/^participant/i))
    await user.click(screen.getByRole('option', { name: 'Mia Chen' }))
    await user.type(screen.getByLabelText(/effective from/i), '2026-10-05')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(NO_LENGTH)).toBeInTheDocument()
    expect(endTimeField()).toHaveAccessibleDescription(NO_LENGTH)
    expect(screen.getAllByRole('alert').every(alert => alert.tagName === 'P')).toBe(true)

    await user.clear(endTimeField())
    await user.type(endTimeField(), '11:00')

    expect(screen.queryByText(NO_LENGTH)).not.toBeInTheDocument()
  })

  it('recognises the server’s 400 for no length by its code, whatever the words, and says the server’s words under End time', async () => {
    const REWORDED = 'Pick an end time that is after the start time.'
    const user = userEvent.setup()
    mockCreateMutateAsync.mockRejectedValueOnce({ response: { status: 400, data: { success: false, errors: [REWORDED], code: 'shift-no-length' } } })
    openNew()
    await user.click(screen.getByLabelText(/^participant/i))
    await user.click(screen.getByRole('option', { name: 'Mia Chen' }))
    await user.type(screen.getByLabelText(/effective from/i), '2026-10-05')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(REWORDED)).toBeInTheDocument()
    expect(endTimeField()).toBeInvalid()
    expect(endTimeField()).toHaveAccessibleDescription(REWORDED)
    expect(screen.getAllByRole('alert').every(alert => alert.tagName === 'P')).toBe(true)

    await user.clear(endTimeField())
    await user.type(endTimeField(), '11:00')

    expect(screen.queryByText(REWORDED)).not.toBeInTheDocument()
  })
})
