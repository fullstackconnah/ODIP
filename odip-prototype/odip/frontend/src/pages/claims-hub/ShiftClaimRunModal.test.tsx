import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ClaimBudgetDto, ShiftClaimRunDto } from '@/api/types'
import { ShiftClaimRunModal } from './ShiftClaimRunModal'

// The claim run modal. The two hooks are mocked at the module; the mutate mocks answer synchronously with the fixture a test sets.

const m = vi.hoisted(() => ({
  preview: vi.fn(), run: vi.fn(), previewPending: { value: false }, runPending: { value: false },
}))
vi.mock('@/api/hooks/claims', () => ({
  usePreviewShiftClaimRun: () => ({ mutate: m.preview, isPending: m.previewPending.value }),
  useRunShiftClaims: () => ({ mutate: m.run, isPending: m.runPending.value }),
}))

const base: ShiftClaimRunDto = {
  from: '2026-10-19', to: '2026-11-01', claimsMade: 0, shiftCount: 3, hours: 18, totalAmount: 900,
  participants: [
    { participantId: 'p1', participantName: 'Sam Lee', shiftCount: 2, hours: 12, totalAmount: 600 },
    { participantId: 'p2', participantName: 'Wolfeschlegelsteinhausenbergerdorff Alexandra', shiftCount: 1, hours: 6, totalAmount: 300 },
  ],
  leftOut: [{ participantId: 'p1', participantName: 'Sam Lee', shiftId: 's9', serviceDate: '2026-10-20', description: 'Shift 22:00–06:00 · 8 h', reason: 'It is a sleepover.' }],
  flagged: [], skipped: [],
}
const made = (over: Partial<ShiftClaimRunDto> = {}): ShiftClaimRunDto => ({
  ...base, claimsMade: 2,
  participants: base.participants.map((p, i) => ({ ...p, claimId: `c${i}`, claimReference: `TC-${i}` })), ...over,
})

const answer = (fn: ReturnType<typeof vi.fn>, data: ShiftClaimRunDto) => fn.mockImplementation((_req, opts) => opts.onSuccess(data))
const fail = (fn: ReturnType<typeof vi.fn>, err: unknown) => fn.mockImplementation((_req, opts) => opts.onError(err))
const open = () => render(<MemoryRouter><ShiftClaimRunModal open onClose={vi.fn()} /></MemoryRouter>)

