import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AlphaSignupsTab from './AlphaSignupsTab'
import type { EarlyAccessSignupDto, PagedResult } from '@/api/types'

const { mockUseEarlyAccessSignups, mockUseDeleteEarlyAccessSignup, mockMutateAsync, mockRefetch } = vi.hoisted(() => ({
  mockUseEarlyAccessSignups: vi.fn(),
  mockUseDeleteEarlyAccessSignup: vi.fn(),
  mockMutateAsync: vi.fn(),
  mockRefetch: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  EARLY_ACCESS_PAGE_SIZE: 50,
  useEarlyAccessSignups: mockUseEarlyAccessSignups,
  useDeleteEarlyAccessSignup: mockUseDeleteEarlyAccessSignup,
}))

function makeRow(overrides: Partial<EarlyAccessSignupDto> = {}): EarlyAccessSignupDto {
  return {
    id: 'eas-1',
    name: 'Amara Okafor',
    organisation: 'Riverbend Community Care',
    email: 'amara.okafor@example.org',
    role: 'Operations manager',
    phone: '0491 570 156',
    organisationSize: '10-49',
    message: 'Please remove my details.',
    createdAtUtc: '2026-10-02T01:15:00Z',
    lastRequestedAtUtc: '2026-10-15T22:40:00Z',
    requestCount: 1,
    ...overrides,
  }
}

function page(items: EarlyAccessSignupDto[], extra: Partial<PagedResult<EarlyAccessSignupDto>> = {}): PagedResult<EarlyAccessSignupDto> {
  return { items, totalCount: items.length, page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrevious: false, ...extra }
}

function returns(data: PagedResult<EarlyAccessSignupDto> | undefined, state: { isLoading?: boolean; isError?: boolean } = {}) {
  mockUseEarlyAccessSignups.mockReturnValue({ data, isLoading: false, isError: false, refetch: mockRefetch, ...state })
}

beforeEach(() => {
  mockUseEarlyAccessSignups.mockReset()
  mockMutateAsync.mockReset()
  mockRefetch.mockReset()
  mockUseDeleteEarlyAccessSignup.mockReset().mockReturnValue({ mutateAsync: mockMutateAsync, isPending: false })
})

