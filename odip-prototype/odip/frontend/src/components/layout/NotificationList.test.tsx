import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { InAppNotificationDto, InboxDto } from '@/api/types'
import { NotificationList, type NotificationListProps } from './NotificationList'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const unread = (id: string, title: string, linkTo?: string): InAppNotificationDto => ({ id, title, createdAt: minutesAgo(5), ...(linkTo ? { linkTo } : {}) })
const read = (id: string, title: string): InAppNotificationDto => ({ id, title, linkTo: '/portal', createdAt: minutesAgo(90), readAt: minutesAgo(80) })
const inbox = (items: InAppNotificationDto[], hasMore = false): InboxDto => ({ items, unreadCount: items.filter(i => !i.readAt).length, hasMore })
const loaded = (items: InAppNotificationDto[], hasMore = false) => ({ data: inbox(items, hasMore), isError: false, refetch: vi.fn() })

function renderList(props: Partial<NotificationListProps> = {}) {
  const all: NotificationListProps = { inbox: loaded([]), onChoose: vi.fn(), markAllFailed: false, ...props }
  render(<MemoryRouter><NotificationList {...all} /></MemoryRouter>)
  return all
}

describe('NotificationList', () => {
  it('says it is loading until the first answer', () => {
    renderList({ inbox: { data: undefined, isError: false, refetch: vi.fn() } })
    expect(screen.getByRole('status')).toHaveTextContent('Loading notifications…')
  })

  it('says it could not load, and Try again asks again', () => {
    const refetch = vi.fn()
    renderList({ inbox: { data: undefined, isError: true, refetch } })
    expect(screen.getByText("Couldn't load your notifications.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says there is nothing yet, and what will show up', () => {
    renderList()
    expect(screen.getByText('No notifications yet')).toBeInTheDocument()
    expect(screen.getByText('Updates about your shifts, leave and approvals show up here.')).toBeInTheDocument()
  })

  it('lists the items in the order given, unread ones named "Unread: " first, each with its time', () => {
    const first = unread('n1', 'Sam Lee asked for annual leave, 20 to 24 Oct.', '/rostering/leave')
    renderList({ inbox: loaded([first, read('n2', 'Your shift was returned.')]) })
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAccessibleName('Unread: Sam Lee asked for annual leave, 20 to 24 Oct. 5 min ago')
    expect(links[0]).toHaveAttribute('href', '/rostering/leave')
    expect(links[0]).toHaveClass('min-h-11')
    expect(links[1]).toHaveAccessibleName('Your shift was returned. 1 hr ago')
    expect(links[0].querySelector('time')).toHaveAttribute('datetime', first.createdAt)
  })

  it('is a button when there is nowhere to go, and either kind is passed back when chosen', () => {
    const onChoose = vi.fn()
    const noLink = unread('n3', 'You have a new notification.')
    renderList({ onChoose, inbox: loaded([noLink]) })
    fireEvent.click(screen.getByRole('button', { name: 'Unread: You have a new notification. 5 min ago' }))
    expect(onChoose).toHaveBeenCalledWith(noLink)
  })

  it('draws a title as text, never as HTML', () => {
    renderList({ inbox: loaded([unread('n4', "<img src=x onerror=alert(1)> O'Brien", '/portal')]) })
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByRole('link')).toHaveTextContent("<img src=x onerror=alert(1)> O'Brien")
  })

  /** Plan check N3: a link that is not an app route is drawn as a button, never followed. */
  it('treats a link that is not an app route as nowhere to go', () => {
    renderList({ inbox: loaded([unread('n5', 'Odd link', 'https://example.com')]) })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('button', { name: /^Unread: Odd link/ })).toBeInTheDocument()
  })

  /** Review Focus 4. */
  it('says "Showing the latest 30." only when the server says there are more', () => {
    renderList({ inbox: loaded([unread('a', 'A', '/portal')], true) })
    expect(screen.getByText('Showing the latest 30.')).toBeInTheDocument()
  })

  it('has no "Showing the latest 30." when the server says that is all', () => {
    renderList({ inbox: loaded([unread('a', 'A', '/portal')], false) })
    expect(screen.queryByText('Showing the latest 30.')).toBeNull()
  })

  it('shows the alert line when Mark all as read was refused', () => {
    renderList({ markAllFailed: true, inbox: loaded([unread('a', 'A', '/portal')]) })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't mark them as read. Try again.")
  })
})
