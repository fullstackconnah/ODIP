import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ImportWizardPage from './ImportWizardPage'
import type { ImportPreviewDto } from '@/api/types'

const { preview, commit, undo, template, invites } = vi.hoisted(() => ({
  preview: vi.fn(), commit: vi.fn(), undo: vi.fn(), template: vi.fn(), invites: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  usePreviewImport: () => ({ mutateAsync: preview, isPending: false }),
  useCommitImport: () => ({ mutateAsync: commit, isPending: false }),
  useUndoImport: () => ({ mutateAsync: undo, isPending: false }),
  useDownloadImportTemplate: () => ({ mutate: template, isPending: false }),
  useImportInvites: () => ({ mutateAsync: invites, isPending: false }),
}))

const FIELDS = [
  { key: 'firstName', label: 'First name', required: true },
  { key: 'lastName', label: 'Last name', required: true },
]
const previewOf = (fields: (string | null)[]): ImportPreviewDto => ({
  fields: FIELDS,
  columns: [{ index: 0, header: 'Given', field: fields[0], note: null }, { index: 1, header: 'Surname', field: fields[1], note: null }],
  rows: [
    { rowNumber: 2, name: 'Ava Stone', status: 'Ready', reasons: [], warnings: [], skipReason: null },
    { rowNumber: 3, name: 'Ben', status: 'Invalid', reasons: ['Last name is required.'], warnings: [], skipReason: null },
  ],
  readyCount: 1, skippedCount: 0, invalidCount: 1, previouslyImportedAt: null,
})

function renderWizard() {
  const router = createMemoryRouter(
    [{ path: '/settings/import/:kind', element: <ImportWizardPage /> }, { path: '/settings', element: <p>Settings</p> }],
    { initialEntries: ['/settings/import/participants'] },
  )
  return render(<RouterProvider router={router} />)
}

async function upload(name = 'people.csv', size = 10) {
  const file = new File([new Uint8Array(size)], name, { type: 'text/csv' })
  await userEvent.upload(screen.getByLabelText('File (.csv or .xlsx)'), file)
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  return file
}

beforeEach(() => { preview.mockResolvedValue(previewOf(['firstName', 'lastName'])) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ImportWizardPage', () => {
  it('walks upload, match, preview and import, and shows what was created', async () => {
    const data = previewOf(['firstName', 'lastName'])
    commit.mockResolvedValue({ batchId: 'b1', createdCount: 1, skippedCount: 0, failedCount: 1, rows: data.rows, replayed: false })
    renderWizard()
    expect(screen.getByRole('heading', { level: 1, name: 'Import participants' })).toBeInTheDocument()

    const file = await upload()
    expect(preview).toHaveBeenCalledWith({ kind: 'participants', file, mapping: undefined })
    await screen.findByRole('heading', { name: 'Match columns' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(preview).toHaveBeenLastCalledWith({ kind: 'participants', file, mapping: ['firstName', 'lastName'] })
    await screen.findByRole('heading', { name: 'Preview' })

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Choose whether these participants are already receiving services or are new onboarding.')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/Already receiving services/))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 participant' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))

    expect(commit).toHaveBeenCalledWith({ kind: 'participants', file, mapping: ['firstName', 'lastName'], landing: 'Active', idempotencyKey: expect.any(String) })
    expect(await screen.findByText('Imported 1 participant')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View participants' })).toHaveAttribute('href', '/participants?tab=active')
    expect(screen.getByText('Last name is required.')).toBeInTheDocument()
  })

  it('blocks Next on Match columns while a required field is unmatched', async () => {
    preview.mockResolvedValue(previewOf(['firstName', null]))
    renderWizard()
    await upload()
    await screen.findByRole('heading', { name: 'Match columns' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Match a column to Last name.')).toBeInTheDocument()
    expect(preview).toHaveBeenCalledTimes(1)
  })

  it('filters the preview rows by status', async () => {
    renderWizard()
    await upload()
    await screen.findByRole('heading', { name: 'Match columns' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Preview' })
    await userEvent.click(screen.getByRole('radio', { name: "Can't import (1)" }))
    expect(screen.queryByText('Ava Stone')).toBeNull()
    expect(screen.getByText('Last name is required.')).toBeInTheDocument()
  })

  it('refuses a file over 5 MB without calling the server, and shows the server refusing a file', async () => {
    renderWizard()
    await upload('big.csv', 5 * 1024 * 1024 + 1)
    expect(screen.getByText('The file is over 5 MB. Split it into smaller files and import each one.')).toBeInTheDocument()
    expect(preview).not.toHaveBeenCalled()

    preview.mockRejectedValue({ response: { data: { success: false, errors: ['The file has a header row but no data rows.'] } } })
    await upload('empty.csv')
    expect(await screen.findByText('The file has a header row but no data rows.')).toBeInTheDocument()
  })

  it('lists who changed when the server refuses to undo the import', async () => {
    commit.mockResolvedValue({ batchId: 'b1', createdCount: 1, skippedCount: 0, failedCount: 0, rows: [], replayed: false })
    undo.mockRejectedValue({
      response: { status: 409, data: { success: false, errors: ['Nothing was undone: these records changed since the import.'], data: [{ entityId: 'p1', name: 'Ava Stone', reason: 'has shifts' }] } },
    })
    renderWizard()
    await upload()
    await screen.findByRole('heading', { name: 'Match columns' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Preview' })
    await userEvent.click(screen.getByLabelText(/Already receiving services/))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 participant' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo import' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Undo import' }))

    expect(await screen.findByText('Ava Stone has shifts')).toBeInTheDocument()
  })

  it('closes the later steps again when a column match changes', async () => {
    renderWizard()
    await upload()
    await screen.findByRole('heading', { name: 'Match columns' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Preview' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', { name: 'Match columns' })
    const rail = screen.getByRole('navigation', { name: 'Import steps' })
    expect(within(rail).getByRole('button', { name: /Preview/ })).toBeEnabled()

    await userEvent.click(screen.getAllByRole('button', { name: 'Surname' })[0])
    await userEvent.click(await screen.findByRole('option', { name: "Don't import" }))

    expect(within(rail).getByRole('button', { name: /Preview/ })).toBeDisabled()
  })

  it('imports staff with no landing step, offers the invites, and says undo removes them', async () => {
    commit.mockResolvedValue({ batchId: 'b1', createdCount: 1, skippedCount: 0, failedCount: 1, rows: previewOf(['firstName', 'lastName']).rows, replayed: false })
    const router = createMemoryRouter([{ path: '/settings/import/:kind', element: <ImportWizardPage /> }], { initialEntries: ['/settings/import/staff'] })
    render(<RouterProvider router={router} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Import staff' })).toBeInTheDocument()
    const file = await upload()
    expect(preview).toHaveBeenCalledWith({ kind: 'staff', file, mapping: undefined })
    await screen.findByRole('heading', { name: 'Match columns' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Preview' })
    expect(screen.queryByLabelText(/Already receiving services/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/Nobody is emailed yet/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 staff member' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))

    expect(commit).toHaveBeenCalledWith({ kind: 'staff', file, mapping: ['firstName', 'lastName'], landing: undefined, idempotencyKey: expect.any(String) })
    expect(await screen.findByText('Imported 1 staff member')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View staff' })).toHaveAttribute('href', '/staff')
    expect(screen.getByRole('button', { name: 'Send sign-in invites (1)' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }))
    expect(within(screen.getByRole('alertdialog')).getByText(/are removed. This only works while none of them has signed in or been rostered./)).toBeInTheDocument()
  })
})