describe('AlphaSignupsTab', () => {
  it('lists each sign-up with its size label, role, phone and email', () => {
    returns(page([makeRow()]))
    render(<AlphaSignupsTab />)

    expect(screen.getAllByText('Amara Okafor').length).toBeGreaterThan(0)
    expect(screen.getByText('10 to 49 staff')).toBeInTheDocument()
    expect(screen.getByText('Operations manager')).toBeInTheDocument()
    expect(screen.getByText('0491 570 156')).toBeInTheDocument()
    expect(screen.getByText('amara.okafor@example.org')).toBeInTheDocument()
  })

  it('shows the whole message with its line breaks, never cut to a tooltip', () => {
    const message = 'First line of the request.\n' + 'x'.repeat(560) + '\nLast line.'
    returns(page([makeRow({ message })]))
    const { container } = render(<AlphaSignupsTab />)

    const shown = [...container.querySelectorAll('p')].find(p => p.textContent === message)
    expect(shown).toBeDefined()
    expect(shown).toHaveClass('whitespace-pre-wrap')
    expect(container.querySelector(`[title="${CSS.escape(message)}"]`)).toBeNull()
    expect([...container.querySelectorAll('[title]')].some(el => el.getAttribute('title') === message)).toBe(false)
  })

  it('shows Not given for a sign-up with no size, and a dash for other answers left out', () => {
    returns(page([makeRow({ organisationSize: undefined, role: undefined, phone: undefined, message: undefined })]))
    render(<AlphaSignupsTab />)

    expect(screen.getByText('Not given')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(3)
  })

  it('says how many times someone sent the form when it is more than once', () => {
    returns(page([makeRow({ id: 'a', name: 'Amara Okafor', requestCount: 3 }), makeRow({ id: 'b', name: 'Tom Nguyen', requestCount: 1 })]))
    render(<AlphaSignupsTab />)

    expect(screen.getByText('Sent 3 times')).toBeInTheDocument()
    expect(screen.queryAllByText(/^Sent \d+ times$/)).toHaveLength(1)
  })

  it('shows the empty sentence when no one has signed up', () => {
    returns(page([]))
    render(<AlphaSignupsTab />)

    expect(screen.getByText('No one has signed up for the alpha yet.')).toBeInTheDocument()
  })

  it('shows the house error row with Try again, which refetches', async () => {
    returns(undefined, { isError: true })
    render(<AlphaSignupsTab />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('asks before deleting, names the person, and does nothing on Cancel', async () => {
    returns(page([makeRow()]))
    render(<AlphaSignupsTab />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete sign-up from Amara Okafor' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this sign-up?' })
    expect(within(dialog).getByText('Amara Okafor, Riverbend Community Care (amara.okafor@example.org).')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })

  it('deletes on confirm and says so', async () => {
    mockMutateAsync.mockResolvedValue(undefined)
    returns(page([makeRow()]))
    render(<AlphaSignupsTab />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete sign-up from Amara Okafor' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete sign-up' }))

    expect(mockMutateAsync).toHaveBeenCalledWith('eas-1')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const notice = screen.getByText('Sign-up deleted.')
    expect(within(screen.getByRole('status')).getByText('Amara Okafor')).toBeInTheDocument()
    const wrapper = notice.closest('[tabindex="-1"]')
    expect(wrapper).not.toBeNull()
    await waitFor(() => expect(wrapper!.contains(document.activeElement)).toBe(true))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('treats a 404 as already deleted', async () => {
    mockMutateAsync.mockRejectedValue({ response: { status: 404 } })
    returns(page([makeRow()]))
    render(<AlphaSignupsTab />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete sign-up from Amara Okafor' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete sign-up' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByText('Sign-up deleted.')).toBeInTheDocument()
  })

  it('keeps the dialog open and says why when the delete fails', async () => {
    mockMutateAsync.mockRejectedValue({ response: { status: 500, data: { message: 'Database unavailable' } } })
    returns(page([makeRow()]))
    render(<AlphaSignupsTab />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete sign-up from Amara Okafor' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete sign-up' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't delete this sign-up. Database unavailable")
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByText('Sign-up deleted.')).not.toBeInTheDocument()
  })

  it('asks the hook for the next page from the pager', async () => {
    returns(page([makeRow()], { totalCount: 120, totalPages: 3, hasNext: true }))
    render(<AlphaSignupsTab />)

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(mockUseEarlyAccessSignups).toHaveBeenLastCalledWith(2)
  })

  describe('from md up', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      }))
    })
    afterEach(() => vi.unstubAllGlobals())

    it('marks a sign-up that has a message in its name, and leaves one without unmarked', () => {
      returns(page([makeRow(), makeRow({ id: 'b', name: 'Sam Field', message: undefined })]))
      render(<AlphaSignupsTab />)

      expect(screen.getByRole('button', { name: 'Amara Okafor, has a message' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sam Field' })).toBeInTheDocument()
      expect(screen.queryByText('Please remove my details.')).not.toBeInTheDocument()
    })

    it('keeps Delete in the row from md up, not in the opened detail', async () => {
      returns(page([makeRow()]))
      const { container } = render(<AlphaSignupsTab />)

      await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))

      const buttons = screen.getAllByRole('button', { name: 'Delete sign-up from Amara Okafor' })
      expect(buttons).toHaveLength(1)
      expect(container.querySelector('tr[data-row-detail]')!.contains(buttons[0])).toBe(false)
    })

    it('has six columns, so the table never scrolls sideways', () => {
      returns(page([makeRow()]))
      render(<AlphaSignupsTab />)

      expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Name', 'Organisation', 'Email', 'Size', 'Last sent', ''])
    })

    it('opens role, phone and the whole message under the row from its name, and closes them again', async () => {
      const message = 'Please remove my details.\nThanks.'
      returns(page([makeRow({ message })]))
      const { container } = render(<AlphaSignupsTab />)

      const toggle = screen.getByRole('button', { name: 'Amara Okafor, has a message' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('Operations manager')).not.toBeInTheDocument()

      await userEvent.click(toggle)

      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      const detail = document.getElementById(toggle.getAttribute('aria-controls')!)!
      expect(within(detail).getByText('Operations manager')).toBeInTheDocument()
      expect(within(detail).getByText('0491 570 156')).toBeInTheDocument()
      const shown = [...detail.querySelectorAll('p')].find(p => p.textContent === message)
      expect(shown).toHaveClass('whitespace-pre-wrap')
      expect(container.querySelectorAll('tr[data-row-detail]')).toHaveLength(1)

      await userEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(container.querySelectorAll('tr[data-row-detail]')).toHaveLength(0)
    })
  })

  it('puts Delete at the foot of each phone card, after the message, and only once', () => {
    returns(page([makeRow()]))
    const { container } = render(<AlphaSignupsTab />)

    const buttons = screen.getAllByRole('button', { name: 'Delete sign-up from Amara Okafor' })
    expect(buttons).toHaveLength(1)
    const detail = container.querySelector('tr[data-row-detail]')!
    expect(detail.contains(buttons[0])).toBe(true)
    const message = [...detail.querySelectorAll('p')].find(p => p.textContent === 'Please remove my details.')!
    expect(message.compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('goes back a page when the last row of the last page is deleted', async () => {
    returns(page([makeRow()], { totalCount: 51, page: 1, totalPages: 2, hasNext: true }))
    const { rerender } = render(<AlphaSignupsTab />)
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(mockUseEarlyAccessSignups).toHaveBeenLastCalledWith(2)

    returns(page([], { totalCount: 50, page: 2, totalPages: 1, hasPrevious: true }))
    rerender(<AlphaSignupsTab />)

    await waitFor(() => expect(mockUseEarlyAccessSignups).toHaveBeenLastCalledWith(1))
  })
})
