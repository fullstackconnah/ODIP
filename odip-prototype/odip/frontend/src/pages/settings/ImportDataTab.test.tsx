import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ImportDataTab from './ImportDataTab'
import type { ImportBatchDto } from '@/api/types'

const { history, undoMutate, templateMutate, undoState, invites, providerSettings } = vi.hoisted(() => ({
  providerSettings: { current: undefined as { employmentHeroConnected?: boolean } | undefined },
  invites: vi.fn(),
  history: { current: [] as ImportBatchDto[] },
  undoMutate: vi.fn(),
  templateMutate: vi.fn(),
  undoState: { current: { isPending: false, error: null as unknown } },
}))

vi.mock('@/api/hooks', () => ({
  useImportHistory: () => ({ data: history.current, isLoading: false, isError: false, refetch: vi.fn() }),
  useUndoImport: () => ({ mutate: undoMutate, ...undoState.current }),
  useDownloadImportTemplate: () => ({ mutate: templateMutate, isPending: false }),
  useImportInvites: () => ({ mutateAsync: invites, isPending: false }),
  useProviderSettings: () => ({ data: providerSettings.current }),
}))

const batch = (overrides: Partial<ImportBatchDto> = {}): ImportBatchDto => ({
  id: 'b1', kind: 'Participants', fileName: 'people.csv', createdByName: 'Ada Admin', createdAt: '2026-10-13T01:00:00Z',
  rowCount: 3, createdCount: 2, skippedCount: 1, failedCount: 0, undoneAt: null, undoneByName: null, ...overrides,
})

const renderTab = () => render(<MemoryRouter><ImportDataTab /></MemoryRouter>)

beforeEach(() => { history.current = [batch()]; undoState.current = { isPending: false, error: null } })
afterEach(() => { cleanup(); vi.clearAllMocks(); providerSettings.current = undefined })

