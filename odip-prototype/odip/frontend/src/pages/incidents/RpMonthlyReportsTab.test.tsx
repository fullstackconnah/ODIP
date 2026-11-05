import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { RpReportLine } from '@/api/types/restrictive-practices'
import { RpMonthlyReportsTab, rpMonths, rpToLodge } from './RpMonthlyReportsTab'

vi.mock('@/api/hooks', () => ({
  useLodgeRpReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUndoRpReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useProviderToday', () => ({ useProviderToday: () => '2026-11-04' }))

function line(o: Partial<RpReportLine> = {}): RpReportLine {
  return {
    restrictivePracticeId: 'rp-1', participantId: 'p-1', participantName: 'Alex Demo', practiceType: 'PhysicalRestraint',
    practiceDescription: 'Hands-on guiding', useKind: 'Routine', month: '2026-10-01', dueOn: '2026-11-06', dueCountedWithoutHolidays: false,
    state: 'Due', suggestedType: null, uses: [], report: null, ...o,
  }
}
const report = { id: 'rep-1', reportType: 'NotUsed' as const, variedKind: null, variedAlsoUnauthorised: null, useCount: 0, note: null, lodgedOn: '2026-09-03', lodgedByName: 'Sam Coordinator', createdAt: '2026-09-03T01:00:00Z' }

const LINES = [
  line({ month: '2026-09-01', dueOn: '2026-10-06', state: 'Overdue' }),
  line({ month: '2026-10-01' }),
  line({ month: '2026-08-01', dueOn: '2026-09-04', state: 'Lodged', report }),
  line({ restrictivePracticeId: 'rp-2', participantId: 'p-2', participantName: 'Jordan Demo', practiceType: 'ChemicalRestraint', useKind: 'Prn', month: '2026-10-01', uses: [{ localDateTime: '2026-10-12T14:30:00', incidentReportId: null, medicationAdministrationId: 'm1' }] }),
]

function renderTab(props: Partial<Parameters<typeof RpMonthlyReportsTab>[0]> = {}) {
  return render(
    <MemoryRouter>
      <RpMonthlyReportsTab lines={LINES} month="" isLoading={false} isError={false} onRetry={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

describe('rp worklist helpers', () => {
  it('counts only the lines still to lodge', () => expect(rpToLodge(LINES)).toBe(3))
  it('lists each month once, newest first', () => expect(rpMonths(LINES)).toEqual(['2026-10-01', '2026-09-01', '2026-08-01']))
})

describe('RpMonthlyReportsTab', () => {
  it('keeps the server order and shows a status, participant, due date and an action on each row', () => {
    renderTab()
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Overdue')
    expect(rows[0]).toHaveTextContent('September 2026')
    expect(rows[0]).toHaveTextContent('06/10/2026')
    expect(within(rows[0]).getByRole('button', { name: 'Lodge the September 2026 report for Alex Demo' })).toBeInTheDocument()
    expect(within(rows[2]).getByRole('button', { name: 'View the August 2026 report for Alex Demo' })).toBeInTheDocument()
  })

  it('links the participant to their record', () => {
    renderTab()
    expect(screen.getAllByRole('link', { name: 'Alex Demo' })[0]).toHaveAttribute('href', '/participants/p-1')
  })

  it('narrows to the chosen month', () => {
    renderTab({ month: '2026-08-01' })
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1)
  })

  it('says the due date counts weekends only when the holiday list is missing', () => {
    renderTab({ lines: [line({ dueCountedWithoutHolidays: true })] })
    expect(screen.getByText(/weekends only/)).toHaveAttribute('title', 'No holiday list for this year yet; weekends only.')
  })

  it('opens the lodge dialog from Lodge and the read-only one from View', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: 'Lodge the September 2026 report for Alex Demo' }))
    expect(screen.getByText('Lodge monthly report')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'View the August 2026 report for Alex Demo' }))
    expect(screen.getByText('Monthly report, August 2026')).toBeInTheDocument()
  })

  it('shows the empty state only for a loaded, empty list', () => {
    renderTab({ lines: [] })
    expect(screen.getByText('No monthly reports yet.')).toBeInTheDocument()
  })

  it('shows no empty state while loading or after an error, and offers a retry on error', async () => {
    const onRetry = vi.fn()
    renderTab({ lines: [], isError: true, onRetry })
    expect(screen.queryByText('No monthly reports yet.')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /retry|try again/i }))
    expect(onRetry).toHaveBeenCalled()
  })
})
