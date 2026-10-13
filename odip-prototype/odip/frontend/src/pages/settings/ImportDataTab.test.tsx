import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ImportDataTab from './ImportDataTab'
import type { ImportBatchDto } from '@/api/types'

const { history, undoMutate, templateMutate, undoState } = vi.hoisted(() => ({
  history: { current: [] as ImportBatchDto[] },
  undoMutate: vi.fn(),
  templateMutate: vi.fn(),
  undoState: { current: { isPending: false, error: null as unknown } },
}))

vi.mock('@/api/hooks', () => ({
  useImportHistory: () => ({ data: history.current, isLoading: false, isError: false, refetch: vi.fn() }),
  useUndoImport: () => ({ mutate: undoMutate, ...undoState.current }),
  useDownloadImportTemplate: () => ({ mutate: templateMutate, isPending: false }),
}))

const batch = (overrides: Partial<ImportBatchDto> = {}): ImportBatchDto => ({
  id: 'b1', kind: 'Participants', fileName: 'people.csv', createdByName: 'Ada Admin', createdAt: '2026-10-13T01:00:00Z',
  rowCount: 3, createdCount: 2, skippedCount: 1, failedCount: 0, undoneAt: null, undoneByName: null, ...overrides,
})

const renderTab = () => render(<MemoryRouter><ImportDataTab /></MemoryRouter>)

beforeEach(() => { history.current = [batch()]; undoState.current = { isPending: false, error: null } })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ImportDataTab', () => {
  it('starts a participant import and downloads its template', async () => {
    renderTab()
    expect(screen.getByRole('link', { name: 'Import participants' })).toHaveAttribute('href', '/settings/import/participants')
    await userEvent.click(screen.getByRole('button', { name: 'Download template' }))
    expect(templateMutate).toHaveBeenCalledWith('participants')
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
  })
})
