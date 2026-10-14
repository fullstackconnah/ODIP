import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgreementEndingDto } from '@/api/types'
import { AgreementsEndingList } from './AgreementsEndingList'

const { ending } = vi.hoisted(() => ({ ending: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useAgreementsEnding: () => ending() }))

const rows: AgreementEndingDto[] = [
  { participantId: 'p-2', participantName: 'Ben Ng', draftId: 'd-9', version: 1, agreementEndDate: '2026-10-07', daysLeft: -3, renewalVersion: 2, status: 'Agreement ended 2026-10-07: shifts stop after it. Renewal v2 is waiting for approval' },
  { participantId: 'p-1', participantName: 'Amy Ng', draftId: 'd-1', version: 3, agreementEndDate: '2026-10-30', daysLeft: 20, renewalVersion: null, status: 'Agreement ends in 20 days' },
]

function renderList(search = '') {
  const router = createMemoryRouter([
    { path: '/participants', element: <AgreementsEndingList search={search} /> },
    { path: '/participants/:id/agreement-draft', element: <p>agreement page</p> },
  ], { initialEntries: ['/participants'] })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => { ending.mockReturnValue({ data: rows, isLoading: false, isError: false, refetch: vi.fn() }) })

describe('AgreementsEndingList', () => {
  it('lists the agreements in the server\'s order, soonest end first, in the alert\'s words, and a row opens the agreement', async () => {
    const user = userEvent.setup()
    renderList()

    const [ben, amy] = screen.getAllByRole('row').slice(1)
    for (const text of ['Ben Ng', 'Ended', 'Wed 7 Oct 2026', 'Agreement ended Wed 7 Oct 2026: shifts stop after it. Renewal v2 is waiting for approval']) expect(within(ben).getByText(text)).toBeInTheDocument()
    for (const text of ['Amy Ng', 'Ending', 'Fri 30 Oct 2026', 'Agreement ends in 20 days']) expect(within(amy).getByText(text)).toBeInTheDocument()

    await user.click(within(amy).getByText('Amy Ng'))
    expect(screen.getByText('agreement page')).toBeInTheDocument()
  })

  it('narrows to the names that match the search, and says when none do', () => {
    const { unmount } = renderList('amy')
    expect(screen.getAllByRole('row').slice(1).map(row => within(row).queryByText('Amy Ng') !== null)).toEqual([true])
    unmount()

    renderList('zed')
    expect(screen.getByText('No agreements ending match your search')).toBeInTheDocument()
  })

  it('says when no agreement is ending, and offers a retry when the list could not be read', async () => {
    ending.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
    const { unmount } = renderList()
    expect(screen.getByText('No agreements ending')).toBeInTheDocument()
    unmount()

    const refetch = vi.fn()
    ending.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    renderList()
    await userEvent.setup().click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })
})
