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
const page = (items: unknown[], totalCount = items.length) => ({ items, totalCount, page: 1, pageSize: 5, totalPages: 1, hasNext: false, hasPrevious: false, nextCursor: items.length ? `after-${(items[items.length - 1] as { shiftId: string }).shiftId}` : null })
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
    apiGet.mockResolvedValueOnce(page([item()])).mockResolvedValue(page([]))   // decided: the read after it no longer lists the row
    apiPost.mockResolvedValue({})
    const { client } = renderGroup(() => useCompletionsGroup(true))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fireEvent.click(await screen.findByRole('button', { name: APPROVE }))

    await waitFor(() => expect(announcement()).toHaveTextContent("Approved Sam Lee's shift with Grace Palmer-Hughes on 14 Oct."))
    // requireClean: a flag that appeared since the queue read refuses on the server rather than approves (decision-bulk deep M2).
    expect(apiPost).toHaveBeenCalledWith('/rostering/shifts/s1/completion/approve?requireClean=true')
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
    apiGet.mockResolvedValueOnce(page([item()])).mockResolvedValue(page([]))
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
      // s6 has no answer at all: a failure, named. (Not found, by any code, is stale like the single approve's 404.)
    ])
    const { client } = renderGroup(() => useCompletionsGroup(true))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 6 clean shift completions' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve 6 clean completions?')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('The 1 that needs review stays here.')
    fireEvent.click(screen.getByRole('button', { name: 'Approve 6' }))

    await waitFor(() => expect(screen.getByText('Approved 4 completions')).toBeInTheDocument())
    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledWith('/rostering/completions/approve-batch', { shiftIds: ['s1', 's2', 's3', 's4', 's5', 's6'], cleanOnly: true })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rostering-completions'] })
    expect(screen.getByText(
      "1 needs review and stays here. 1 was already reviewed. 1 couldn't be approved: Worker 6 with Grace Palmer-Hughes, 14 Oct.")).toBeInTheDocument()
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

  it('counts a shift the server found flagged at approval time as needing review, not as a failure', async () => {
    apiGet.mockResolvedValue(page([item(), item({ shiftId: 's2', staffName: 'Ana Ruiz' })]))
    apiPost.mockResolvedValue([
      { shiftId: 's1', approved: true, code: null, message: null },
      { shiftId: 's2', approved: false, code: 'SHIFT_NEEDS_REVIEW', message: 'This shift needs review now: open it on the Completions page.' },
    ])
    renderGroup(() => useCompletionsGroup(true))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 2 clean shift completions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }))

    await waitFor(() => expect(screen.getByText('Approved 1 completion')).toBeInTheDocument())
    expect(screen.getByText('1 needs review and stays here.')).toBeInTheDocument()
    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument()
  })

  it("counts a shift or completion gone (the single approve's 404) as stale, not failed", async () => {
    apiGet.mockResolvedValue(page([item(), item({ shiftId: 's2', staffName: 'Ana Ruiz' })]))
    apiPost.mockResolvedValue([
      { shiftId: 's1', approved: false, code: null, message: 'Shift not found.' },
      { shiftId: 's2', approved: false, code: 'SHIFT_COMPLETION_NOT_FOUND', message: 'Shift completion not found.' },
    ])
    renderGroup(() => useCompletionsGroup(true))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 2 clean shift completions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }))

    await waitFor(() => expect(screen.getByText("Couldn't approve 2 completions")).toBeInTheDocument())
    expect(screen.getByText('2 were already reviewed.')).toBeInTheDocument()
  })

  it.each([400, 500])('says nothing was approved when ODIP answers the batch with a %i, and keeps every row', async (status) => {
    apiGet.mockResolvedValue(page([item(), item({ shiftId: 's2', staffName: 'Ana Ruiz' })]))
    apiPost.mockRejectedValue({ response: { status, data: { success: false, message: 'Nope.' } } })
    renderGroup(() => useCompletionsGroup(true))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 2 clean shift completions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }))

    await waitFor(() => expect(screen.getByText("Couldn't approve 2 completions")).toBeInTheDocument())
    expect(screen.getByText('Nothing was approved.')).toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
  })
})

