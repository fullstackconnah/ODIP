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
