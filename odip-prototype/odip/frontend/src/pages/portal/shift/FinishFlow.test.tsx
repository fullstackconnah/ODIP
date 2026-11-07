import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FinishFlow } from './FinishFlow'
import { EMPTY_END_DRAFT, loadEndDraft, saveEndDraft, type EndDraft } from './endDraft'
import type { PortalShiftDetailDto } from '@/api/types'

const h = vi.hoisted(() => ({ finish: vi.fn(), save: vi.fn(), notes: { value: [] as unknown[] }, records: [] as { shiftId: string; kind: string; status: string }[] }))

vi.mock('@/api/hooks', () => ({
  useFinishShift: () => ({ mutateAsync: h.finish, isPending: false }),
  useSaveFinishDetails: () => ({ mutateAsync: h.save, isPending: false }),
  useShiftNotes: () => ({ data: h.notes.value }),
}))
vi.mock('@/api/hooks/portal', () => ({ useQueueRecords: () => h.records }))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ id: 'user-1' }) }))

// Brisbane is UTC+10. Rostered 09:00 to 17:00; started 09:05:40; tapped End shift at 17:00:30 (07:00:30Z).
const TAP = '2026-08-17T07:00:30Z'
const shift = (over: Record<string, unknown> = {}, completion: Record<string, unknown> = {}) => ({
  id: 's1', status: 'PendingReview', timeZoneId: 'Australia/Brisbane', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
  travelAsked: true, breaks: [], medicationsDue: [], prn: [], shiftRoutines: [], finishBlockers: [], canRecordDoses: true, missingDetails: [],
  participant: { id: 'p1', fullName: 'Alexandra Reid' },
  completion: {
    actualStart: '2026-08-16T23:05:40Z', actualEnd: TAP, originalActualStart: null, originalActualEnd: null, timeAdjustmentReason: null, startTimeReason: null,
    finishTimeReason: null, kilometres: null, anythingToReport: null, handoverText: null, nothingToHandOver: false, nothingToNoteConfirmed: false,
    preTravelNone: false, postTravelNone: false, ...completion,
  },
  ...over,
}) as unknown as PortalShiftDetailDto

/** Every answer typed: the page opens with this draft. */
const ANSWERED: Partial<EndDraft> = {
  open: true, touched: true, kilometres: '0', preTravelNone: true, postTravelNone: true, anythingToReport: 'no', nothingToHandOver: true, nothingToNote: true,
}
const draft = (over: Partial<EndDraft> = {}) => saveEndDraft('s1', { ...EMPTY_END_DRAFT, ...ANSWERED, ...over })

