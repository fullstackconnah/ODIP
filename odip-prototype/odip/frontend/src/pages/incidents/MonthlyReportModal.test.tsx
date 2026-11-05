import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { RpReportLine } from '@/api/types/restrictive-practices'
import { MonthlyReportModal } from './MonthlyReportModal'

const { mockLodge, mockUndo } = vi.hoisted(() => ({ mockLodge: vi.fn(), mockUndo: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useLodgeRpReport: () => ({ mutateAsync: mockLodge, isPending: false }),
  useUndoRpReport: () => ({ mutateAsync: mockUndo, isPending: false }),
}))
vi.mock('@/hooks/useProviderToday', () => ({ useProviderToday: () => '2026-11-04' }))

function makeLine(overrides: Partial<RpReportLine> = {}): RpReportLine {
  return {
    restrictivePracticeId: 'rp-1', participantId: 'p-1', participantName: 'Alex Demo', practiceType: 'PhysicalRestraint',
    practiceDescription: 'Hands-on guiding', useKind: 'Routine', month: '2026-10-01', dueOn: '2026-11-06', dueCountedWithoutHolidays: false,
    state: 'Due', suggestedType: null, uses: [], report: null, ...overrides,
  }
}

const lodgedReport = {
  id: 'rep-1', reportType: 'NotUsed' as const, variedKind: null, variedAlsoUnauthorised: null, useCount: 0, note: 'Checked the log.',
  lodgedOn: '2026-09-03', lodgedByName: 'Sam Coordinator', createdAt: '2026-09-03T01:00:00Z',
}

function renderModal(line: RpReportLine | null, extra: { presetType?: 'Eliminated'; onClose?: () => void; onReload?: () => void } = {}) {
  const onClose = extra.onClose ?? vi.fn()
  const onReload = extra.onReload ?? vi.fn()
  render(<MemoryRouter><MonthlyReportModal line={line} presetType={extra.presetType} onClose={onClose} onReload={onReload} /></MemoryRouter>)
  return { onClose, onReload }
}

beforeEach(() => { mockLodge.mockReset(); mockUndo.mockReset() })

