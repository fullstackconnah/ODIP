import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderGroup, announcement, facts, headers } from './groupHarness'
import { isClean, useCompletionsGroup } from './useCompletionsGroup'

vi.mock('@/lib/firebase', () => ({ auth: null, devAuthEnabled: true }))
const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet, apiPost }))

const item = (o: Record<string, unknown> = {}) => ({
  shiftId: 's1', completionId: 'c1', participantName: 'Grace Palmer-Hughes', staffName: 'Sam Lee', serviceDate: '2026-10-14',
  rosteredStart: '2026-10-13T22:00:00Z', rosteredEnd: '2026-10-14T04:00:00Z', actualStart: '2026-10-13T22:02:00Z', actualEnd: '2026-10-14T04:04:00Z',
  varianceMinutesStart: 2, varianceMinutesEnd: 4, status: 'PendingReview', timeZoneId: 'Australia/Sydney', isOutlierVariance: false, varianceReviewMinutes: 15,
  returnCount: 0, dosesWithoutOutcome: 0, breakMinutes: 0, startWasManual: false, timesAdjusted: false, incidentCount: 0, ...o,
})
const page = (items: unknown[], totalCount = items.length) => ({ items, totalCount, page: 1, pageSize: 5, totalPages: 1, hasNext: false, hasPrevious: false })
const APPROVE = 'Approve shift: Sam Lee with Grace Palmer-Hughes, 14 Oct'

beforeEach(() => {
  apiGet.mockReset()
  apiPost.mockReset()
})

describe('Shift completions group — what it reads', () => {
  it("reads the whole pending queue in one request (the server's page maximum), counts its total, and says See all when rows are cut", async () => {
    apiGet.mockResolvedValue(page([item()], 12))
    renderGroup(() => useCompletionsGroup(true))

    await screen.findByText('Sam Lee')
    // Complete all counts the clean rows of the whole queue (decision-bulk DECISIONS 1), so the group reads it all; it still shows five.
    expect(apiGet).toHaveBeenCalledWith('/rostering/completions', { status: 'PendingReview', page: 1, pageSize: 200 })
    expect(screen.getByRole('tab', { name: 'Completions (12)' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all shift completions' })).toHaveAttribute('href', '/rostering/completions')
  })

  it("heads its columns Staff, Participant, Shift and Variance, and reads the variance as the Completions page does", async () => {
    apiGet.mockResolvedValue(page([item(), item({ shiftId: 's2', staffName: 'Ana Ruiz', varianceMinutesStart: 0, varianceMinutesEnd: -12, actualEnd: null })]))
    renderGroup(() => useCompletionsGroup(true))

    await screen.findByText('Sam Lee')
    expect(headers()).toEqual(['Staff', 'Participant', 'Shift', 'Variance', ''])
    expect(facts('Sam Lee')).toEqual(['Grace Palmer-Hughes', expect.stringMatching(/^14 Oct, 9:02.+ – 3:04.+$/), '+2 min / +4 min'])
    // A shift still open ends in an ellipsis.
    expect(facts('Ana Ruiz')).toEqual(['Grace Palmer-Hughes', expect.stringMatching(/^14 Oct, 9:02.+ – …$/), 'On time / -12 min'])
  })
})

describe('Shift completions group — clean rows approve in one tap', () => {
  it('approves through useApproveCompletion (the budget and badge caches with it), takes the row away and announces it', async () => {
    apiGet.mockResolvedValue(page([item()]))
    apiPost.mockResolvedValue({})
    const { client } = renderGroup(() => useCompletionsGroup(true))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fireEvent.click(await screen.findByRole('button', { name: APPROVE }))

    await waitFor(() => expect(announcement()).toHaveTextContent("Approved Sam Lee's shift with Grace Palmer-Hughes on 14 Oct."))
    expect(apiPost).toHaveBeenCalledWith('/rostering/shifts/s1/completion/approve')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rostering-completions'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument()
  })

  it.each([
    [{ incidentCount: 1 }, '1 incident'],
    [{ dosesWithoutOutcome: 2 }, '2 doses unrecorded'],
    [{ isOutlierVariance: true }, 'Outlier time'],
    [{ startWasManual: true }, 'Manual start'],
    [{ timesAdjusted: true }, 'Times adjusted'],
  ])('gives a flagged row (%o) Review, a link to the full page, never Approve', async (flag, label) => {
    apiGet.mockResolvedValue(page([item(flag)]))
    renderGroup(() => useCompletionsGroup(true))

    expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: APPROVE })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review shift: Sam Lee with Grace Palmer-Hughes, 14 Oct' })).toHaveAttribute('href', '/rostering/completions')
  })

  it('never offers one tap when the server sent no incident count', async () => {
    const withoutCount: Record<string, unknown> = item()
    delete withoutCount.incidentCount
    apiGet.mockResolvedValue(page([withoutCount]))
    renderGroup(() => useCompletionsGroup(true))

    expect(await screen.findByRole('link', { name: 'Review shift: Sam Lee with Grace Palmer-Hughes, 14 Oct' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: APPROVE })).not.toBeInTheDocument()
    expect(isClean(withoutCount as never)).toBe(false)
  })
})

describe('Shift completions group — Return needs a reason', () => {
  const openReturn = async () => {
    apiGet.mockResolvedValue(page([item()]))
    apiPost.mockResolvedValue({})
    renderGroup(() => useCompletionsGroup(true))
    fireEvent.click(await screen.findByRole('button', { name: 'Return shift: Sam Lee with Grace Palmer-Hughes, 14 Oct' }))
    expect(screen.getByText('Sam sees this.')).toBeInTheDocument()
    return screen.getByLabelText(/Why are you returning it/)
  }
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Return shift' }))

  it('refuses a reason of only spaces here, and sends nothing', async () => {
    fireEvent.change(await openReturn(), { target: { value: '    ' } })
    submit()

    expect(screen.getByRole('alert')).toHaveTextContent("Say why you're returning it.")
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('sends 500 trimmed characters, and refuses 501, as the server does', async () => {
    const field = await openReturn()
    fireEvent.change(field, { target: { value: ` ${'x'.repeat(501)} ` } })
    submit()
    expect(screen.getByRole('alert')).toHaveTextContent('Keep it to 500 characters.')
    expect(apiPost).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: ` ${'x'.repeat(500)} ` } })
    submit()
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/rostering/shifts/s1/completion/return', { reason: 'x'.repeat(500) }))
  })

  it('returns through useReturnCompletion with the trimmed reason, takes the row away and announces it', async () => {
    fireEvent.change(await openReturn(), { target: { value: '  Break times are missing.  ' } })
    submit()

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/rostering/shifts/s1/completion/return', { reason: 'Break times are missing.' }))
    await waitFor(() => expect(announcement()).toHaveTextContent("Returned Sam Lee's shift on 14 Oct."))
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument()
  })

  it("keeps the reason and shows the server's refusal in the field", async () => {
    apiGet.mockResolvedValue(page([item()]))
    apiPost.mockRejectedValue({ response: { data: { message: 'This shift is already on a claim.' } } })
    renderGroup(() => useCompletionsGroup(true))
    fireEvent.click(await screen.findByRole('button', { name: 'Return shift: Sam Lee with Grace Palmer-Hughes, 14 Oct' }))
    fireEvent.change(screen.getByLabelText(/Why are you returning it/), { target: { value: 'Late start' } })
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('This shift is already on a claim.')
    expect(screen.getByLabelText(/Why are you returning it/)).toHaveValue('Late start')
  })
})