describe('Shift completions group — a batch with no answer (review #266 F1)', () => {
  const two = () => [item(), item({ shiftId: 's2', staffName: 'Ana Ruiz' })]
  const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} })
  const notice = () => document.querySelector('[data-quick-group] [role="status"] [data-tone]')
  const runAll = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 2 clean shift completions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }))
  }

  it('re-reads the queue when the reply is lost, and lets the rows that left go without crediting them or offering a retry', async () => {
    // Both are gone from the list, and the status read confirms they were decided.
    apiGet.mockImplementation(async (url: string) => (url.startsWith('/rostering/completions/statuses')
      ? [{ shiftId: 's1', status: 'Completed' }, { shiftId: 's2', status: 'Returned' }]
      : apiGet.mock.calls.filter(([u]) => u === '/rostering/completions').length === 1 ? page(two()) : page([])))
    apiPost.mockRejectedValue(networkError())
    renderGroup(() => useCompletionsGroup(true))
    await runAll()

    await waitFor(() => expect(notice()).toHaveTextContent('No answer for 2 completions'))
    expect(notice()).toHaveTextContent('2 have left the list: approved here, or decided by someone else.')
    expect(notice()).not.toHaveTextContent('Nothing was approved')
    expect(apiGet).toHaveBeenCalledTimes(3)   // the queue, its re-read, and the status read of the two missing rows
    expect(screen.queryByText('Sam Lee')).toBeNull()
    expect(screen.queryByRole('button', { name: APPROVE })).toBeNull()
  })

  it('keeps the rows the re-read still lists as waiting, live for a retry, and never says they were approved', async () => {
    apiGet.mockResolvedValue(page(two()))
    apiPost.mockRejectedValue({ response: { status: 504 } })
    renderGroup(() => useCompletionsGroup(true))
    await runAll()

    await waitFor(() => expect(notice()).toHaveTextContent('No answer for 2 completions'))
    expect(notice()).toHaveTextContent("2 weren't approved: they're still here to try again.")
    expect(notice()).not.toHaveTextContent('left the list')
    expect(apiGet).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: APPROVE })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: 'Approve all 2 clean shift completions' })).toBeInTheDocument()
  })

  it('asks for a refresh when the re-read fails too, and holds the rows: no retry until a fresh read', async () => {
    apiGet.mockResolvedValueOnce(page(two())).mockRejectedValue(networkError())
    apiPost.mockRejectedValue(networkError())
    renderGroup(() => useCompletionsGroup(true))
    await runAll()

    await waitFor(() => expect(notice()).toHaveTextContent('No answer for 2 completions'))
    expect(notice()).toHaveTextContent("2 couldn't be checked, so they're held here until the list can be read again. Refresh the page to check now.")
    expect(notice()).not.toHaveTextContent('Nothing was approved')
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: APPROVE })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('button', { name: /^Approve all/ })).toBeNull()
  })

  it.each([[500, '<html>Bad gateway</html>'], [524, '<html>A timeout occurred</html>'], [500, undefined]])(
    'treats a %i with no ODIP envelope (a proxy page) as no answer, and re-reads', async (status, data) => {
      apiGet.mockResolvedValue(page(two()))
      apiPost.mockRejectedValue({ response: { status, data } })
      renderGroup(() => useCompletionsGroup(true))
      await runAll()

      await waitFor(() => expect(notice()).toHaveTextContent('No answer for 2 completions'))
      expect(notice()).not.toHaveTextContent('Nothing was approved')
      expect(apiGet).toHaveBeenCalledTimes(2)
    })

  it("treats ODIP's own problem body on a 4xx as a confirmed failure", async () => {
    apiGet.mockResolvedValue(page(two()))
    apiPost.mockRejectedValue({ response: { status: 400, data: { type: 'x', title: 'One or more validation errors occurred.', status: 400, errors: {} } } })
    renderGroup(() => useCompletionsGroup(true))
    await runAll()

    await waitFor(() => expect(screen.getByText('Nothing was approved.')).toBeInTheDocument())
  })

  it('refreshes the side caches an answered batch would, when the reply is lost', async () => {
    apiGet.mockResolvedValue(page(two()))
    apiPost.mockRejectedValue(networkError())
    const { client } = renderGroup(() => useCompletionsGroup(true))
    const spy = vi.spyOn(client, 'invalidateQueries')
    await runAll()

    await waitFor(() => expect(notice()).toHaveTextContent('No answer for 2 completions'))
    const keys = spy.mock.calls.map(([filters]) => JSON.stringify((filters as { queryKey?: unknown })?.queryKey))
    expect(keys).toContain(JSON.stringify(['roster-board']))
    expect(keys).toContain(JSON.stringify(['rostering-completion-review']))
    expect(keys.length).toBeGreaterThan(2) // and the budget figures (refreshBudgetFigures)
  })

  it("marks each held row \"Not confirmed yet\", and the mark survives dismissing the notice", async () => {
    apiGet.mockResolvedValueOnce(page(two())).mockRejectedValue(networkError())
    apiPost.mockRejectedValue(networkError())
    renderGroup(() => useCompletionsGroup(true))
    await runAll()

    await waitFor(() => expect(notice()).toHaveTextContent('No answer for 2 completions'))
    expect(screen.getAllByText("Not confirmed yet")).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(notice()).toBeNull()
    expect(screen.getAllByText("Not confirmed yet")).toHaveLength(2)
    expect(screen.getByRole('button', { name: APPROVE })).toHaveAttribute('aria-disabled', 'true')
  })

  it('releases the held rows on the next successful read: the pending one goes live, the gone one leaves', async () => {
    apiGet.mockResolvedValueOnce(page(two())).mockRejectedValueOnce(networkError()).mockResolvedValue(page([item()]))
    apiPost.mockRejectedValue(networkError())
    const { client } = renderGroup(() => useCompletionsGroup(true))
    await runAll()
    await waitFor(() => expect(notice()).toHaveTextContent("couldn't be checked"))
    expect(screen.getAllByText("Not confirmed yet")).toHaveLength(2)

    await client.refetchQueries({ queryKey: ['rostering-completions'] })

    await waitFor(() => expect(screen.queryByText("Not confirmed yet")).toBeNull())
    expect(screen.queryByText('Ana Ruiz')).toBeNull()
    expect(screen.getByRole('button', { name: APPROVE })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: 'Approve 1 clean shift completion' })).toBeInTheDocument()
  })

  it('keeps the rows held while later reads keep failing', async () => {
    apiGet.mockResolvedValueOnce(page(two())).mockRejectedValue(networkError())
    apiPost.mockRejectedValue(networkError())
    const { client } = renderGroup(() => useCompletionsGroup(true))
    await runAll()
    await waitFor(() => expect(notice()).toHaveTextContent("couldn't be checked"))

    await client.refetchQueries({ queryKey: ['rostering-completions'] })

    expect(screen.getAllByText("Not confirmed yet")).toHaveLength(2)
  })

  it('re-reads the queue after the server skipped a row as needing review, so it redraws flagged (deep R-N1)', async () => {
    apiGet.mockResolvedValue(page(two()))
    apiPost.mockResolvedValue([
      { shiftId: 's1', approved: true, code: null, message: null },
      { shiftId: 's2', approved: false, code: 'SHIFT_NEEDS_REVIEW', message: 'This shift needs review now.' },
    ])
    renderGroup(() => useCompletionsGroup(true))
    await runAll()

    await waitFor(() => expect(notice()).toHaveTextContent('1 needs review and stays here.'))
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
  })
})