describe('MonthlyReportModal: lodging', () => {
  it('is closed with no line', () => {
    renderModal(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names the participant, practice and month, and says the portal comes first', () => {
    renderModal(makeLine())
    expect(screen.getByText(/Alex Demo · Physical restraint · October 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Lodge it in the NDIS Commission portal first, then record it here\. Bunya Support doesn't send it\./)).toBeInTheDocument()
  })

  it('refuses with the server sentences when nothing is chosen, and does not call the server', async () => {
    const user = userEvent.setup()
    renderModal(makeLine())
    await user.click(screen.getByRole('button', { name: 'Lodge report' }))
    expect(screen.getByText('Choose a report type.')).toBeInTheDocument()
    expect(mockLodge).not.toHaveBeenCalled()
  })

  it('asks for how the use was varied and whether it was unauthorised, only for varied use', async () => {
    const user = userEvent.setup()
    renderModal(makeLine())
    expect(screen.queryByText('How was the use varied?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Report type/ }))
    await user.click(screen.getByRole('option', { name: 'Varied use' }))
    expect(screen.getAllByText(/How was the use varied/).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Lodge report' }))
    expect(screen.getByText('Choose how the use was varied.')).toBeInTheDocument()
    expect(screen.getByText('Say whether the varied use was also unauthorised.')).toBeInTheDocument()
  })

  it('lists only the types that fit the use kind: Routine has no Uses reported, as needed has no Used as per plan', async () => {
    const user = userEvent.setup()
    renderModal(makeLine())
    await user.click(screen.getByRole('button', { name: /Report type/ }))
    expect(screen.queryByRole('option', { name: 'Uses reported' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Used as per plan' })).toBeInTheDocument()
  })

  it('lodges a routine report with no use count and the varied fields null', async () => {
    const user = userEvent.setup()
    mockLodge.mockResolvedValue({})
    const { onClose } = renderModal(makeLine())
    await user.click(screen.getByRole('button', { name: /Report type/ }))
    await user.click(screen.getByRole('option', { name: 'Not used' }))
    await user.click(screen.getByRole('button', { name: 'Lodge report' }))
    await waitFor(() => expect(mockLodge).toHaveBeenCalledTimes(1))
    expect(mockLodge.mock.calls[0][0]).toMatchObject({
      restrictivePracticeId: 'rp-1', month: '2026-10-01', reportType: 'NotUsed', variedKind: null, variedAlsoUnauthorised: null, note: null, lodgedOn: '2026-11-04',
    })
    expect(mockLodge.mock.calls[0][0]).not.toHaveProperty('useCount')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('refuses a lodged date in the future or before the month ends', async () => {
    const user = userEvent.setup()
    renderModal(makeLine())
    await user.click(screen.getByRole('button', { name: /Report type/ }))
    await user.click(screen.getByRole('option', { name: 'Not used' }))
    const date = screen.getByLabelText(/Lodged in the portal on/)
    await user.clear(date)
    await user.type(date, '2026-11-20')
    await user.click(screen.getByRole('button', { name: 'Lodge report' }))
    expect(screen.getByText("The lodged date can't be in the future.")).toBeInTheDocument()
    await user.clear(date)
    await user.type(date, '2026-10-20')
    await user.click(screen.getByRole('button', { name: 'Lodge report' }))
    expect(screen.getByText('The lodged date must be after the month ends.')).toBeInTheDocument()
    expect(mockLodge).not.toHaveBeenCalled()
  })

  it('starts an as-needed line on the suggested type and lists the uses, an incident use as a link', () => {
    renderModal(makeLine({
      useKind: 'Prn', practiceType: 'ChemicalRestraint', suggestedType: 'UsesReported',
      uses: [
        { localDateTime: '2026-10-12T14:30:00', incidentReportId: 'inc-1', medicationAdministrationId: null },
        { localDateTime: '2026-10-21T20:05:00', incidentReportId: null, medicationAdministrationId: 'med-1' },
      ],
    }))
    expect(screen.getByText('Uses in October 2026 (2)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mon 12 Oct 2026, 14:30' })).toHaveAttribute('href', '/incidents/inc-1')
    expect(screen.getByText('Wed 21 Oct 2026, 20:05')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Report type/ })).toHaveTextContent('Uses reported')
  })

  it('starts on the preset type from the deactivate prompt, and says no later months follow', () => {
    renderModal(makeLine(), { presetType: 'Eliminated' })
    expect(screen.getByRole('button', { name: /Report type/ })).toHaveTextContent('Eliminated')
    expect(screen.getByText(/No more monthly reports are listed for this practice after October 2026\./)).toBeInTheDocument()
  })

  it('shows a 409 as the already-lodged sentence with a Reload that refetches and closes', async () => {
    const user = userEvent.setup()
    mockLodge.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: {} } })
    const { onClose, onReload } = renderModal(makeLine())
    await user.click(screen.getByRole('button', { name: /Report type/ }))
    await user.click(screen.getByRole('option', { name: 'Not used' }))
    await user.click(screen.getByRole('button', { name: 'Lodge report' }))
    expect(await screen.findByText('This month has already been lodged. Reload to see it.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onReload).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

describe('MonthlyReportModal: viewing and undoing', () => {
  it('opens a lodged month read-only, with who recorded it and the note', () => {
    renderModal(makeLine({ month: '2026-08-01', state: 'Lodged', report: lodgedReport }))
    expect(screen.getByText('Monthly report, August 2026')).toBeInTheDocument()
    expect(screen.getByText('Not used')).toBeInTheDocument()
    expect(screen.getByText('Sam Coordinator')).toBeInTheDocument()
    expect(screen.getByText('Checked the log.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lodge report' })).not.toBeInTheDocument()
  })

  it('asks before undoing, says the month goes back to Overdue, and deletes the report', async () => {
    const user = userEvent.setup()
    mockUndo.mockResolvedValue(true)
    const { onClose } = renderModal(makeLine({ month: '2026-08-01', dueOn: '2026-09-04', state: 'Lodged', report: lodgedReport }))
    await user.click(screen.getByRole('button', { name: 'Undo lodging' }))
    expect(screen.getByText('Undo this lodged report?')).toBeInTheDocument()
    expect(screen.getByText('August 2026 goes back to Overdue in Bunya Support. Nothing changes in the NDIS Commission portal.')).toBeInTheDocument()
    expect(mockUndo).not.toHaveBeenCalled()
    await user.click(screen.getAllByRole('button', { name: 'Undo lodging' }).at(-1)!)
    await waitFor(() => expect(mockUndo).toHaveBeenCalledWith('rep-1'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('says Due, not Overdue, when the due date has not passed', async () => {
    const user = userEvent.setup()
    renderModal(makeLine({ month: '2026-10-01', dueOn: '2026-11-06', state: 'Lodged', report: lodgedReport }))
    await user.click(screen.getByRole('button', { name: 'Undo lodging' }))
    expect(screen.getByText(/October 2026 goes back to Due in Bunya Support\./)).toBeInTheDocument()
  })
})
