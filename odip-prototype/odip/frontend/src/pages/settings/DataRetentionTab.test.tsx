import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import DataRetentionTab from './DataRetentionTab'
import type { RetentionDueDto } from '@/api/types'

const { apiGet, apiPost, get } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), get: vi.fn() }))
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiGet, apiPost, apiClient: Object.assign(Object.create(actual.apiClient), { get }) }
})

const zoe: RetentionDueDto = {
  participantId: 'p-zoe', firstName: 'Zoe', lastName: 'Campbell', startsOn: '2018-03-12', startEstimated: false, dueOn: '2025-03-12',
  rowCounts: { Shifts: 820, ShiftNotes: 310, ClaimLineItems: 60, Invoices: 14 },
}
const margaret: RetentionDueDto = {
  participantId: 'p-margaret', firstName: 'Margaret', lastName: 'Doyle', startsOn: '2019-09-01', startEstimated: true, dueOn: '2026-09-01',
  rowCounts: { ParticipantNotes: 1 },
}

const answered = (status: number, sentence: string) =>
  new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, { status, statusText: '', data: { success: false, errors: [sentence] }, headers: {}, config: { headers: new AxiosHeaders() } } as AxiosResponse)
const wholeZip = () => { const bytes = new Uint8Array(2048); bytes.set([0x50, 0x4b, 0x05, 0x06], 2048 - 22); return bytes }
const zipResponse = { data: new Blob([wholeZip()]), headers: { 'content-disposition': 'attachment; filename="bunya-support-participant-zoe-campbell-2026-11-06.zip"' } }

const renderTab = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DataRetentionTab /></QueryClientProvider>)
const openPurge = async (user: ReturnType<typeof userEvent.setup>, name = "Purge Zoe Campbell's record") => {
  await user.click(await screen.findByRole('button', { name }))
  return screen.findByRole('alertdialog')
}
const confirmButton = () => screen.getByRole('button', { name: 'Purge record' })

beforeEach(() => {
  apiGet.mockResolvedValue([zoe, margaret])
  window.URL.createObjectURL = vi.fn(() => 'blob:participant')
  window.URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); apiGet.mockReset(); apiPost.mockReset(); get.mockReset() })

describe('DataRetentionTab list', () => {
  it('says nothing is due when the list is empty', async () => {
    apiGet.mockResolvedValue([])
    renderTab()
    expect(await screen.findByText('No records are due for purge')).toBeInTheDocument()
    expect(screen.getByText("When an archived participant's record has been kept for 7 years, it shows here and you get a task in Tasks.")).toBeInTheDocument()
    expect(screen.queryByText(/^Estimated:/)).toBeNull()
  })

  it('offers a retry when the list will not load', async () => {
    apiGet.mockRejectedValue(new Error('down'))
    renderTab()
    expect(await screen.findByText("Couldn't load records due for purge")).toBeInTheDocument()
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows the due rows with the columns in the pinned order, the biggest three kinds under the count', async () => {
    renderTab()
    expect(await screen.findByText('Zoe Campbell')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Due for purge' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Participant', 'Retention starts', 'Due for purge', 'Records', 'Actions'])
    expect(screen.getByText('1,204 records')).toBeInTheDocument()
    const kindsLine = screen.getByText('Shift notes 310').parentElement!
    expect(kindsLine).toHaveTextContent('Shifts 820 · Shift notes 310 · Claim lines 60')
    // Each item stays on one line; the line wraps only at the separators.
    expect(screen.getByText('Shift notes 310')).toHaveClass('whitespace-nowrap')
    // The phone card has no caps labels on meta values, so the dates carry their own (hidden from md up, where the header labels them).
    expect(screen.getAllByText('Starts')[0]).toHaveClass('md:hidden')
    expect(screen.getAllByText('Due')[0]).toHaveClass('md:hidden')
    expect(screen.getByText('1 record')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Download Zoe Campbell's data" })).toHaveTextContent('Download their data')
    expect(screen.getByRole('button', { name: "Purge Zoe Campbell's record" })).toHaveTextContent('Purge')
  })

  it('marks an estimated start with a badge and the footnote, and only then', async () => {
    renderTab()
    await screen.findByText('Margaret Doyle')
    expect(screen.getAllByText('Estimated')).toHaveLength(1)
    expect(screen.getByText(/^Estimated: archived before Bunya Support recorded archive dates/)).toHaveAttribute('id', 'retention-estimated-note')
    cleanup()
    apiGet.mockResolvedValue([zoe])
    renderTab()
    await screen.findByText('Zoe Campbell')
    expect(screen.queryByText('Estimated')).toBeNull()
    expect(screen.queryByText(/^Estimated: archived before/)).toBeNull()
  })
})

