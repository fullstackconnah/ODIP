import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import ImportWizardPage from './ImportWizardPage'
import type { ImportPreviewDto, ImportResultDto } from '@/api/types'

const { preview, commit, undo, template, flags } = vi.hoisted(() => ({
  preview: vi.fn(), commit: vi.fn(), undo: vi.fn(), template: vi.fn(), flags: { previewPending: false, commitPending: false, undoPending: false },
}))

vi.mock('@/api/hooks', () => ({
  usePreviewImport: () => ({ mutateAsync: preview, isPending: flags.previewPending }),
  useCommitImport: () => ({ mutateAsync: commit, isPending: flags.commitPending }),
  useUndoImport: () => ({ mutateAsync: undo, isPending: flags.undoPending }),
  useDownloadImportTemplate: () => ({ mutate: template, isPending: false }),
  useImportInvites: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProviderSettings: () => ({ data: undefined }),
}))

const shiftsPreview = (over: Partial<ImportPreviewDto> = {}): ImportPreviewDto => ({
  fields: [{ key: 'weekday', label: 'Weekday', required: true }, { key: 'start', label: 'Start time', required: true }],
  columns: [{ index: 0, header: 'Day', field: 'weekday', note: null }, { index: 1, header: 'From', field: 'start', note: null }],
  rows: [{ rowNumber: 2, name: 'Alex Example', status: 'Ready', reasons: [], warnings: ['Sam Ng is on leave on Mon 17 Nov.'], notes: [], skipReason: null, detail: 'Mondays, 9:00 am to 3:00 pm, with Sam Ng: 12 shifts' }],
  readyCount: 30, skippedCount: 1, invalidCount: 2, previouslyImportedAt: null, createCount: 96,
  unfilledCount: 6, firstDate: '2026-11-02', lastDate: '2027-01-24', weekCount: 12, readinessEnforced: false,
  ...over,
})
const resultOf = (over: Partial<ImportResultDto> = {}): ImportResultDto =>
  ({ batchId: 'b1', createdCount: 96, skippedCount: 1, failedCount: 3, rows: [], replayed: false, firstWeekStart: '2026-11-02', weekCount: 12, unfilledCount: 6, ...over })

function Rostering() { return <p>Roster {useLocation().search}</p> }
function renderWizard() {
  const router = createMemoryRouter(
    [{ path: '/settings/import/:kind', element: <ImportWizardPage /> }, { path: '/rostering', element: <Rostering /> }, { path: '/settings', element: <p>Settings</p> }],
    { initialEntries: ['/settings/import/upcoming-shifts'] },
  )
  return render(<RouterProvider router={router} />)
}

const next = () => userEvent.click(screen.getByRole('button', { name: 'Next' }))
const chooseFile = async () => {
  const file = new File([new Uint8Array(10)], 'roster.csv', { type: 'text/csv' })
  await userEvent.upload(screen.getByLabelText('File (.csv or .xlsx)'), file)
  return file
}
const choosePattern = () => userEvent.click(screen.getByRole('radio', { name: /A weekly pattern/ }))
/** Pattern chosen, file uploaded, through Match to Preview. */
async function toPreview(shape: RegExp = /A weekly pattern/) {
  await userEvent.click(screen.getByRole('radio', { name: shape }))
  await chooseFile()
  await next()
  await screen.findByRole('heading', { name: 'Match columns' })
  await next()
  await screen.findByRole('heading', { name: 'Preview' })
}
async function toReview() {
  await toPreview()
  await next()
  await screen.findByRole('heading', { name: 'Import' })
}
async function toResult() {
  commit.mockResolvedValue(resultOf())
  await toReview()
  await userEvent.click(screen.getByRole('button', { name: 'Import 96 shifts' }))
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))
  await screen.findByText('Imported 96 shifts')
}

beforeEach(() => {
  // Mon 26 Oct 2026, midday: next Monday is 2 Nov, and today + 28 is Mon 23 Nov.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 26, 12) })
  preview.mockResolvedValue(shiftsPreview())
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); flags.previewPending = false; flags.commitPending = false; flags.undoPending = false })

