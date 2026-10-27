import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgreementRow } from '@/api/types'
import { AgreementActionDialog } from './AgreementActionDialog'

const { mockBulk, mockLists } = vi.hoisted(() => ({ mockBulk: vi.fn(), mockLists: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useBulkAgreements: () => ({ mutateAsync: mockBulk }),
  usePriceLists: mockLists,
}))

const row = (name: string, end = '2026-12-31', over: Partial<AgreementRow> = {}): AgreementRow => ({
  participantId: name, participantName: name, status: 'Active', endingState: 'None', hasWaitingDraft: false,
  current: { draftId: `d-${name}`, version: 1, agreementStartDate: '2026-01-01', agreementEndDate: end, total: 1000 }, waiting: null,
  daysLeft: null, termStart: '2026-01-01', priceList: { version: '2025-26', start: '2025-07-01' }, newerPriceList: null, ...over,
})
const lists = (data: { version: string; start: string }[] | undefined, isError = false) => ({ data, isError, refetch: vi.fn() })
const made = { participantId: 'Ana', name: 'Ana', outcome: 'Created', reason: null, sourceDraftId: 'a', newDraftId: 'b', before: null, after: null, hasIssues: false }

function open(action: 'renew' | 'reprice' | 'extend', selected: AgreementRow[], props: Partial<Parameters<typeof AgreementActionDialog>[0]> = {}) {
  const onDone = vi.fn()
  const onClose = vi.fn()
  render(<AgreementActionDialog action={action} selected={selected} onClose={onClose} onDone={onDone} onShowDrafts={vi.fn()} {...props} />)
  return { onDone, onClose }
}

beforeEach(() => {
  mockLists.mockReturnValue(lists([{ version: '2026-27', start: '2026-07-01' }, { version: '2025-26', start: '2025-07-01' }]))
  mockBulk.mockResolvedValue({ results: [made], stopped: null })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('AgreementActionDialog', () => {
  it('renews: sends the action and every ticked id, then hands the results to the page', async () => {
    const { onDone } = open('renew', [row('Ana'), row('Ben')])
    expect(screen.getByRole('heading', { name: 'Renew 2 agreements' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Make 2 drafts' }))
    expect(mockBulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'renew', participantIds: ['Ana', 'Ben'] }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ action: 'renew', label: '', results: [made], stopped: null }))
  })

  it('reprices: defaults to the newest list, sends the chosen version, and warns when it started in the past', async () => {
    const { onDone } = open('reprice', [row('Ana')])
    expect(screen.getByLabelText(/Price list/)).toHaveValue('2026-27')
    expect(screen.getByText(/started [A-Za-z]+ 1 Jul 2026, before today/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText(/Price list/), '2025-26')
    await userEvent.click(screen.getByRole('button', { name: 'Make 1 draft' }))
    expect(mockBulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'reprice', participantIds: ['Ana'], priceList: '2025-26' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ label: '2025-26' })))
  })

  it('reprice cannot start until the lists are loaded, and offers a retry when they fail', async () => {
    mockLists.mockReturnValue(lists(undefined, true))
    open('reprice', [row('Ana')])
    expect(screen.getByRole('button', { name: 'Make 1 draft' })).toBeDisabled()
    expect(screen.getByRole('option', { name: "Couldn't load price lists." })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mockLists.mock.results[0].value.refetch).toHaveBeenCalled()
  })

  it('extends: needs a date after the latest end, then sends it', async () => {
    const { onDone } = open('extend', [row('Ana', '2026-12-31'), row('Ben', '2027-03-31')])
    const make = screen.getByRole('button', { name: 'Make 2 drafts' })
    expect(make).toBeDisabled()
    const date = screen.getByLabelText(/New end date/)
    await userEvent.type(date, '2027-03-31')
    expect(screen.getByText(/^Choose a date after [A-Za-z]+ 31 Mar 2027[.]$/)).toBeInTheDocument()
    expect(make).toBeDisabled()
    await userEvent.clear(date)
    await userEvent.type(date, '2027-06-30')
    expect(make).toBeEnabled()
    await userEvent.click(make)
    expect(mockBulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'extend', participantIds: ['Ana', 'Ben'], endDate: '2027-06-30' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ label: '2027-06-30' })))
  })

  it('says which ticked rows will be skipped before anything is sent', () => {
    open('renew', [row('Ana'), row('Ben', '2026-12-31', { hasWaitingDraft: true })])
    expect(screen.getByText('1 has a draft waiting and will be skipped.')).toBeInTheDocument()
  })

  it('shows progress for a long run and cannot be closed while it runs', async () => {
    let finish!: (v: unknown) => void
    mockBulk.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { onClose } = open('renew', Array.from({ length: 30 }, (_, i) => row(`P${i}`)))
    await userEvent.click(screen.getByRole('button', { name: 'Make 30 drafts' }))
    expect(screen.getByText('Making drafts… 0 of 30 done')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Making 30 drafts…' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    finish({ results: [], stopped: null })
  })

  it.each([
    [429, /Another save is running/],
    [403, /You can't make agreement drafts/],
    [400, /Choose 100 or fewer/],
  ])('keeps the dialog open when the first request is refused with %i', async (status, words) => {
    mockBulk.mockResolvedValue({ results: [], stopped: { error: { response: { status } }, notSent: 1 } })
    const { onDone } = open('renew', [row('Ana')])
    await userEvent.click(screen.getByRole('button', { name: 'Make 1 draft' }))
    expect(await screen.findByText(words)).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('on no reply offers Show drafts waiting and turns Make off', async () => {
    mockBulk.mockResolvedValue({ results: [], stopped: { error: new Error('timeout'), notSent: 1 } })
    const { onDone } = open('renew', [row('Ana')])
    await userEvent.click(screen.getByRole('button', { name: 'Make 1 draft' }))
    expect(await screen.findByRole('button', { name: 'Show drafts waiting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make 1 draft' })).toBeDisabled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('a stop after some answers hands the earlier results over with the stop', async () => {
    mockBulk.mockResolvedValue({ results: [made], stopped: { error: { response: { status: 429 } }, notSent: 4 } })
    const { onDone } = open('renew', [row('A'), row('B'), row('C'), row('D'), row('E')])
    await userEvent.click(screen.getByRole('button', { name: 'Make 5 drafts' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ stopped: { done: 1, total: 5, notSent: 4, noReply: false } })))
  })
})
