import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import IncidentsPage from './IncidentsPage'

const { mockUseRpLines, mockDownload } = vi.hoisted(() => ({ mockUseRpLines: vi.fn(), mockDownload: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useIncidents: () => ({ data: [], isLoading: false }),
  useOverdueQscIncidents: () => ({ data: [] }),
  useRestoreIncident: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteIncident: () => ({ mutate: vi.fn(), isPending: false }),
  useFlaggedShiftNotes: () => ({ data: [], isLoading: false }),
  useIncidentTrend: () => ({ data: undefined, isLoading: true, isError: false }),
  useRpMonthlyReportLines: mockUseRpLines,
  useLodgeRpReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUndoRpReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/downloadFile', () => ({ downloadFile: mockDownload }))
vi.mock('@/hooks/useProviderToday', () => ({ useProviderToday: () => '2026-11-04' }))

const line = (o: Record<string, unknown> = {}) => ({
  restrictivePracticeId: 'rp-1', participantId: 'p-1', participantName: 'Alex Demo', practiceType: 'PhysicalRestraint', practiceDescription: 'Hands-on guiding', useKind: 'Routine',
  month: '2026-10-01', dueOn: '2026-11-06', dueCountedWithoutHolidays: false, state: 'Due', suggestedType: null, uses: [], report: null, ...o,
})
const LINES = [
  line({ month: '2026-09-01', dueOn: '2026-10-06', state: 'Overdue' }),
  line(),
  line({ month: '2026-08-01', dueOn: '2026-09-04', state: 'Lodged', report: { id: 'r1', reportType: 'NotUsed', lodgedOn: '2026-09-03', lodgedByName: 'Sam', createdAt: '2026-09-03T00:00:00Z' } }),
]
const withLines = (data: unknown[], extra: Record<string, unknown> = {}) => mockUseRpLines.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn(), ...extra })

function renderPage(entry = '/incidents?view=rp-reports') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/incidents" element={<IncidentsPage />} /></Routes>
    </MemoryRouter>,
  )
}
const asRole = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1', role }))

beforeEach(() => {
  mockDownload.mockReset()
  asRole('Coordinator')
  withLines(LINES)
})
afterEach(() => localStorage.clear())

describe('IncidentsPage: RP monthly reports tab', () => {
  it('opens on the tab from ?view=rp-reports, with the to-lodge count in the tab and the header', () => {
    renderPage()
    expect(screen.getByRole('tab', { name: 'RP monthly reports (2)' })).toBeInTheDocument()
    expect(screen.getByText('2 to lodge')).toBeInTheDocument()
    expect(screen.getByText('September 2026')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Report incident/ })).not.toBeInTheDocument()
  })

  it('says All lodged when nothing is owed', () => {
    withLines([LINES[2]])
    renderPage()
    expect(screen.getByText('All lodged')).toBeInTheDocument()
  })

  it('drops the count from the tab label while loading, and from the header on an error', () => {
    mockUseRpLines.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderPage()
    expect(screen.getByRole('tab', { name: 'RP monthly reports' })).toBeInTheDocument()
    expect(screen.queryByText(/to lodge|All lodged/)).not.toBeInTheDocument()
  })

  it('requests the lines only for a role that lodges them, with an organisation', () => {
    renderPage()
    expect(mockUseRpLines).toHaveBeenCalledWith(undefined, { enabled: true })
  })

  it('shows no tab, and fires no request, for a ReadOnly role', () => {
    asRole('ReadOnly')
    renderPage('/incidents?view=rp-reports')
    expect(mockUseRpLines).toHaveBeenCalledWith(undefined, { enabled: false })
    expect(screen.queryByRole('tab', { name: /RP monthly reports/ })).not.toBeInTheDocument()
  })

  it('shows the choose-organisation state for a SuperAdmin with no organisation, with no request', () => {
    asRole('SuperAdmin')
    renderPage()
    expect(screen.getByText('Choose an organisation to view as first.')).toBeInTheDocument()
    expect(screen.getByText('Monthly reports belong to one organisation.')).toBeInTheDocument()
    expect(mockUseRpLines).toHaveBeenCalledWith(undefined, { enabled: false })
    // A disabled query is not 'loaded and empty': no count, no All lodged.
    expect(screen.getByRole('tab', { name: 'RP monthly reports' })).toBeInTheDocument()
    expect(screen.queryByText('All lodged')).not.toBeInTheDocument()
  })

  it('downloads the newest month as CSV when All months is picked', async () => {
    const user = userEvent.setup()
    mockDownload.mockResolvedValue(undefined)
    renderPage()
    await user.click(screen.getByRole('button', { name: /CSV for October 2026/ }))
    expect(mockDownload).toHaveBeenCalledWith('/restrictive-practice-reports/csv?month=2026-10-01', 'rp-monthly-reports-2026-10.csv')
  })

  it('narrows to a month and downloads that month', async () => {
    const user = userEvent.setup()
    mockDownload.mockResolvedValue(undefined)
    renderPage()
    await user.click(screen.getByRole('button', { name: /All months/ }))
    await user.click(screen.getByRole('option', { name: 'August 2026' }))
    expect(screen.queryByText('September 2026')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /CSV for August 2026/ }))
    expect(mockDownload).toHaveBeenCalledWith('/restrictive-practice-reports/csv?month=2026-08-01', 'rp-monthly-reports-2026-08.csv')
  })

  it('shows the download failure sentence', async () => {
    const user = userEvent.setup()
    mockDownload.mockRejectedValue(new Error("Couldn't download the file. Try again."))
    renderPage()
    await user.click(screen.getByRole('button', { name: /CSV for/ }))
    await waitFor(() => expect(screen.getByText("Couldn't download the file. Try again.")).toBeInTheDocument())
  })

  it('has no CSV button or month filter when there are no lines', () => {
    withLines([])
    renderPage()
    expect(screen.queryByRole('button', { name: /CSV for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /All months/ })).not.toBeInTheDocument()
  })

  it('defaults to the Reports tab with no view param', () => {
    renderPage('/incidents')
    expect(screen.queryByText('September 2026')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'RP monthly reports (2)' })).toBeInTheDocument()
  })
})
