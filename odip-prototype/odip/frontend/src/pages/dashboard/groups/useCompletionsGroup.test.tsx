import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderGroup, announcement } from './groupHarness'
import { isClean, useCompletionsGroup } from './useCompletionsGroup'

vi.mock('@/lib/firebase', () => ({ auth: null, devAuthEnabled: true }))
const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet, apiPost }))

const item = (o: Record<string, unknown> = {}) => ({
  shiftId: 's1', completionId: 'c1', participantName: 'Grace Palmer-Hughes', staffName: 'Sam Lee', serviceDate: '2026-10-14',
  rosteredStart: '2026-10-13T22:00:00Z', rosteredEnd: '2026-10-14T04:00:00Z', actualStart: '2026-10-13T22:02:00Z', actualEnd: '2026-10-14T04:04:00Z',
  varianceMinutesStart: 2, varianceMinutesEnd: 4, status: 'PendingReview', timeZoneId: 'Australia/Sydney', isOutlierVariance: false, varianceReviewMinutes: 15,
  returnCount: 0, dosesWithoutOutcome: 0, breakMinutes: 0, startWasManual: false, incidentCount: 0, ...o,
})
const page = (items: unknown[], totalCount = items.length) => ({ items, totalCount, page: 1, pageSize: 5, totalPages: 1, hasNext: false, hasPrevious: false })
const APPROVE = 'Approve shift: Sam Lee with Grace Palmer-Hughes, 14 Oct'

beforeEach(() => {
  apiGet.mockReset()
  apiPost.mockReset()
})

describe('Shift completions group — what it reads', () => {
  it('asks the review queue for its first five, counts its total, and says See all when rows are cut', async () => {
    apiGet.mockResolvedValue(page([item()], 12))
    renderGroup(() => useCompletionsGroup(true))

    await screen.findByText('Sam Lee')
    expect(apiGet).toHaveBeenCalledWith('/rostering/completions', { status: 'PendingReview', page: 1, pageSize: 5 })
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all shift completions' })).toHaveAttribute('href', '/rostering/completions')
    expect(screen.getByText(/^Grace Palmer-Hughes · 14 Oct · .+ – .+$/)).toBeInTheDocument()
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