beforeEach(() => { m.preview.mockReset(); m.run.mockReset(); m.previewPending.value = false; m.runPending.value = false })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ShiftClaimRunModal', () => {
  it('asks the server for its default period, then shows the summary, the table and what is left out', () => {
    answer(m.preview, base)
    open()

    expect(m.preview).toHaveBeenCalledWith({}, expect.anything())
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-19')
    expect(screen.getByLabelText('To')).toHaveValue('2026-11-01')
    expect(screen.getByText('2 participants · 3 shifts · 18 hours')).toBeInTheDocument()
    expect(screen.getAllByText('$900.00').length).toBeGreaterThan(0)
    expect(screen.getByText('Wolfeschlegelsteinhausenbergerdorff Alexandra')).toBeInTheDocument()
    expect(screen.getByText('1 shift will be left out')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make 2 claims' })).toBeEnabled()
  })

  it('says it is looking while the first preview loads', () => {
    m.previewPending.value = true
    open()
    expect(screen.getByRole('status')).toHaveTextContent('Finding completed shifts…')
  })

  it('disables Make while the dates differ from the preview, until the preview is updated', async () => {
    answer(m.preview, base)
    open()

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-10' } })
    expect(screen.getByText('Update the preview to claim these dates.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make 2 claims' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Update preview' }))
    expect(m.preview).toHaveBeenLastCalledWith({ from: '2026-10-10', to: '2026-11-01' }, expect.anything())
  })

  it('says so when no completed shift is waiting', () => {
    answer(m.preview, { ...base, shiftCount: 0, hours: 0, totalAmount: 0, participants: [], leftOut: [] })
    open()

    expect(screen.getByText('No completed, unclaimed shifts between 19/10/2026 and 01/11/2026.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Make/ })).toBeNull()
  })

  it('says nothing can be claimed yet when every shift is left out', () => {
    answer(m.preview, { ...base, participants: [], shiftCount: 0, hours: 0, totalAmount: 0 })
    open()

    expect(screen.getByText('Nothing in this period can be claimed yet.')).toBeInTheDocument()
    expect(screen.getByText('1 shift will be left out')).toBeInTheDocument()
  })

  it('shows the whole run\'s budget warning above Make, and still lets it be made', () => {
    const budget: ClaimBudgetDto = { participants: [{ participantId: 'p1', participantName: 'Sam Lee', rows: [{ placement: 'Pool', poolName: 'Core', periodStart: '2026-07-01', periodEnd: '2027-06-30', available: 500, usedBefore: 100, thisClaim: 600, usedAfter: 700, leftAfter: -200, statusAfter: 'Over' }] }] }
    answer(m.preview, { ...base, budget })
    open()

    expect(screen.getByRole('button', { name: 'Make 2 claims' })).toBeEnabled()
    expect(screen.getByText('Budget')).toBeInTheDocument()
  })

  it('makes the claims, then lists each claim with a link and closes on Done', async () => {
    answer(m.preview, base)
    answer(m.run, made())
    const onClose = vi.fn()
    render(<MemoryRouter><ShiftClaimRunModal open onClose={onClose} /></MemoryRouter>)

    await userEvent.click(screen.getByRole('button', { name: 'Make 2 claims' }))

    expect(m.run).toHaveBeenCalledWith({ from: '2026-10-19', to: '2026-11-01' }, expect.anything())
    expect(screen.getByRole('dialog', { name: 'Claims made' })).toBeInTheDocument()
    expect(screen.getByText('Made 2 claims for $900.00 from 3 shifts.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'TC-0' })).toHaveAttribute('href', '/claims/c0')
    expect(screen.getByText('1 shift was left out')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('names a participant whose claim failed, and says the others are saved', async () => {
    answer(m.preview, base)
    answer(m.run, made({ claimsMade: 1, participants: made().participants.slice(0, 1), skipped: [{ participantId: 'p3', participantName: 'Jo Park', failed: true, reason: "This claim couldn't be made, so nothing was saved for this participant." }] }))
    open()

    await userEvent.click(screen.getByRole('button', { name: 'Make 2 claims' }))

    const callout = screen.getByText("1 claim couldn't be made").closest('[role="alert"]') as HTMLElement
    expect(callout).toHaveTextContent("Jo Park: This claim couldn't be made")
    expect(within(callout).getByText('The claims above are saved.')).toBeInTheDocument()
    expect(screen.getByText('Made 1 claim for $900.00 from 3 shifts.')).toBeInTheDocument()
  })

  it('says no claims were made when every participant failed, and leaves out the saved line', async () => {
    answer(m.preview, base)
    answer(m.run, made({ claimsMade: 0, participants: [], skipped: [{ participantId: 'p1', participantName: 'Sam Lee', failed: true, reason: 'Nothing was saved.' }] }))
    open()

    await userEvent.click(screen.getByRole('button', { name: 'Make 2 claims' }))

    expect(screen.getByText('No claims were made.')).toBeInTheDocument()
    expect(screen.queryByText('The claims above are saved.')).toBeNull()
  })

  it('shows a failed preview with Try again, which sends the request again', async () => {
    fail(m.preview, new Error('network'))
    open()

    expect(screen.getByText("Couldn't load the preview. Check your connection and try again.")).toBeInTheDocument()
    answer(m.preview, base)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(m.preview).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Make 2 claims' })).toBeInTheDocument()
  })

  it('shows a failed run with the safe-to-retry sentence', async () => {
    answer(m.preview, base)
    fail(m.run, new Error('network'))
    open()

    await userEvent.click(screen.getByRole('button', { name: 'Make 2 claims' }))

    expect(screen.getByText(/anything already claimed won't be claimed twice/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('cannot be closed while the claims are being made', () => {
    answer(m.preview, base)
    m.runPending.value = true
    open()

    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Claiming…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Making 2 claims…')
  })
})