describe('ImportDataTab', () => {
  it('starts a participant import and downloads its template', async () => {
    renderTab()
    expect(screen.getByRole('link', { name: 'Import participants' })).toHaveAttribute('href', '/settings/import/participants')
    await userEvent.click(within(screen.getByRole('region', { name: 'Participants' })).getByRole('button', { name: 'Download template' }))
    expect(templateMutate).toHaveBeenCalledWith('participants')
    await userEvent.click(within(screen.getByRole('region', { name: 'Staff' })).getByRole('button', { name: 'Download template' }))
    expect(templateMutate).toHaveBeenLastCalledWith('staff')
  })

  it('lists each batch and undoes one after confirming', async () => {
    renderTab()
    const row = screen.getByRole('row', { name: /people\.csv/ })
    expect(within(row).getByText('Imported')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Undo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }))
    expect(undoMutate).toHaveBeenCalledWith('b1', expect.anything())
  })

  it('shows an undone batch without an Undo button', () => {
    history.current = [batch({ undoneAt: '2026-10-13T02:00:00Z', undoneByName: 'Ada Admin' })]
    renderTab()
    const row = screen.getByRole('row', { name: /people\.csv/ })
    expect(within(row).getByText('Undone')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('lists what blocked an undo', () => {
    undoState.current = {
      isPending: false,
      error: { response: { status: 409, data: { success: false, errors: ['Nothing was undone: 1 record has changed since the import.'], data: [{ entityId: 'p1', name: 'Ava Stone', reason: 'has shifts' }] } } },
    }
    renderTab()
    expect(screen.getByText('Nothing was undone: 1 record has changed since the import.')).toBeInTheDocument()
    expect(screen.getByText('Ava Stone has shifts')).toBeInTheDocument()
    expect(screen.queryByText(/Undo the funding plans import first/)).toBeNull()
  })

  it('says which undo goes first when funding plans hold the participants', () => {
    undoState.current = {
      isPending: false,
      error: { response: { status: 409, data: { success: false, errors: ['Nothing was undone: 1 record has changed since the import.'], data: [{ entityId: 'p1', name: 'Ava Stone', reason: 'has a funding plan' }] } } },
    }
    renderTab()
    expect(screen.getByText('Ava Stone has a funding plan')).toBeInTheDocument()
    expect(screen.getByText('Undo the funding plans import first, then undo this one.')).toBeInTheDocument()
  })

  it('offers a staff import, and invites for a staff batch with the results above the history', async () => {
    history.current = [batch({ id: 'b2', kind: 'Staff', fileName: 'staff.csv' }), batch()]
    invites.mockResolvedValue({ invites: [], left: 0 })
    renderTab()
    expect(screen.getByRole('link', { name: 'Import staff' })).toHaveAttribute('href', '/settings/import/staff')
    expect(within(screen.getByRole('row', { name: /people.csv/ })).queryByRole('button', { name: /Send sign-in invites/ })).toBeNull()

    const row = screen.getByRole('row', { name: /staff.csv/ })
    await userEvent.click(within(row).getByRole('button', { name: 'Send sign-in invites (2)' }))

    expect(invites).toHaveBeenCalledWith({ batchId: 'b2' })
    const said = await screen.findByText('Everyone in this import has signed in already, so no invites were sent.')
    expect(row).not.toContainElement(said)
    await userEvent.click(within(row).getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('The 2 staff members it created are removed. This only works while none of them has signed in or been rostered. Anyone already sent a sign-in invite will find it no longer works until they are imported again.')).toBeInTheDocument()
  })

  it('takes the invites results away once their batch is undone', async () => {
    history.current = [batch({ id: 'b2', kind: 'Staff', fileName: 'staff.csv' })]
    invites.mockResolvedValue({ invites: [], left: 0 })
    undoMutate.mockImplementation((_id: string, options?: { onSuccess?: () => void; onSettled?: () => void }) => { options?.onSuccess?.(); options?.onSettled?.() })
    renderTab()
    const row = screen.getByRole('row', { name: /staff.csv/ })
    await userEvent.click(within(row).getByRole('button', { name: 'Send sign-in invites (2)' }))
    await screen.findByText(/no invites were sent/)

    await userEvent.click(within(row).getByRole('button', { name: 'Undo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }))

    expect(screen.queryByText(/no invites were sent/)).toBeNull()
  })

  it('offers a funding plans import, names its batches and says what undoing one does', async () => {
    history.current = [batch({ id: 'b3', kind: 'FundingPlans', fileName: 'budgets.csv', createdCount: 3 })]
    renderTab()
    expect(screen.getByRole('link', { name: 'Import funding plans' })).toHaveAttribute('href', '/settings/import/funding-plans')
    await userEvent.click(within(screen.getByRole('region', { name: 'Funding plans' })).getByRole('button', { name: 'Download template' }))
    expect(templateMutate).toHaveBeenCalledWith('funding-plans')

    const row = screen.getByRole('row', { name: /budgets\.csv/ })
    expect(within(row).getByText('Funding plans')).toBeInTheDocument()
    // A plan is several rows, so the counts say which they are.
    expect([within(row).getByText('3 plans'), within(row).getByText('1 row')]).toHaveLength(2)
    await userEvent.click(within(row).getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('The 3 funding plans that budgets.csv created are deleted. This only works while none of them has been changed, or used by a shift or a service agreement, since the import.')).toBeInTheDocument()
  })

  it('offers an upcoming shifts import with the weekly pattern template', async () => {
    renderTab()
    const card = screen.getByRole('region', { name: 'Upcoming shifts' })
    expect(within(card).getByRole('link', { name: 'Import upcoming shifts' })).toHaveAttribute('href', '/settings/import/upcoming-shifts')
    await userEvent.click(within(card).getByRole('button', { name: 'Download template' }))
    expect(templateMutate).toHaveBeenCalledWith({ kind: 'upcoming-shifts', shape: 'pattern' })
  })

  it('counts an upcoming shifts batch in shifts and rows, and says when an undo left some', () => {
    history.current = [
      batch({ id: 'b4', kind: 'UpcomingShifts', fileName: 'roster.xlsx', createdCount: 96, skippedCount: 1, failedCount: 3 }),
      batch({ id: 'b5', kind: 'UpcomingShifts', fileName: 'old.xlsx', createdCount: 96, undoneAt: '2026-10-14T01:00:00Z', undoneByName: 'Ada Admin', keptCount: 6 }),
    ]
    renderTab()
    const row = screen.getByRole('row', { name: /roster\.xlsx/ })
    expect([within(row).getByText('96 shifts'), within(row).getByText('1 row'), within(row).getByText('3 rows')]).toHaveLength(3)
    expect(within(screen.getByRole('row', { name: /old\.xlsx/ })).getByText('Partly undone')).toBeInTheDocument()
  })

  it('tells the Admin to undo a funding plans import before the participants it used', async () => {
    renderTab()
    await userEvent.click(within(screen.getByRole('row', { name: /people\.csv/ })).getByRole('button', { name: 'Undo' }))
    expect(screen.getByText(/If a funding plans import added plans for them, undo that first\.$/)).toBeInTheDocument()
  })

  it('drops the staff card and says why when staff come from Employment Hero', () => {
    providerSettings.current = { employmentHeroConnected: true }
    renderTab()
    expect(screen.getByRole('link', { name: 'Import participants' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Import staff' })).toBeNull()
    expect(screen.getByText('Staff come from Employment Hero for this organisation, so they are not imported here.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open integrations' })).toHaveAttribute('href', '/settings?section=integrations')
  })
})
