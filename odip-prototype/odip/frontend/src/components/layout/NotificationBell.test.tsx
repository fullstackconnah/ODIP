import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { InAppNotificationDto, InboxDto } from '@/api/types'
import { TAP_AREA } from '@/components/tapArea'
import NotificationBell from './NotificationBell'

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPost: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet: mockApiGet, apiPost: mockApiPost }))

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const leave: InAppNotificationDto = { id: 'n1', title: 'Sam Lee asked for annual leave, 20 to 24 Oct.', linkTo: '/rostering/leave', createdAt: minutesAgo(5) }
const noLink: InAppNotificationDto = { id: 'n2', title: 'You have a new notification.', createdAt: minutesAgo(30) }
const done: InAppNotificationDto = { id: 'n3', title: 'Your shift was returned. See why.', linkTo: '/portal', createdAt: minutesAgo(120), readAt: minutesAgo(100) }
const inbox = (items: InAppNotificationDto[]): InboxDto => ({ items, unreadCount: items.filter(i => !i.readAt).length, hasMore: false })

let server: InAppNotificationDto[]

beforeEach(() => {
  server = [leave, noLink, done]
  mockApiGet.mockReset()
  mockApiPost.mockReset()
  mockApiGet.mockImplementation(async () => inbox(server))
  mockApiPost.mockImplementation(async (url: string, body?: { ids: string[] }) => {
    const readAt = new Date().toISOString()
    server = server.map(n => (!n.readAt && ((url.endsWith('/read-all') && body?.ids.includes(n.id)) || url === `/notifications/inbox/${n.id}/read`) ? { ...n, readAt } : n))
  })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

/** From lg: matchMedia for `(min-width: 64rem)`. Without it (jsdom has none), useIsBelowLg assumes a phone. */
function desktop() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/trips']}>
        <Routes>
          <Route path="*" element={<><NotificationBell /><button type="button">Elsewhere</button><p>Plain text</p><Link to="/staff">Go to staff</Link><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const bell = () => screen.getByRole('button', { name: /Notifications$/ })
const heading = () => screen.queryByRole('heading', { level: 2, name: 'Notifications' })
/** The first answer is in: two of the three items are unread. */
const ready = () => screen.findByRole('button', { name: '2 unread, Notifications' })

describe('NotificationBell: the button', () => {
  it('is "Notifications" until the inbox answers, then carries the count; padded to 44px on touch and never disabled', async () => {
    let answer!: (value: InboxDto) => void
    mockApiGet.mockReturnValueOnce(new Promise<InboxDto>(resolve => { answer = resolve }))
    renderBell()

    expect(bell()).toHaveAccessibleName('Notifications')
    expect(bell()).toBeEnabled()
    expect(bell()).toHaveClass(...TAP_AREA.split(' '), 'w-8', 'h-8')
    expect(bell()).toHaveTextContent(/^notifications$/) // the icon only: no badge yet

    await act(async () => answer(inbox(server)))
    await ready()
    expect(within(bell()).getByText('2')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows no badge and the plain name when the inbox cannot be read', async () => {
    mockApiGet.mockRejectedValue(new Error('down'))
    renderBell()
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled())
    expect(bell()).toHaveAccessibleName('Notifications')
    expect(bell()).toHaveTextContent(/^notifications$/)
  })
})

describe('NotificationBell: the panel, from lg', () => {
  beforeEach(desktop)

  it('opens under the bell: expanded, controlling it, headed "Notifications", the server order, and asks again', async () => {
    renderBell()
    await ready()
    const callsBefore = mockApiGet.mock.calls.length

    fireEvent.click(bell())

    expect(bell()).toHaveAttribute('aria-expanded', 'true')
    const panel = document.getElementById(bell().getAttribute('aria-controls')!)!
    expect(within(panel).getByRole('heading', { level: 2, name: 'Notifications' })).toBeInTheDocument()
    const items = within(panel).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent(leave.title)
    expect(items[1]).toHaveTextContent(noLink.title)
    expect(items[2]).toHaveTextContent(done.title)
    expect(within(panel).getByRole('button', { name: 'Mark all as read' })).toHaveClass(...TAP_AREA.split(' ')) // 44px on a touch screen at lg (fix round 1)
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(mockApiGet.mock.calls.length).toBe(callsBefore + 1))
  })

  it('choosing an unread link marks it read, goes to its page and closes; the badge drops', async () => {
    renderBell()
    await ready()
    fireEvent.click(bell())

    fireEvent.click(screen.getByRole('link', { name: /^Unread: Sam Lee asked for annual leave/ }))

    // The POST leaves after onMutate has cancelled any poll in the air, so it is a tick later than the click.
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/notifications/inbox/n1/read'))
    expect(screen.getByTestId('where')).toHaveTextContent('/rostering/leave')
    expect(heading()).toBeNull()
    await waitFor(() => expect(bell()).toHaveAccessibleName('1 unread, Notifications'))
  })

  it('an item with nowhere to go is marked read and the panel stays; a read item sends nothing', async () => {
    renderBell()
    await ready()
    fireEvent.click(bell())

    fireEvent.click(screen.getByRole('button', { name: /^Unread: You have a new notification/ }))
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/notifications/inbox/n2/read'))
    expect(heading()).not.toBeNull()

    mockApiPost.mockClear()
    fireEvent.click(screen.getByRole('link', { name: /^Your shift was returned/ }))
    await act(async () => {}) // give a POST, if one were sent, its tick
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('Mark all as read clears every dot and the badge, goes away, and leaves focus on the heading', async () => {
    renderBell()
    await ready()
    fireEvent.click(bell())

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))

    expect(heading()).toHaveFocus()
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/notifications/inbox/read-all', { ids: ['n1', 'n2'] }))
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notifications'))
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull()
    expect(screen.queryByText('Unread:', { exact: false })).toBeNull()
  })

  it('Mark all as read refused: the dots come back, with the alert line', async () => {
    renderBell()
    await ready()
    mockApiPost.mockRejectedValueOnce(new Error('nope'))
    fireEvent.click(bell())

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't mark them as read. Try again.")
    await waitFor(() => expect(bell()).toHaveAccessibleName('2 unread, Notifications'))
    expect(screen.getAllByText('Unread:', { exact: false })).toHaveLength(2)
  })

  it('closes on Escape (focus back on the bell), a click outside, focus leaving, and a route change', async () => {
    renderBell()
    await ready()

    fireEvent.click(bell())
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mark all as read' }), { key: 'Escape' })
    expect(heading()).toBeNull()
    expect(bell()).toHaveFocus()

    // Plan check S1: Escape closes it wherever focus is (a mouse click on Safari or Firefox for Mac doesn't focus the bell).
    fireEvent.click(bell())
    fireEvent.keyDown(document.body, { key: 'Escape' }) // outside the bell's wrapper
    expect(heading()).toBeNull()
    expect(bell()).toHaveFocus()

    fireEvent.click(bell())
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(heading()).toBeNull()

    fireEvent.click(bell())
    fireEvent.focusOut(bell(), { relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }) }) // React's onBlur listens to focusout
    expect(heading()).toBeNull()

    fireEvent.click(bell())
    fireEvent.click(screen.getByRole('link', { name: 'Go to staff' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/staff')
    expect(heading()).toBeNull()
  })
})

describe('NotificationBell: where focus goes when the panel closes (fix round 1)', () => {
  beforeEach(desktop)

  it('stays open when the window loses focus (alt-tab: a blur with no related target)', async () => {
    renderBell()
    await ready()
    fireEvent.click(bell())
    fireEvent.focusOut(bell(), { relatedTarget: null })
    expect(heading()).not.toBeNull()
  })

  it('a click on nothing focusable outside closes it and puts focus back on the bell', async () => {
    renderBell()
    await ready()
    fireEvent.click(bell())
    screen.getByRole('link', { name: /^Unread: Sam Lee asked for annual leave/ }).focus()

    fireEvent.mouseDown(screen.getByText('Plain text'))

    expect(heading()).toBeNull()
    await waitFor(() => expect(bell()).toHaveFocus())
  })

  it('a click or Tab to a real target outside closes it and leaves focus on that target', async () => {
    renderBell()
    await ready()
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    fireEvent.click(bell())
    fireEvent.mouseDown(elsewhere)
    act(() => elsewhere.focus()) // the browser moves focus to what was clicked
    expect(heading()).toBeNull()
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(elsewhere).toHaveFocus()

    bell().focus()
    fireEvent.click(bell())
    act(() => elsewhere.focus()) // Tab out of the panel: focus leaves for the next control
    expect(heading()).toBeNull()
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(elsewhere).toHaveFocus()
  })

  it('a chosen item that navigates leaves focus to the new page, not the bell', async () => {
    renderBell()
    await ready()
    fireEvent.click(bell())
    const link = screen.getByRole('link', { name: /^Unread: Sam Lee asked for annual leave/ })
    link.focus()
    fireEvent.click(link)
    expect(screen.getByTestId('where')).toHaveTextContent('/rostering/leave')
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(bell()).not.toHaveFocus()
  })

  it('a chosen item that does not navigate keeps the panel open with focus on it, and focus goes to the bell when it then closes', async () => {
    renderBell()
    await ready()
    fireEvent.click(bell())
    const item = screen.getByRole('button', { name: /^Unread: You have a new notification/ })
    item.focus()
    fireEvent.click(item)
    expect(heading()).not.toBeNull()
    expect(item).toHaveFocus()

    fireEvent.keyDown(item, { key: 'Escape' })
    expect(bell()).toHaveFocus()
  })
})

describe('NotificationBell: below lg', () => {
  it('a chosen link closes the SlideOver and the house dialog gives focus back to the bell (fix round 1, item 2c)', async () => {
    renderBell()
    await ready()
    bell().focus()
    fireEvent.click(bell())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /^Unread: Sam Lee asked for annual leave/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/rostering/leave')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bell()).toHaveFocus()
  })

  it('opens the SlideOver "Notifications" outside the header, Mark all as read in its footer; Escape closes it and focus returns to the bell', async () => {
    renderBell()
    await ready()
    expect(bell()).toHaveAttribute('aria-haspopup', 'dialog')
    bell().focus()

    fireEvent.click(bell())

    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    expect(dialog.parentElement).toBe(document.body) // portalled: the header's backdrop-blur would clip a fixed panel
    expect(within(dialog).getByRole('button', { name: 'Mark all as read' })).toBeInTheDocument()
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bell()).toHaveFocus()
  })

  it('Mark all as read in the SlideOver leaves focus on its heading', async () => {
    renderBell()
    await ready()
    fireEvent.click(bell())

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark all as read' }))

    expect(screen.getByRole('heading', { level: 2, name: 'Notifications' })).toContainElement(document.activeElement as HTMLElement)
  })
})
