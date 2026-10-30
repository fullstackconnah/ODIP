import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ImportWizardPage from './ImportWizardPage'
import type { ImportPreviewDto } from '@/api/types'

const { preview, commit, undo, template, invites, providerSettings } = vi.hoisted(() => ({
  preview: vi.fn(), commit: vi.fn(), undo: vi.fn(), template: vi.fn(), invites: vi.fn(),
  providerSettings: { current: undefined as { employmentHeroConnected?: boolean } | undefined },
}))

vi.mock('@/api/hooks', () => ({
  usePreviewImport: () => ({ mutateAsync: preview, isPending: false }),
  useCommitImport: () => ({ mutateAsync: commit, isPending: false }),
  useUndoImport: () => ({ mutateAsync: undo, isPending: false }),
  useDownloadImportTemplate: () => ({ mutate: template, isPending: false }),
  useImportInvites: () => ({ mutateAsync: invites, isPending: false }),
  useProviderSettings: () => ({ data: providerSettings.current }),
}))

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/signInEmail', async () => ({
  ...(await vi.importActual<typeof import('@/lib/signInEmail')>('@/lib/signInEmail')),
  sendSetPasswordEmailFor: sendEmail,
}))

const FIELDS = [
  { key: 'firstName', label: 'First name', required: true },
  { key: 'lastName', label: 'Last name', required: true },
]
const previewOf = (fields: (string | null)[]): ImportPreviewDto => ({
  fields: FIELDS,
  columns: [{ index: 0, header: 'Given', field: fields[0], note: null }, { index: 1, header: 'Surname', field: fields[1], note: null }],
  rows: [
    { rowNumber: 2, name: 'Ava Stone', status: 'Ready', reasons: [], warnings: [], notes: [], skipReason: null, detail: null },
    { rowNumber: 3, name: 'Ben', status: 'Invalid', reasons: ['Last name is required.'], warnings: [], notes: [], skipReason: null, detail: null },
  ],
  readyCount: 1, skippedCount: 0, invalidCount: 1, previouslyImportedAt: null, createCount: 1,
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
afterEach(() => { cleanup(); vi.clearAllMocks(); providerSettings.current = undefined })

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

  it.each([
    [1, "Can't be imported: 1. Fix it in the file and import it again afterwards."],
    [2, "Can't be imported: 2. Fix them in the file and import it again afterwards."],
  ])('says "it" or "them" for %i row(s) that cannot be imported', async (invalidCount, sentence) => {
    preview.mockResolvedValue({ ...previewOf(['firstName', 'lastName']), invalidCount })
    renderWizard()
    await upload()
    await screen.findByRole('heading', { name: 'Match columns' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Preview' })
    await userEvent.click(screen.getByLabelText(/Already receiving services/))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(sentence)).toBeInTheDocument()
  })

  describe('the commit key', () => {
    async function failFirstCommit() {
      commit.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ batchId: 'b1', createdCount: 1, skippedCount: 0, failedCount: 1, rows: [], replayed: false })
      renderWizard()
      await upload()
      await screen.findByRole('heading', { name: 'Match columns' })
      await userEvent.click(screen.getByRole('button', { name: 'Next' }))
      await screen.findByRole('heading', { name: 'Preview' })
      await userEvent.click(screen.getByLabelText(/Already receiving services/))
      await userEvent.click(screen.getByRole('button', { name: 'Next' }))
      await importNow()
      await screen.findByText('The import failed, so nothing was imported.')
    }
    const importNow = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Import 1 participant' }))
      await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))
    }

    it('stays the same on a plain retry', async () => {
      await failFirstCommit()
      await importNow()
      await screen.findByText(/Imported 1 participant/)
      expect(commit.mock.calls[0][0].idempotencyKey).toBe(commit.mock.calls[1][0].idempotencyKey)
    })

    it('changes when the landing is changed after a failed commit', async () => {
      await failFirstCommit()
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await userEvent.click(screen.getByLabelText(/New onboarding/))
      await userEvent.click(screen.getByRole('button', { name: 'Next' }))
      await importNow()
      await screen.findByText(/Imported 1 participant/)
      const [first, second] = commit.mock.calls.map(c => c[0])
      expect([first.landing, second.landing]).toEqual(['Active', 'Onboarding'])
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
    })
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
    await userEvent.click(screen.getByRole('checkbox', { name: 'Email each new staff member a sign-in invite' }))
    expect(screen.getByText('Nobody is emailed. You can send invites later from Import history.')).toBeInTheDocument()
    expect(screen.getByText('Every row is checked again as it is imported. You can undo the whole import while none of them has signed in or been rostered.')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 staff member' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))

    expect(commit).toHaveBeenCalledWith({ kind: 'staff', file, mapping: ['firstName', 'lastName'], landing: undefined, idempotencyKey: expect.any(String) })
    expect(await screen.findByText('Imported 1 staff member')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View staff' })).toHaveAttribute('href', '/staff')
    expect(screen.getByRole('button', { name: 'Send sign-in invites (1)' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }))
    expect(within(screen.getByRole('alertdialog')).getByText('The 1 staff member it created is removed. This only works while none of them has signed in or been rostered. Anyone already sent a sign-in invite will find it no longer works until they are imported again.')).toBeInTheDocument()
  })

  it('imports funding plans: no landing, counts plans not rows, and says undo deletes them', async () => {
    preview.mockResolvedValue({ ...previewOf(['firstName', 'lastName']), rows: [], readyCount: 3, skippedCount: 1, invalidCount: 2, createCount: 1 })
    commit.mockResolvedValue({ batchId: 'b1', createdCount: 1, skippedCount: 1, failedCount: 2, rows: [], replayed: false })
    const router = createMemoryRouter([{ path: '/settings/import/:kind', element: <ImportWizardPage /> }], { initialEntries: ['/settings/import/funding-plans'] })
    render(<RouterProvider router={router} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Import funding plans' })).toBeInTheDocument()
    expect(screen.getByText(/^Import participants first\./)).toBeInTheDocument()

    const file = await upload('budgets.csv')
    expect(preview).toHaveBeenCalledWith({ kind: 'funding-plans', file, mapping: undefined })
    await screen.findByRole('heading', { name: 'Match columns' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Preview' })
    expect(screen.queryByLabelText(/Already receiving services/)).toBeNull()
    expect(screen.getByText(/make one plan: 1 plan from 3 ready rows\./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('1 funding plan will be created.')).toBeInTheDocument()
    expect(screen.getByText('Rows skipped: 1.')).toBeInTheDocument()
    expect(screen.getByText("Rows that can't be imported: 2. Their plans are left out whole. Fix those rows in the file and import it again: plans already in Bunya Support are refused, never added twice.")).toBeInTheDocument()
    expect(screen.getByText('Every row is checked again as it is imported. You can undo the whole import while none of its plans has been changed, or used by a shift or a service agreement, since the import.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 funding plan' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))

    expect(commit).toHaveBeenCalledWith({ kind: 'funding-plans', file, mapping: ['firstName', 'lastName'], landing: undefined, idempotencyKey: expect.any(String) })
    expect(await screen.findByText('Imported 1 funding plan')).toBeInTheDocument()
    // The participants list shows no plans; Budgets lists every participant's plan in force.
    expect(screen.getByRole('link', { name: 'View budgets' })).toHaveAttribute('href', '/budgets')
    // Plans were created, but rows were skipped or refused: each count names its unit.
    expect(screen.getByText("1 row skipped, 2 rows couldn't be imported.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }))
    expect(within(screen.getByRole('alertdialog')).getByText('The 1 funding plan it created is deleted. This only works while none of its plans has been changed, or used by a shift or a service agreement, since the import.')).toBeInTheDocument()
  })

  it('sets the rows to check apart from notes, filters them, and counts them before the import', async () => {
    const check = 'The file names Ben Lee for this NDIS number, which is Ava Stone in Bunya Support. Check the number.'
    const note = "Categories 01 to 04 are one Core (flexible) pool in Bunya Support: this plan's plan-managed Core comes to $1,250.50."
    preview.mockResolvedValue({
      ...previewOf(['firstName', 'lastName']), readyCount: 2, invalidCount: 0, createCount: 2,
      rows: [
        { rowNumber: 2, name: 'Ava Stone', status: 'Ready', reasons: [], warnings: [check], notes: [], skipReason: null, detail: null },
        { rowNumber: 3, name: 'Cal Wu', status: 'Ready', reasons: [], warnings: [], notes: [note], skipReason: null, detail: '01 Assistance with Daily Life, plan-managed, $1,000.00, 1 Jul 2026 to 30 Jun 2027' },
      ],
    })
    renderWizard()
    await upload()
    await screen.findByRole('heading', { name: 'Match columns' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Preview' })

    // The warning is named in words, not only by its colour; the note is not.
    expect(screen.getByText(check).closest('li')).toHaveTextContent(/^Check: /)
    expect(screen.getByText(note).closest('li')).not.toHaveTextContent(/Check:/)
    // What each row will create, so a misread amount or category is seen before the import.
    expect(screen.getByText('01 Assistance with Daily Life, plan-managed, $1,000.00, 1 Jul 2026 to 30 Jun 2027')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'To check (1)' }))
    expect(screen.queryByText('Cal Wu')).toBeNull()
    expect(screen.getByText('Ava Stone')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText(/Already receiving services/))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Rows to check first: 1. Each one says why in the preview.')).toBeInTheDocument()
  })

  it('sends /settings/import/staff back to Settings when staff come from Employment Hero', () => {
    providerSettings.current = { employmentHeroConnected: true }
    const router = createMemoryRouter(
      [{ path: '/settings/import/:kind', element: <ImportWizardPage /> }, { path: '/settings', element: <p>Settings</p> }],
      { initialEntries: ['/settings/import/staff'] },
    )
    render(<RouterProvider router={router} />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  describe('a long preview', () => {
    const manyRows = (n: number) => Array.from({ length: n }, (_, i) => ({
      rowNumber: i + 2, name: `Person ${i + 2}`, status: i % 2 ? 'Invalid' : 'Ready', reasons: [], warnings: [], notes: [], skipReason: null, detail: null,
    }))
    async function toPreview(n: number) {
      preview.mockResolvedValue({ ...previewOf(['firstName', 'lastName']), rows: manyRows(n), readyCount: Math.ceil(n / 2), invalidCount: Math.floor(n / 2) })
      renderWizard()
      await upload()
      await screen.findByRole('heading', { name: 'Match columns' })
      await userEvent.click(screen.getByRole('button', { name: 'Next' }))
      await screen.findByRole('heading', { name: 'Preview' })
    }

    it('shows 50 rows a page, and a filter switch returns to page 1', async () => {
      await toPreview(120)
      expect(screen.getByText(/Showing 1-50 of 120/)).toBeInTheDocument()
      expect(screen.getByText('Person 2')).toBeInTheDocument()
      expect(screen.queryByText('Person 52')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
      expect(screen.getByText(/Showing 51-100 of 120/)).toBeInTheDocument()
      // The table sits inside the wizard's form: a pager button that submits it would open the import confirmation.
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(screen.getByText('Person 52')).toBeInTheDocument()
      expect(screen.queryByText('Person 2')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('radio', { name: /Ready \(60\)/ }))
      expect(screen.getByText(/Showing 1-50 of 60/)).toBeInTheDocument()
    })

    it('shows no pager for 50 rows or fewer', async () => {
      await toPreview(10)
      expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()
    })
  })
})

describe('ImportWizardPage: where an unknown kind goes', () => {
  it('sends /settings/import/<unknown> back to Settings › Import data', async () => {
    const router = createMemoryRouter(
      [{ path: '/settings/import/:kind', element: <ImportWizardPage /> }, { path: '/settings', element: <p>Settings</p> }],
      { initialEntries: ['/settings/import/unknown'] },
    )
    render(<RouterProvider router={router} />)
    await waitFor(() => expect(router.state.location.search).toBe('?section=import'))
  })

  async function importStaff() {
    commit.mockResolvedValue({ batchId: 'bx', createdCount: 1, skippedCount: 1, failedCount: 0, rows: previewOf(['firstName', 'lastName']).rows, replayed: false })
    const router = createMemoryRouter([{ path: '/settings/import/:kind', element: <ImportWizardPage /> }], { initialEntries: ['/settings/import/staff'] })
    render(<RouterProvider router={router} />)
    await upload()
    await screen.findByRole('heading', { name: 'Match columns' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Preview' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  }
  const doImport = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 staff member' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))
  }

  it('staff review: the invite checkbox is on by default with its helper, and the confirm says invites go out', async () => {
    await importStaff()
    expect(screen.getByRole('checkbox', { name: 'Email each new staff member a sign-in invite' })).toBeChecked()
    expect(screen.getByText('Invites are sent from this browser straight after the import. Keep this tab open until they finish.')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 staff member' }))
    expect(within(screen.getByRole('alertdialog')).getByText("1 staff member will be created and each emailed a sign-in invite. Rows skipped or that can't be imported are left out.")).toBeInTheDocument()
  })

  it('unticked: the manual Send button shows and nothing is sent', async () => {
    invites.mockClear()
    await importStaff()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Email each new staff member a sign-in invite' }))
    await doImport()
    expect(await screen.findByRole('button', { name: 'Send sign-in invites (1)' })).toBeInTheDocument()
    expect(invites).not.toHaveBeenCalled()
  })

  it('ticked: invites are fetched once with no click, and Undo waits until they finish', async () => {
    invites.mockClear(); sendEmail.mockReset()
    let release!: (v: unknown) => void
    sendEmail.mockReturnValue(new Promise(r => { release = r }))
    invites.mockResolvedValue({ left: 0, invites: [{ staffId: 's1', name: 'Ava Stone', email: 'ava@example.com', firebaseAccount: 'created', error: null }] })
    await importStaff()
    await doImport()
    const undoBtn = await screen.findByRole('button', { name: 'Undo import' })
    await waitFor(() => expect(undoBtn).toHaveAttribute('aria-disabled', 'true'))
    expect(invites).toHaveBeenCalledTimes(1)
    expect(invites).toHaveBeenCalledWith({ batchId: 'bx' })
    expect(screen.getByText('Wait for the invites to finish, then undo.')).toBeInTheDocument()
    // The reason sits inside the banner the held button is in, and the button looks held.
    expect(undoBtn.closest('[role=status]')).toContainElement(screen.getByText('Wait for the invites to finish, then undo.'))
    expect(undoBtn).toHaveAttribute('aria-describedby', 'undo-wait')
    expect(undoBtn.className).toMatch(/aria-disabled:opacity-60/)
    await userEvent.click(undoBtn)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    release({ ok: true, email: 'ava@example.com', account: 'created' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo import' })).not.toHaveAttribute('aria-disabled'))
    expect(screen.queryByText('Wait for the invites to finish, then undo.')).toBeNull()
  })

  it('staff copy never says ODIP', async () => {
    await importStaff()
    expect(document.body.textContent).not.toMatch(/ODIP/)
  })
})