describe('Shift completions group — the whole queue past one page (review #266 F2)', () => {
  it('pages the whole pending queue: 200 flagged first, 50 clean after them, counted and sent', async () => {
    const flagged = Array.from({ length: 200 }, (_, i) => item({ shiftId: `f${i}`, staffName: `Flagged ${i}`, isOutlierVariance: true }))
    const clean = Array.from({ length: 50 }, (_, i) => item({ shiftId: `c${i}`, staffName: `Clean ${i}` }))
    apiGet.mockImplementation(async (_url: string, params: { after?: string }) => (params.after ? page(clean, 250) : page(flagged, 250)))
    apiPost.mockImplementation(async (_url: string, body: { shiftIds: string[] }) => body.shiftIds.map((shiftId) => ({ shiftId, approved: true, code: null, message: null })))
    renderGroup(() => useCompletionsGroup(true))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 50 clean shift completions' }))
    expect(apiGet).toHaveBeenCalledWith('/rostering/completions', { status: 'PendingReview', pageSize: 200, after: 'after-f199' })
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve 50 clean completions?')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('The 200 that need review stay here.')
    fireEvent.click(screen.getByRole('button', { name: 'Approve 50' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(apiPost.mock.calls[0][1].shiftIds).toEqual(clean.map((c) => c.shiftId))
  })

  it('shows no count until every page has answered', async () => {
    let second!: (v: unknown) => void
    apiGet.mockImplementation((_url: string, params: { after?: string }) => (!params.after
      ? Promise.resolve(page(Array.from({ length: 200 }, (_, i) => item({ shiftId: `f${i}`, isOutlierVariance: true })), 201))
      : new Promise((resolve) => { second = resolve })))
    renderGroup(() => useCompletionsGroup(true))

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Loading shift completions…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
    second(page([item({ shiftId: 'c1' })], 201))
    expect(await screen.findByRole('button', { name: 'Approve 1 clean shift completion' })).toBeInTheDocument()
  })
})

describe('Shift completions group — the queue changes while it is read (lil dude, PR #275)', () => {
  const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} })
  const notice = () => document.querySelector('[data-quick-group] [role="status"] [data-tone]')

  /** A server that pages by keyset (after = the cursor of the last row, as the real endpoint does) over rows the test can change between requests. */
  const keysetServer = (rows: () => Array<{ shiftId: string }>, afterRequest?: (n: number) => void) => {
    let requests = 0
    apiGet.mockImplementation(async (url: string, params: { after?: string; pageSize: number }) => {
      if (url !== '/rostering/completions') throw new Error('unexpected ' + url)
      const all = rows()
      const from = params.after ? all.findIndex((r) => `after-${r.shiftId}` === params.after) + 1 : 0
      const slice = all.slice(from, from + params.pageSize)
      afterRequest?.(++requests)
      return page(slice, all.length)
    })
  }

  it('keeps a clean row visible and actionable when a page-one row is decided between page requests', async () => {
    let rows: Array<ReturnType<typeof item>> = [
      ...Array.from({ length: 200 }, (_, i) => item({ shiftId: `f${i}`, staffName: `Flagged ${i}`, isOutlierVariance: true })),
      item({ shiftId: 'x', staffName: 'Xavier Reed' }),
    ]
    // Another reviewer decides flagged row f0 right after page one is read: with OFFSET paging X slid up to offset 199 and page two came back without it.
    keysetServer(() => rows, (n) => { if (n === 1) rows = rows.filter((r) => r.shiftId !== 'f0') })
    const { client } = renderGroup(() => useCompletionsGroup(true))

    // Complete all counts the clean rows of the whole queue: the one clean row after the 200 flagged ones must be in it, after the poll too.
    expect(await screen.findByRole('button', { name: 'Approve 1 clean shift completion' })).toBeInTheDocument()
    await client.refetchQueries({ queryKey: ['rostering-completions'] })
    expect(await screen.findByRole('button', { name: 'Approve 1 clean shift completion' })).toBeInTheDocument()
  })

  it('does not call a sent row "left" because the paged list lacks it: it asks the server what became of it', async () => {
    // s2 is still pending, but this read of the list happens not to carry it.
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/rostering/completions/statuses')) return [{ shiftId: 's2', status: 'PendingReview' }, { shiftId: 's1', status: 'Completed' }]
      return apiGet.mock.calls.filter(([u]) => u === '/rostering/completions').length === 1 ? page([item(), item({ shiftId: 's2', staffName: 'Ana Ruiz' })]) : page([])
    })
    apiPost.mockRejectedValue(networkError())
    renderGroup(() => useCompletionsGroup(true))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 2 clean shift completions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }))

    await waitFor(() => expect(notice()).toHaveTextContent('No answer for 2 completions'))
    expect(notice()).toHaveTextContent('1 has left the list: approved here, or decided by someone else.')
    expect(notice()).toHaveTextContent("1 wasn't approved: it's still here to try again.")
    const ids = apiGet.mock.calls.map(([u]) => u).find((u) => String(u).startsWith('/rostering/completions/statuses'))
    expect(ids).toBe('/rostering/completions/statuses?shiftIds=s1&shiftIds=s2')
  })

  it('holds the rows when the status read fails too', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/rostering/completions/statuses')) throw networkError()
      return apiGet.mock.calls.filter(([u]) => u === '/rostering/completions').length === 1 ? page([item(), item({ shiftId: 's2', staffName: 'Ana Ruiz' })]) : page([])
    })
    apiPost.mockRejectedValue(networkError())
    renderGroup(() => useCompletionsGroup(true))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 2 clean shift completions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }))

    await waitFor(() => expect(notice()).toHaveTextContent("2 couldn't be checked"))
  })

  it('shows a row again when a fresh read lists it, even after it was marked decided here', async () => {
    // The first read lists the row, the read after the approve does not, a later one lists it again (the approval did not stick).
    apiGet.mockResolvedValueOnce(page([item()])).mockResolvedValueOnce(page([])).mockResolvedValue(page([item()]))
    apiPost.mockResolvedValue({})
    const { client } = renderGroup(() => useCompletionsGroup(true))

    fireEvent.click(await screen.findByRole('button', { name: APPROVE }))
    await waitFor(() => expect(screen.queryByText('Sam Lee')).toBeNull())   // decided here, and the next read agrees

    await client.refetchQueries({ queryKey: ['rostering-completions'] })   // the server still lists it as pending

    expect(await screen.findByText('Sam Lee')).toBeInTheDocument()
  })
})
