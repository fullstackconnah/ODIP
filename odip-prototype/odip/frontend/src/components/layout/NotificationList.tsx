import { Link } from 'react-router-dom'
import { Button } from '@/components/Button'
import { useNow } from '@/hooks/useNow'
import { formatNoteTimestamp, formatRelative } from '@/lib/format'
import type { InAppNotificationDto, InboxDto } from '@/api/types'

export type NotificationListProps = {
  /** The inbox query: what the list draws its states from. */
  inbox: { data?: InboxDto; isError: boolean; refetch: () => unknown }
  /** An item was chosen (before a link navigates). The bell marks it read and decides whether to close. */
  onChoose: (item: InAppNotificationDto) => void
  /** "Mark all as read" was refused: show the alert line. */
  markAllFailed: boolean
}

const MUTED = 'text-[var(--color-muted-foreground)]'
/** At least 44px at any pointer (two lines plus 8px each side), the hover tint, and an inset focus ring. */
const ITEM =
  'flex w-full min-h-11 items-start gap-3 px-4 py-2 text-left hover:bg-[var(--color-surface-container-low)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]'

/** Only an app route is followed; anything else (never sent today) is treated as nowhere to go. */
const isAppRoute = (to?: string): to is string => !!to && to.startsWith('/') && !to.startsWith('//')

/**
 * The bell's list, its states and its items (dashboard SHAPE section 9), drawn the same inside the desktop panel and the phone
 * SlideOver. The frame owns the heading and "Mark all as read". A title is the server's plain text and is rendered as text only.
 */
export function NotificationList({ inbox, onChoose, markAllFailed }: NotificationListProps) {
  const now = useNow()

  if (!inbox.data) {
    if (inbox.isError) {
      return (
        <div className="space-y-2 px-4 py-3 text-sm">
          <p className="text-[var(--color-foreground)]">Couldn't load your notifications.</p>
          <Button variant="secondary" size="sm" onClick={() => void inbox.refetch()}>Try again</Button>
        </div>
      )
    }
    return <p role="status" className={`px-4 py-3 text-sm ${MUTED}`}>Loading notifications…</p>
  }

  const { items, hasMore } = inbox.data
  return (
    <>
      {markAllFailed && <p role="alert" className="px-4 pt-3 text-sm text-[var(--color-destructive)]">Couldn't mark them as read. Try again.</p>}
      {items.length === 0 ? (
        <div className="px-4 py-3 text-sm">
          <p className="font-medium text-[var(--color-foreground)]">No notifications yet</p>
          <p className={`mt-1 ${MUTED}`}>Updates about your shifts, leave and approvals show up here.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {items.map(item => {
            const unread = !item.readAt
            const body = (
              <>
                <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-[var(--color-primary)]' : ''}`} />
                <span className="min-w-0 flex-1">
                  {unread && <span className="sr-only">Unread: </span>}
                  <span title={item.title} className={`line-clamp-2 text-sm text-[var(--color-foreground)] ${unread ? 'font-semibold' : ''}`}>{item.title}</span>
                  {/* The space keeps the title and the time apart in the item's accessible name. */}{' '}
                  <time dateTime={item.createdAt} title={formatNoteTimestamp(item.createdAt)} className={`mt-0.5 block text-xs ${MUTED}`}>
                    {formatRelative(item.createdAt, { style: 'long', now })}
                  </time>
                </span>
              </>
            )
            return (
              <li key={item.id}>
                {isAppRoute(item.linkTo)
                  ? <Link to={item.linkTo} className={ITEM} onClick={() => onChoose(item)}>{body}</Link>
                  : <button type="button" className={ITEM} onClick={() => onChoose(item)}>{body}</button>}
              </li>
            )
          })}
        </ul>
      )}
      {hasMore && <p className={`px-4 py-3 text-xs ${MUTED}`}>Showing the latest 30.</p>}
    </>
  )
}