describe('Shift completions group — Complete all (decision-bulk)', () => {
  it('approves every clean row of the whole queue through the existing batch, never a flagged one, and reports the rest in one notice', async () => {
    const clean = ['s1', 's2', 's3', 's4', 's5', 's6'].map((shiftId, i) => item({ shiftId, staffName: `Worker ${i + 1}` }))
    apiGet.mockResolvedValue(page([...clean, item({ shiftId: 's7', staffName: 'Flagged Fay', incidentCount: 1 })]))
    apiPost.mockResolvedValue([
      ...['s1', 's2', 's3', 's4'].map((shiftId) => ({ shiftId, approved: true, code: null, message: null })),
      { shiftId: 's5', approved: false, code: 'SHIFT_NOT_PENDING_REVIEW', message: 'This shift is not awaiting review.' },
      { shiftId: 's6', approved: false, code: 'SHIFT_COMPLETION_NOT_FOUND', message: 'Shift completion not found.' },
    ])
    const { client } = renderGroup(() => useCompletionsGroup(true))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 6 clean shift completions' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve 6 clean completions?')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('The 1 that needs review stays here.')
    fireEvent.click(screen.getByRole('button', { name: 'Approve 6' }))

    await waitFor(() => expect(screen.getByText('Approved 4 completions')).toBeInTheDocument())
    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledWith('/rostering/completions/approve-batch', { shiftIds: ['s1', 's2', 's3', 's4', 's5', 's6'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rostering-completions'] })
    expect(screen.getByText(
      "1 needs review and stays here. 1 was already reviewed. 1 couldn't be approved: Worker 6 with Grace Palmer-Hughes, 14 Oct: Shift completion not found.")).toBeInTheDocument()
  })

  it('sends the first 100 clean ids over the cap, and says so', async () => {
    apiGet.mockResolvedValue(page(Array.from({ length: 134 }, (_, i) => item({ shiftId: `s${i}`, staffName: `Worker ${i}` }))))
    apiPost.mockImplementation(async (_url: string, body: { shiftIds: string[] }) => body.shiftIds.map((shiftId) => ({ shiftId, approved: true, code: null, message: null })))
    renderGroup(() => useCompletionsGroup(true))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve the first 100 of 134 clean shift completions' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve the first 100 of 134 clean completions?')
    fireEvent.click(screen.getByRole('button', { name: 'Approve 100' }))

    await waitFor(() => expect(screen.getByText('Approved 100 of 134')).toBeInTheDocument())
    expect(apiPost.mock.calls[0][1].shiftIds).toEqual(Array.from({ length: 100 }, (_, i) => `s${i}`))
    expect(screen.getByText('Run it again for the rest.')).toBeInTheDocument()
  })

  it('says nothing was approved when the batch fails whole, and keeps every row', async () => {
    apiGet.mockResolvedValue(page([item(), item({ shiftId: 's2', staffName: 'Ana Ruiz' })]))
    apiPost.mockRejectedValue({ response: { status: 500 } })
    renderGroup(() => useCompletionsGroup(true))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 2 clean shift completions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }))

    await waitFor(() => expect(screen.getByText("Couldn't approve 2 completions")).toBeInTheDocument())
    expect(screen.getByText('Nothing was approved.')).toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
  })
})