describe('ImportWizardPage, upcoming shifts', () => {
  it('upload_noShape_blocks_with_choose_first', async () => {
    renderWizard()
    expect(screen.getByRole('heading', { level: 1, name: 'Import upcoming shifts' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download the template' })).not.toBeInTheDocument()
    await chooseFile()
    await next()
    expect(screen.getByText("Choose what's in your file first.")).toBeInTheDocument()
    expect(preview).not.toHaveBeenCalled()
  })

  it('pattern_shows_from_and_for_default_nextMonday_12weeks_and_span_line', async () => {
    renderWizard()
    await choosePattern()
    expect(screen.getByLabelText('Starts from')).toHaveValue('2026-11-02')
    expect(screen.getByLabelText('For')).toHaveTextContent('12 weeks')
    expect(screen.getByText('Makes shifts from Mon 2 Nov to Sun 24 Jan.')).toBeInTheDocument()
    await chooseFile()
    await next()
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ kind: 'upcoming-shifts', extra: { shape: 'pattern', from: '2026-11-02', weeks: '12' } }))
  })

  it('from_beyond_max_blocks_with_upto_sentence', async () => {
    renderWizard()
    await choosePattern()
    fireEvent.change(screen.getByLabelText('Starts from'), { target: { value: '2026-12-01' } })
    await chooseFile()
    await next()
    expect(screen.getByText('The pattern can start from today up to Mon 23 Nov.')).toBeInTheDocument()
    expect(preview).not.toHaveBeenCalled()
  })

  it('dated_shows_dated_limit_line_and_no_from_fields', async () => {
    renderWizard()
    await userEvent.click(screen.getByRole('radio', { name: /Dated shifts/ }))
    expect(screen.getByText("Rows dated before today or more than 12 weeks ahead (after Sun 17 Jan) can't be imported.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Starts from')).not.toBeInTheDocument()
    await chooseFile()
    await next()
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ extra: { shape: 'dated' } }))
  })

  it('template_button_hidden_until_shape_then_downloads_that_shape', async () => {
    renderWizard()
    expect(screen.queryByRole('button', { name: 'Download the template' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Dated shifts/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Download the template' }))
    expect(template).toHaveBeenCalledWith({ kind: 'upcoming-shifts', shape: 'dated' })
  })

  it('changing_weeks_resets_idempotency_key', async () => {
    commit.mockRejectedValueOnce(new Error('network')).mockResolvedValue(resultOf())
    renderWizard()
    await toReview()
    await userEvent.click(screen.getByRole('button', { name: 'Import 96 shifts' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))
    await screen.findByText('The import failed, so nothing was imported.')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByLabelText('For'))
    await userEvent.click(await screen.findByRole('option', { name: '6 weeks' }))
    await next()
    await screen.findByRole('heading', { name: 'Match columns' })
    await next()
    await screen.findByRole('heading', { name: 'Preview' })
    await next()
    await userEvent.click(screen.getByRole('button', { name: 'Import 96 shifts' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))
    await screen.findByText('Imported 96 shifts')
    const [first, second] = commit.mock.calls.map(c => c[0])
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey)
    expect(second.extra.weeks).toBe('6')
  })

  it('preview_pending_footer_line_and_next_inert', async () => {
    flags.previewPending = true
    renderWizard()
    await choosePattern()
    await chooseFile()
    expect(screen.getByText('Checking every shift against the roster rules. Large files can take up to a minute.')).toBeInTheDocument()
    await next()
    expect(preview).not.toHaveBeenCalled()
  })

  it('preview_enforce_notice_and_pattern_summary_with_unfilled', async () => {
    preview.mockResolvedValue(shiftsPreview({ readinessEnforced: true }))
    renderWizard()
    await toPreview()
    expect(screen.getByText('Participants must be fully ready to be rostered')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Readiness settings' })).toHaveAttribute('href', '/settings?section=safety')
    expect(screen.getByText('96 shifts over 12 weeks, Mon 2 Nov to Sun 24 Jan, from 30 ready rows. They are added as drafts: nobody is told until you publish each week.')).toBeInTheDocument()
    expect(screen.getByText('6 shifts have no staff yet and import unfilled.')).toBeInTheDocument()
  })

  it('preview_dated_summary', async () => {
    renderWizard()
    await toPreview(/Dated shifts/)
    expect(screen.getByText('96 shifts from Mon 2 Nov to Sun 24 Jan, one per ready row. They are added as drafts: nobody is told until you publish each week.')).toBeInTheDocument()
    expect(screen.queryByText('Participants must be fully ready to be rostered')).not.toBeInTheDocument()
  })

  it('preview_all_refused_next_blocks', async () => {
    preview.mockResolvedValue(shiftsPreview({ readyCount: 0, createCount: 0, firstDate: null, lastDate: null, weekCount: 0, unfilledCount: 0 }))
    renderWizard()
    await toPreview()
    await next()
    expect(screen.getByText('No rows are ready to import. Fix the file, then upload it again.')).toBeInTheDocument()
  })

  it('review_paragraphs_and_submit_label_Import_96_shifts', async () => {
    renderWizard()
    await toReview()
    expect(screen.getByText('96 shifts will be added as drafts, Mon 2 Nov to Sun 24 Jan.')).toBeInTheDocument()
    expect(screen.getByText('6 have no staff yet: fill them on the roster before or after publishing.')).toBeInTheDocument()
    expect(screen.getByText('Skipped, already on the roster or repeated in the file: 1.')).toBeInTheDocument()
    expect(screen.getByText("Can't be imported: 2. Fix them in the file and import it again: shifts already on the roster are skipped, never added twice.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 96 shifts' })).toBeInTheDocument()
    expect(screen.queryByText(/Every row is checked again/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/Every shift is checked again/)).toHaveLength(1)
  })

  it('result_open_first_week_navigates_to_rostering_date', async () => {
    renderWizard()
    await toResult()
    expect(screen.getByText(/12 weeks are on the roster as drafts, from Mon 2 Nov\. Check the first week, then Publish week\. 1 row skipped, 3 rows couldn't be imported\./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Open the first week' }))
    expect(await screen.findByText('Roster ?date=2026-11-02')).toBeInTheDocument()
  })

  it('undo_all_says_import_undone', async () => {
    undo.mockResolvedValue({ id: 'b1', keptCount: 0 })
    renderWizard()
    await toResult()
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Shifts already published or changed stay on the roster.')
    expect(dialog).not.toHaveTextContent('not started')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Undo import' }))
    expect(await screen.findByText('Import undone')).toBeInTheDocument()
    expect(screen.getByText('The 96 shifts it added are removed.')).toBeInTheDocument()
  })

  it('undo_partial_says_partly_undone_with_kept', async () => {
    undo.mockResolvedValue({ id: 'b1', keptCount: 6 })
    renderWizard()
    await toResult()
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Undo import' }))
    expect(await screen.findByText('Import partly undone')).toBeInTheDocument()
    expect(screen.getByText('90 shifts are removed. 6 stay on the roster because they were published or changed since the import.')).toBeInTheDocument()
  })

  it('undo_409_says_nothing_to_undo', async () => {
    const sentence = 'Nothing to undo: every shift from this import has been published or changed since.'
    undo.mockRejectedValue({ response: { status: 409, data: { success: false, errors: [sentence] } } })
    renderWizard()
    await toResult()
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Undo import' }))
    expect(await screen.findByText(sentence)).toBeInTheDocument()
    expect(screen.queryByText('Import undone')).not.toBeInTheDocument()
  })

  it('previously_imported_warning_uses_shift_wording', async () => {
    preview.mockResolvedValue(shiftsPreview({ previouslyImportedAt: '2026-10-20T01:00:00Z' }))
    renderWizard()
    await toPreview()
    expect(screen.getByText(/Shifts already on the roster are skipped, but check before importing it again\./)).toBeInTheDocument()
  })

  it.each([
    ['busy 409', 409, 'Another change to the roster is still running. Try again in a moment.'],
    ['RecordRace 409', 409, 'Someone changed the roster while this import ran, so nothing was imported. Try again.'],
    ['over cap 400', 400, 'This import has more than 5,000 shifts. Split the file, then import each part.'],
  ])('commit_%s_shows_server_sentence_then_retry_clears_it', async (_name, status, sentence) => {
    commit.mockRejectedValueOnce({ response: { status, data: { success: false, errors: [sentence] } } }).mockResolvedValue(resultOf())
    renderWizard()
    await toReview()
    await userEvent.click(screen.getByRole('button', { name: 'Import 96 shifts' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))
    expect(await screen.findByText(sentence)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import 96 shifts' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('Imported 96 shifts')).toBeInTheDocument()
    expect(screen.queryByText(sentence)).not.toBeInTheDocument()
    expect(commit.mock.calls[0][0].idempotencyKey).toBe(commit.mock.calls[1][0].idempotencyKey)
  })

  it('import_double_press_sends_once', async () => {
    commit.mockImplementation(() => { flags.commitPending = true; return new Promise(() => {}) })
    renderWizard()
    await toReview()
    await userEvent.click(screen.getByRole('button', { name: 'Import 96 shifts' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Import' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import 96 shifts' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('undo_double_press_sends_once', async () => {
    undo.mockImplementation(() => { flags.undoPending = true; return new Promise(() => {}) })
    renderWizard()
    await toResult()
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Undo import' }))
    const again = screen.getByRole('button', { name: 'Undo import' })
    expect(again).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(again)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(undo).toHaveBeenCalledTimes(1)
  })
})
