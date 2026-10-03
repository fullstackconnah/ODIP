import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeneratePatternDialog } from './GeneratePatternDialog'
import type { ShiftPatternDto } from '@/api/types'

const { mockGenerate } = vi.hoisted(() => ({ mockGenerate: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useGeneratePattern: () => ({ mutateAsync: mockGenerate, isPending: false }),
}))

const pattern: ShiftPatternDto = {
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
}

beforeEach(() => {
  mockGenerate.mockReset()
})

describe('GeneratePatternDialog buttons', () => {
  it('draws Cancel and Generate as Buttons at --control-h, not hand-rolled rounded-lg buttons', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<GeneratePatternDialog pattern={pattern} onClose={onClose} />)

    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const generate = screen.getByRole('button', { name: 'Generate' })
    for (const button of [cancel, generate]) {
      expect(button).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]')
      expect(button.className).not.toMatch(/rounded-lg|py-2/)
    }
    // Generate waits for a valid range, exactly as before.
    expect(generate).toBeDisabled()

    await user.click(cancel)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('generates for the chosen range and then offers a Done Button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockGenerate.mockResolvedValue({ created: 3, skipped: 1 })
    render(<GeneratePatternDialog pattern={pattern} onClose={onClose} />)

    await user.type(screen.getByLabelText(/from/i), '2026-09-14')
    await user.type(screen.getByLabelText(/^to/i), '2026-09-28')
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(mockGenerate).toHaveBeenCalledWith({ id: 'pattern-1', from: '2026-09-14', to: '2026-09-28' })
    const done = await screen.findByRole('button', { name: 'Done' })
    expect(done).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]')

    await user.click(done)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ── What "skipped" means ─────────────────────────────────────────────────────────────────────────
// The count now also holds the days an agreement's plan skips for a public holiday, so for an agreement pattern it cannot say they were all "already on the roster".
describe('GeneratePatternDialog — what skipped means', () => {
  const generateFor = async (shown: ShiftPatternDto) => {
    const user = userEvent.setup()
    mockGenerate.mockResolvedValue({ created: 3, skipped: 2 })
    render(<GeneratePatternDialog pattern={shown} onClose={vi.fn()} />)
    await user.type(screen.getByLabelText(/from/i), '2026-09-14')
    await user.type(screen.getByLabelText(/^to/i), '2026-09-28')
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByRole('button', { name: 'Done' })
  }

  it('says a hand-made pattern\'s skipped days were already on the roster', async () => {
    await generateFor(pattern)

    expect(screen.getByText(/already on the roster from this pattern\.$/)).toBeInTheDocument()
    expect(screen.queryByText(/public holiday/)).not.toBeInTheDocument()
  })

  it('says an agreement pattern\'s skipped days were on the roster already or a public holiday the agreement skips', async () => {
    await generateFor({ ...pattern, sourceDraftId: 'draft-2', sourceDraftVersion: 2 })

    expect(screen.getByText(/already on the roster from this pattern, or a public holiday the agreement skips\.$/)).toBeInTheDocument()
  })
})

// ── The server's refusal (readiness Enforce mode) ────────────────────────────────────────────────────────────────────
// A failed generate used to be an unhandled rejection: the dialog just sat there. In Enforce mode the API answers with a 400
// "Participant is not ready for booking or rostering."; that line has to be on screen, with the range the user picked kept.
const NOT_READY_MESSAGE = 'Participant is not ready for booking or rostering.'
const GENERIC_GENERATE_ERROR = 'Something went wrong generating these shifts. Please try again.'

describe('GeneratePatternDialog — the server\'s refusal reaches the user', () => {
  it('shows the server\'s own message, not the generic line, keeps the range, and sent the full request', async () => {
    const user = userEvent.setup()
    mockGenerate.mockRejectedValueOnce({ response: { status: 400, data: { success: false, errors: [NOT_READY_MESSAGE] } } })
    render(<GeneratePatternDialog pattern={pattern} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText(/from/i), '2026-09-14')
    await user.type(screen.getByLabelText(/^to/i), '2026-09-28')
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockGenerate).toHaveBeenCalledWith({ id: 'pattern-1', from: '2026-09-14', to: '2026-09-28' })
    const message = await screen.findByText(NOT_READY_MESSAGE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(screen.queryByText(GENERIC_GENERATE_ERROR)).not.toBeInTheDocument()
    // Still the "Generate shifts" step, with the range intact and the button usable again.
    expect(screen.queryByText('Shifts generated')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/from/i)).toHaveValue('2026-09-14')
    expect(screen.getByLabelText(/^to/i)).toHaveValue('2026-09-28')
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled()
  })

  it.each([
    ['a network failure with no response', new Error('Network Error')],
    ['a 500 with an empty body', { response: { status: 500, data: {} } }],
  ])('falls back to the generic line for %s', async (_label, failure) => {
    const user = userEvent.setup()
    mockGenerate.mockRejectedValueOnce(failure)
    render(<GeneratePatternDialog pattern={pattern} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText(/from/i), '2026-09-14')
    await user.type(screen.getByLabelText(/^to/i), '2026-09-28')
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText(GENERIC_GENERATE_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('clears the error when the user tries again, and a retry that works moves on to the result', async () => {
    const user = userEvent.setup()
    mockGenerate
      .mockRejectedValueOnce({ response: { status: 400, data: { success: false, errors: [NOT_READY_MESSAGE] } } })
      .mockResolvedValueOnce({ created: 2, skipped: 0 })
    render(<GeneratePatternDialog pattern={pattern} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText(/from/i), '2026-09-14')
    await user.type(screen.getByLabelText(/^to/i), '2026-09-28')
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('Shifts generated')).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
    expect(mockGenerate).toHaveBeenCalledTimes(2)
  })
})