describe('DataRetentionTab download', () => {
  it('saves the ZIP and lets only one download run at a time', async () => {
    const user = userEvent.setup()
    let finish!: (value: unknown) => void
    get.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderTab()
    await user.click(await screen.findByRole('button', { name: "Download Zoe Campbell's data" }))
    expect(get).toHaveBeenCalledWith('/data-export/participants/p-zoe', { responseType: 'blob' })
    expect(screen.getByRole('button', { name: "Download Zoe Campbell's data" })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: "Download Zoe Campbell's data" })).toHaveTextContent('Downloading…')
    expect(screen.getByRole('button', { name: "Download Margaret Doyle's data" })).toHaveAttribute('aria-disabled', 'true')
    finish(zipResponse)
    await waitFor(() => expect(screen.getByRole('button', { name: "Download Zoe Campbell's data" })).not.toHaveAttribute('aria-busy'))
  })

  it('says the record is gone on a 404', async () => {
    const user = userEvent.setup()
    get.mockRejectedValue(answered(404, 'Participant not found.'))
    renderTab()
    await user.click(await screen.findByRole('button', { name: "Download Zoe Campbell's data" }))
    expect(await screen.findByText('That record is no longer here')).toBeInTheDocument()
    expect(screen.getByText('It may already have been purged. The list is refreshed.')).toBeInTheDocument()
  })
})

describe('PurgeParticipantDialog', () => {
  it('asks the question in words, with the kinds one tap away and the download prompt up front', async () => {
    const user = userEvent.setup()
    renderTab()
    const dialog = await openPurge(user)
    expect(within(dialog).getByText("Purge Zoe Campbell's record?")).toBeInTheDocument()
    expect(within(dialog).getByText("This permanently deletes their record and everything linked to it: 1,204 records of 4 kinds. It can't be undone.")).toBeInTheDocument()
    expect(within(dialog).getByText("See what's deleted")).toBeInTheDocument()
    expect(within(dialog).getByText('Shifts: 820')).toBeInTheDocument()
    expect(within(dialog).getByText('Download their data first')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Type their last name, Campbell, to confirm')).toBeInTheDocument()
    expect(within(dialog).getByText("Don't include their name or details.")).toBeInTheDocument()
  })

  it('enables Purge record only with the last name (any case, spaces trimmed) and a reason', async () => {
    const user = userEvent.setup()
    renderTab()
    await openPurge(user)
    const name = screen.getByLabelText('Type their last name, Campbell, to confirm')
    const reason = screen.getByLabelText('Reason')
    expect(confirmButton()).toBeDisabled()
    await user.type(name, ' campbell ')
    expect(confirmButton()).toBeDisabled()
    await user.type(reason, 'Seven years have passed')
    expect(confirmButton()).toBeEnabled()
    await user.clear(name)
    expect(confirmButton()).toBeDisabled()
    await user.type(name, 'Campbell')
    await user.clear(reason)
    expect(confirmButton()).toBeDisabled()
  })

  it('shows each field error on blur', async () => {
    const user = userEvent.setup()
    renderTab()
    await openPurge(user)
    await user.type(screen.getByLabelText('Type their last name, Campbell, to confirm'), 'Camp')
    await user.tab()
    expect(screen.getByText("The last name doesn't match.")).toBeInTheDocument()
    await user.click(screen.getByLabelText('Reason'))
    await user.tab()
    expect(screen.getByText('Give a reason for the purge.')).toBeInTheDocument()
  })

  it('a 409 not-due answer says why and leaves Purge record disabled', async () => {
    const user = userEvent.setup()
    apiPost.mockRejectedValue(answered(409, "This record isn't due for purge."))
    renderTab()
    await openPurge(user)
    await user.type(screen.getByLabelText('Type their last name, Campbell, to confirm'), 'Campbell')
    await user.type(screen.getByLabelText('Reason'), 'Seven years have passed')
    await user.click(confirmButton())
    expect(await screen.findByText("This record isn't due for purge. It may have been restored or have newer activity, so its 7 years start again. The list is refreshed.")).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })

  it('swaps the download prompt for the saved file once their data is downloaded', async () => {
    const user = userEvent.setup()
    get.mockResolvedValue(zipResponse)
    renderTab()
    const dialog = await openPurge(user)
    await user.click(within(dialog).getByRole('button', { name: 'Download their data' }))
    expect(await within(dialog).findByText('Their data is downloaded')).toBeInTheDocument()
    expect(within(dialog).getByText('Saved as bunya-support-participant-zoe-campbell-2026-11-06.zip. Keep it somewhere secure.')).toBeInTheDocument()
    expect(within(dialog).queryByText('Download their data first')).toBeNull()
  })

  it('on success removes the row and moves focus to the success note', async () => {
    const user = userEvent.setup()
    apiPost.mockResolvedValue({ id: 'r1', participantId: 'p-zoe', rowCounts: { Shifts: 820, ShiftNotes: 384 } })
    apiGet.mockResolvedValueOnce([zoe, margaret]).mockResolvedValue([margaret])
    renderTab()
    await openPurge(user)
    await user.type(screen.getByLabelText('Type their last name, Campbell, to confirm'), 'Campbell')
    await user.type(screen.getByLabelText('Reason'), 'Seven years have passed')
    await user.click(confirmButton())
    expect(apiPost).toHaveBeenCalledWith('/data-retention/p-zoe/purge', { lastName: 'Campbell', reason: 'Seven years have passed' })
    const note = await screen.findByText('Record purged')
    await waitFor(() => expect(note.closest('div[tabindex="-1"]')).toHaveFocus())
    expect(screen.getByText("Zoe Campbell's record and 1,204 linked records were deleted. A note of the purge, with no personal details, stays in Bunya Support. The task in Tasks updates after the next nightly check.")).toBeInTheDocument()
    expect(screen.queryByText('Zoe Campbell')).toBeNull()
    expect(screen.getByText('Margaret Doyle')).toBeInTheDocument()
  })
})
