import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AlphaSignupsTab from './AlphaSignupsTab'
import type { EarlyAccessLaterSubmissionDto, EarlyAccessSignupDto, PagedResult } from '@/api/types'

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
    laterSubmissions: [],
    overLimitCount: 0,
    ...overrides,
  }
}

function makeLater(overrides: Partial<EarlyAccessLaterSubmissionDto> = {}): EarlyAccessLaterSubmissionDto {
  return {
    id: 'l-1',
    receivedAtUtc: '2026-10-15T02:00:00Z',
    name: 'Amara Okafor',
    organisation: 'Riverbend Community Care',
    role: 'Operations manager',
    phone: '0491 570 156',
    organisationSize: '10-49',
    message: 'Please remove my details.',
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

    it('shows no later-submissions section when there are none', async () => {
      returns(page([makeRow({ requestCount: 3 })])) // sent again twice with the same answers
      render(<AlphaSignupsTab />)

      await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))

      expect(screen.queryByText('Later submissions')).not.toBeInTheDocument()
    })

    it('lists a later submission below the original answers, with its date and only the answers that differ', async () => {
      const later = makeLater({ phone: '0400 000 000', message: 'Please remove my details now.\nThanks.' })
      returns(page([makeRow({ requestCount: 2, laterSubmissions: [later] })]))
      render(<AlphaSignupsTab />)

      const toggle = screen.getByRole('button', { name: 'Amara Okafor, has a message' })
      await userEvent.click(toggle)

      const detail = document.getElementById(toggle.getAttribute('aria-controls')!)!
      const section = screen.getByRole('region', { name: 'Later submissions' })
      expect(within(section).getByText('Sent 15/10/2026')).toBeInTheDocument()
      expect(within(section).getByText('0400 000 000')).toBeInTheDocument()
      const message = [...section.querySelectorAll('p')].find(p => p.textContent === 'Please remove my details now.\nThanks.')
      expect(message).toHaveClass('whitespace-pre-wrap')
      // Role, size, name and organisation are what the original says, so they are not repeated.
      expect(within(section).queryByText('Role')).not.toBeInTheDocument()
      expect(within(section).queryByText('Size')).not.toBeInTheDocument()
      expect(within(section).queryByText('Name')).not.toBeInTheDocument()
      expect(within(section).queryByText('Organisation')).not.toBeInTheDocument()
      // The original answers stay as they were, above the section.
      expect(within(detail).getByText('0491 570 156')).toBeInTheDocument()
      expect(detail.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('shows several later submissions in the order the server sends them, newest last, and a blanked answer as a dash', async () => {
      returns(page([makeRow({
        requestCount: 3,
        laterSubmissions: [
          makeLater({ id: 'l-1', receivedAtUtc: '2026-10-10T02:00:00Z', message: 'First follow-up' }),
          makeLater({ id: 'l-2', receivedAtUtc: '2026-10-15T02:00:00Z', role: undefined, message: 'Second follow-up' }),
        ],
      })]))
      render(<AlphaSignupsTab />)

      await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))

      const section = screen.getByRole('region', { name: 'Later submissions' })
      const blocks = within(section).getAllByRole('listitem')
      expect(blocks).toHaveLength(2)
      expect(within(blocks[0]).getByText('Sent 10/10/2026')).toBeInTheDocument()
      expect(within(blocks[0]).getByText('First follow-up')).toBeInTheDocument()
      expect(within(blocks[1]).getByText('Sent 15/10/2026')).toBeInTheDocument()
      expect(within(blocks[1]).getByText('Role').nextElementSibling).toHaveTextContent('—')
    })

    it('says only the first 10 are kept when the sign-up was sent past that', async () => {
      const ten = Array.from({ length: 10 }, (_, i) => makeLater({ id: `l-${i}`, message: `Note ${i}` }))
      returns(page([makeRow({ requestCount: 14, laterSubmissions: ten })]))
      render(<AlphaSignupsTab />)

      await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))

      expect(screen.getAllByRole('listitem')).toHaveLength(10)
      expect(screen.getByText('Only the first 10 later submissions are kept. The form was sent 14 times in all.')).toBeInTheDocument()
    })

    it('puts the cap line directly under the Later submissions heading, before the entries', async () => {
      const ten = Array.from({ length: 10 }, (_, i) => makeLater({ id: `l-${i}`, message: `Note ${i}` }))
      returns(page([makeRow({ requestCount: 14, laterSubmissions: ten })]))
      render(<AlphaSignupsTab />)

      await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))

      const heading = screen.getByRole('heading', { name: 'Later submissions' })
      expect(heading.nextElementSibling).toHaveTextContent(/^Only the first 10 later submissions are kept/)
      expect(heading.nextElementSibling?.nextElementSibling?.tagName).toBe('OL')
    })

    it('says when the first answers were sent, above them, only once there are later submissions', async () => {
      returns(page([
        makeRow({ requestCount: 2, laterSubmissions: [makeLater({ message: 'Second note' })] }),
        makeRow({ id: 'b', name: 'Sam Field', requestCount: 1 }),
      ]))
      render(<AlphaSignupsTab />)

      await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))
      await userEvent.click(screen.getByRole('button', { name: 'Sam Field, has a message' }))

      expect(screen.getAllByText('First sent 02/10/2026')).toHaveLength(1)
      const first = screen.getByText('First sent 02/10/2026')
      const section = screen.getByRole('region', { name: 'Later submissions' })
      expect(first.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // Every date line heads its block: full foreground colour, medium weight.
      for (const line of [first, within(section).getByText('Sent 15/10/2026')]) {
        expect(line).toHaveClass('font-medium', 'text-[var(--color-foreground)]')
        expect(line).not.toHaveClass('text-[var(--color-muted-foreground)]')
      }
    })

    it('keeps Phone in the second column of a later entry, as in the original answers', async () => {
      returns(page([makeRow({ requestCount: 2, laterSubmissions: [makeLater({ phone: '0400 000 000' })] })]))
      render(<AlphaSignupsTab />)

      await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))

      const section = screen.getByRole('region', { name: 'Later submissions' })
      const phone = within(section).getByText('Phone').parentElement!
      expect(phone).toHaveClass('col-start-2')
      expect(phone.parentElement).toHaveClass('grid', 'grid-cols-2', 'md:grid-cols-[12rem_minmax(0,1fr)]')
    })

    it('marks a sign-up whose only message is in a later submission', () => {
      returns(page([makeRow({ message: undefined, requestCount: 2, laterSubmissions: [makeLater({ message: 'Please remove my details' })] })]))
      render(<AlphaSignupsTab />)

      expect(screen.getByRole('button', { name: 'Amara Okafor, has a message' })).toBeInTheDocument()
    })

    describe('after the limit', () => {
      const ten = Array.from({ length: 10 }, (_, i) => makeLater({ id: `l-${i}`, message: `Note ${i}` }))
      const over = makeLater({ id: 'l-over', receivedAtUtc: '2026-10-16T02:00:00Z', message: 'Please remove my details, ref zq-77' })

      it('dates the entry, says how many more were sent after the first 10 and that the latest is shown, with its message in full', async () => {
        returns(page([makeRow({ requestCount: 14, laterSubmissions: ten, overLimitCount: 3, lastOverLimit: over })]))
        render(<AlphaSignupsTab />)

        await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))

        expect(screen.getByText('Sent 16/10/2026')).toBeInTheDocument()
        expect(screen.getByText('3 more sent after the first 10 were kept. Showing the latest.')).toBeInTheDocument()
        expect(screen.getByText('Please remove my details, ref zq-77')).toBeInTheDocument()
        expect(screen.queryByText(/Only the first 10 later submissions are kept/)).not.toBeInTheDocument()
      })

      it('says "1 more ... Showing it" for a single one', async () => {
        returns(page([makeRow({ requestCount: 12, laterSubmissions: ten, overLimitCount: 1, lastOverLimit: over })]))
        render(<AlphaSignupsTab />)
        await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))
        expect(screen.getByText('1 more sent after the first 10 were kept. Showing it.')).toBeInTheDocument()
        expect(screen.getByText('Sent 16/10/2026')).toBeInTheDocument()
      })

      it('shows nothing about the limit when there is no entry after it', async () => {
        returns(page([makeRow({ requestCount: 2, laterSubmissions: [makeLater({ message: 'Second note' })] })]))
        render(<AlphaSignupsTab />)
        await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))
        expect(screen.queryByText(/more sent after/)).not.toBeInTheDocument()
      })

      it('marks a closed row whose only message was sent after the limit', () => {
        returns(page([makeRow({ message: undefined, requestCount: 12, laterSubmissions: ten.map(l => ({ ...l, message: undefined })), overLimitCount: 1, lastOverLimit: over })]))
        render(<AlphaSignupsTab />)

        expect(screen.getByRole('button', { name: 'Amara Okafor, has a message' })).toBeInTheDocument()
      })
    })

    it('does not show the cap line while fewer than 10 are stored, however often the form was sent', async () => {
      returns(page([makeRow({ requestCount: 14, laterSubmissions: [makeLater()] })]))
      render(<AlphaSignupsTab />)

      await userEvent.click(screen.getByRole('button', { name: 'Amara Okafor, has a message' }))

      expect(screen.queryByText(/Only the first 10/)).not.toBeInTheDocument()
    })
  })

  it('shows later submissions on a phone card, before Delete', () => {
    returns(page([makeRow({ requestCount: 2, laterSubmissions: [makeLater({ message: 'Second note' })] })]))
    render(<AlphaSignupsTab />)

    const section = screen.getByRole('region', { name: 'Later submissions' })
    expect(within(section).getByText('Second note')).toBeInTheDocument()
    const remove = screen.getByRole('button', { name: 'Delete sign-up from Amara Okafor' })
    expect(section.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows what was sent after the limit on a phone card', () => {
    const ten = Array.from({ length: 10 }, (_, i) => makeLater({ id: `l-${i}`, message: `Note ${i}` }))
    returns(page([makeRow({
      requestCount: 14, laterSubmissions: ten, overLimitCount: 3,
      lastOverLimit: makeLater({ id: 'l-over', receivedAtUtc: '2026-10-16T02:00:00Z', message: 'Remove me, ref zq-77' }),
    })]))
    render(<AlphaSignupsTab />)

    expect(screen.getByText('3 more sent after the first 10 were kept. Showing the latest.')).toBeInTheDocument()
    expect(screen.getByText('Remove me, ref zq-77')).toBeInTheDocument()
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