function renderFlow(s = shift(), over: { online?: boolean; onClose?: () => void } = {}) {
  const onClose = over.onClose ?? vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FinishFlow shift={s} online={over.online ?? true} canAct ending={false} onRecord={vi.fn()} onClose={onClose} onEditNotes={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return onClose
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Submit shift' }))
const barAlert = () => within(screen.getByRole('toolbar', { name: 'Shift actions' })).getByRole('alert')
// The sync row is an empty status too, so pick the one with the notice text.
const barStatus = () => within(screen.getByRole('toolbar', { name: 'Shift actions' })).getAllByRole('status').find(e => e.textContent)!
const later = () => fireEvent.click(screen.getByRole('button', { name: 'Add details later' }))

describe('FinishFlow: the details page after End shift', () => {
  beforeEach(() => { sessionStorage.clear(); h.finish.mockReset().mockResolvedValue({}); h.save.mockReset().mockResolvedValue({}); h.notes.value = []; h.records = [] })
  afterEach(() => { vi.useRealTimers() })

  it('Submit with everything answered sends one PUT with the answers and closes complete', async () => {
    draft({ kilometres: '12.5', nothingToHandOver: false, handoverText: 'All settled' })
    const onClose = renderFlow()
    expect(screen.queryByRole('button', { name: 'Add details later' })).not.toBeInTheDocument()
    submit()
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0][0].data).toMatchObject({ kilometres: 12.5, handoverText: 'All settled', preTravelNone: true, postTravelNone: true, anythingToReport: false })
    expect(h.finish).not.toHaveBeenCalled()   // already ended
    expect(loadEndDraft('s1')).toBeNull()
  })

  it('typed: Add details later sends the typed fields and leaves incomplete', async () => {
    draft({ kilometres: '7', anythingToReport: null })
    const onClose = renderFlow()
    later()
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(false))
    expect(h.save.mock.calls[0][0].data).toMatchObject({ kilometres: 7, anythingToReport: null })
  })

  it('blank: Submit while a detail is missing sends nothing, says what to add and focuses the first missing field', async () => {
    draft({ kilometres: '' })
    renderFlow()
    submit()
    expect(await waitFor(barAlert)).toHaveTextContent('Add the kilometres you drove with Alexandra, or tap Add details later.')
    expect(document.activeElement).toBe(document.getElementById('finish-km'))
    expect(h.save).not.toHaveBeenCalled()
    expect(h.finish).not.toHaveBeenCalled()
  })

  it('blank: Add details later with a blank kilometres sends null, not zero', async () => {
    draft({ kilometres: '' })
    renderFlow()
    later()
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0][0].data.kilometres).toBeNull()
  })

  it('too long: kilometres over 2,000 is refused on both buttons, nothing sent', async () => {
    draft({ kilometres: '99999' })
    renderFlow()
    later()
    expect(await screen.findByText('Enter kilometres from 0 to 2,000.')).toBeInTheDocument()
    expect(h.save).not.toHaveBeenCalled()
    submit()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('offline: a queued PUT keeps the draft (closed) and returns to the shift', async () => {
    draft({ kilometres: '' })
    h.save.mockResolvedValue(undefined)   // queued
    const onClose = renderFlow(shift(), { online: false })
    later()
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(false))
    expect(loadEndDraft('s1')).toMatchObject({ open: false, touched: true })
  })

  it('edited later: untouched, the page shows what the server saved', () => {
    saveEndDraft('s1', { ...EMPTY_END_DRAFT, open: true })
    renderFlow(shift({}, { kilometres: 12, handoverText: 'Left the keys with Sam', preTravelNone: true, postTravelNone: true, anythingToReport: false, nothingToNoteConfirmed: true }))
    expect(screen.getByLabelText('Kilometres driven with Alexandra')).toHaveValue('12')
    expect(screen.getByLabelText('Your handover note')).toHaveValue('Left the keys with Sam')
  })

  it('edited later: changing only the handover resends the saved start and reasons unchanged (Deep N2)', async () => {
    saveEndDraft('s1', { ...EMPTY_END_DRAFT, open: true })
    renderFlow(shift({}, {
      kilometres: 12, handoverText: 'Left the keys', preTravelNone: true, postTravelNone: true, anythingToReport: false, nothingToNoteConfirmed: true,
      startTimeReason: 'Traffic on the bridge', finishTimeReason: 'Waited for the taxi',
    }))
    fireEvent.change(screen.getByLabelText('Your handover note'), { target: { value: 'Keys with Sam' } })
    submit()
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0][0].data).toMatchObject({
      actualStart: '2026-08-16T23:05:40Z', actualEnd: null, startTimeReason: 'Traffic on the bridge', finishTimeReason: 'Waited for the taxi', handoverText: 'Keys with Sam',
    })
  })

  it('a changed end without a reason is refused; with a reason the end is sent as an instant', async () => {
    draft({ endOverride: '2026-08-17T16:50' })
    renderFlow()
    submit()
    expect(await waitFor(barAlert)).toHaveTextContent('Say why your finish time changed.')
    expect(h.save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Why did your finish time change?'), { target: { value: 'Left early' } })
    submit()
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0][0].data).toMatchObject({ actualEnd: '2026-08-17T06:50:00Z', timeAdjustmentReason: 'Left early' })
  })

  it('noTrip: ticking No trip answers the leg, disables its inputs and completes the page', () => {
    draft({ preTravelNone: false, postTravelNone: true })
    renderFlow()
    expect(screen.getByRole('button', { name: 'Add details later' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'No trip' })[0])
    expect(document.getElementById('finish-pre-min')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Add details later' })).not.toBeInTheDocument()
  })

  it('travel not asked: no legs on the page, and none counted as missing', async () => {
    draft({ preTravelNone: false, postTravelNone: false })
    renderFlow(shift({ travelAsked: false }))
    expect(screen.queryByText('Your trip after the shift')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add details later' })).not.toBeInTheDocument()
  })

  it('a due dose online blocks both buttons and focuses the first Record it', async () => {
    draft()
    renderFlow(shift({ finishBlockers: [{ code: 'DOSE_OUTCOME_MISSING', message: 'Panadol was due', medicationId: 'm1', scheduledAt: '2026-08-17T01:00:00Z' }] }))
    submit()
    expect(await waitFor(barAlert)).toHaveTextContent('Record an outcome for 1 dose before you end the shift.')
    expect(document.activeElement).toBe(document.getElementById('dose-blocker-0'))
    expect(h.save).not.toHaveBeenCalled()
  })

  it('endTap: while the shift is still running, the end sent is the tap, not the moment of Submit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-17T07:12:30Z'))   // 12 minutes after the tap
    draft({ tappedAt: TAP })
    renderFlow(shift({ status: 'InProgress' }, { actualEnd: null }))
    submit()
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.finish).toHaveBeenCalledTimes(1)
    expect(h.finish.mock.calls[0][0].data).toEqual({ detailsLater: true, endTappedAt: TAP })
    expect(h.finish.mock.invocationCallOrder[0]).toBeLessThan(h.save.mock.invocationCallOrder[0])
  })

  it('endTap: a tap older than 25 minutes takes a new tap, sends nothing, and says so; the next press sends the new tap (D2)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-17T07:40:30Z'))
    draft({ tappedAt: TAP })
    renderFlow(shift({ status: 'InProgress' }, { actualEnd: null }))
    submit()
    expect(barStatus()).toHaveTextContent('More than 25 minutes have passed, so your end time is now 5:40 pm. Use Change if you finished earlier.')
    expect(screen.getByRole('heading', { name: 'Ended 5:40 pm' })).toBeInTheDocument()
    expect(h.finish).not.toHaveBeenCalled()
    expect(h.save).not.toHaveBeenCalled()
    expect(loadEndDraft('s1')?.tappedAt).toBe('2026-08-17T07:40:30.000Z')
    vi.setSystemTime(new Date('2026-08-17T07:41:30Z'))
    submit()
    await waitFor(() => expect(h.finish).toHaveBeenCalled())
    expect(h.finish.mock.calls[0][0].data).toEqual({ detailsLater: true, endTappedAt: '2026-08-17T07:40:30.000Z' })
  })

  it('endTap: with a changed finish time the stale-tap notice asks to check it instead of naming a time that is not used (DD1)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-17T07:40:30Z'))
    draft({ tappedAt: TAP, endOverride: '2026-08-17T16:50', adjustmentReason: 'Left early' })
    renderFlow(shift({ status: 'InProgress' }, { actualEnd: null }))
    submit()
    expect(barStatus()).toHaveTextContent(/^Your tap was renewed. Check your finish time.$/)
    expect(within(screen.getByRole('toolbar', { name: 'Shift actions' })).queryByRole('alert')).toBeNull()
  })

  it('S-1: a queued record from another shift leaves Still to add showing (DD2)', () => {
    draft({ kilometres: '', anythingToReport: null })
    h.records = [{ shiftId: 's2', kind: 'note', status: 'waiting' }]
    renderFlow()
    expect(screen.getByText(/Still to add/)).toBeInTheDocument()
  })

  it('S-1: an incomplete page says what is still to add in the bar; a complete page says nothing', () => {
    draft({ kilometres: '', anythingToReport: null })
    renderFlow()
    expect(screen.getByText(/Still to add/)).toHaveTextContent('Still to add: kilometres and anything to report')
    cleanup()
    draft()
    renderFlow()
    expect(screen.queryByText(/Still to add/)).not.toBeInTheDocument()
  })

  it('a server refusal is listed above the bar and the entries are kept', async () => {
    draft({ kilometres: '3' })
    h.save.mockRejectedValue({ response: { status: 409, data: { code: 'SHIFT_NOT_PENDING_REVIEW', errors: ['This shift is no longer open for changes.'] } } })
    renderFlow()
    submit()
    expect(await screen.findByText("This shift can't be saved yet")).toBeInTheDocument()
    expect(loadEndDraft('s1')).toMatchObject({ kilometres: '3' })
  })

  it('a network error says so and the button reads Try again', async () => {
    draft({ kilometres: '3' })
    h.save.mockRejectedValue(new Error('Network Error'))
    renderFlow()
    submit()
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(barAlert()).toHaveTextContent("Couldn't save. Check your connection.")
  })
})
