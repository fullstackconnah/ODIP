import { useEffect, useId, useRef, useState, type FocusEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useInbox, useMarkAllInboxRead, useMarkInboxRead } from '@/api/hooks'
import type { InAppNotificationDto } from '@/api/types'
import { Button } from '@/components/Button'
import { SlideOver } from '@/components/SlideOver'
import { TAP_AREA } from '@/components/tapArea'
import { NavCountBadge } from '@/components/layout/NavCountBadge'
import { NotificationList } from '@/components/layout/NotificationList'
import { useIsBelowLg } from '@/hooks/useIsBelowLg'

/** DESIGN's Floating Panel shadow (0 24px 40px -12px at 14% ink), from the ink token: the source scan refuses a literal rgba(). */
const FLOATING_PANEL = 'shadow-[0_24px_40px_-12px_color-mix(in_srgb,var(--color-foreground)_14%,transparent)]'

/**
 * The header bell (dashboard SHAPE section 9), for every signed-in role. The button's name carries the unread count, and a
 * NavCountBadge shows it. It opens the caller's own inbox:
 * - from lg, a panel under the bell in the header switchers' pattern: a non-modal disclosure with no scrim, closed by Escape,
 *   a click outside, focus leaving, choosing a link, or a route change;
 * - below lg, the house SlideOver.
 * Choosing an item marks it read. "Mark all as read" marks everything and moves focus to the heading.
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const isBelowLg = useIsBelowLg()
  const inbox = useInbox()
  const markRead = useMarkInboxRead()
  const markAll = useMarkAllInboxRead()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const slideOverTitleRef = useRef<HTMLSpanElement>(null)
  const panelId = useId()
  const location = useLocation()

  // A route change closes it: the render-time pattern AppLayout uses for the drawer.
  const [seenPath, setSeenPath] = useState(location.pathname)
  if (seenPath !== location.pathname) {
    setSeenPath(location.pathname)
    setOpen(false)
  }

  // From lg the panel is a header popover, like the switchers: a click outside or Escape anywhere closes it (below lg the
  // SlideOver's hook handles both). Escape listens on document, as UserSwitcher does, so it works when a click left focus elsewhere.
  useEffect(() => {
    if (!open || isBelowLg) return
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current?.contains(e.target as Node)) return
      setOpen(false)
      // Focus follows a click on a real control. A click on nothing focusable leaves it on the page body, so it comes back to the bell.
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) bellRef.current?.focus()
      })
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        bellRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, isBelowLg])

  const unread = inbox.data?.unreadCount ?? 0
  const name = unread > 0 ? `${unread} unread, Notifications` : 'Notifications'

  const toggle = () => {
    if (!open) {
      markAll.reset()
      void inbox.refetch()
    }
    setOpen(!open)
  }
  const choose = (item: InAppNotificationDto, navigates: boolean) => {
    if (!item.readAt) markRead.mutate(item.id)
    if (navigates) setOpen(false)
  }
  const markAllRead = () => {
    markAll.mutate((inbox.data?.items ?? []).filter(n => !n.readAt).map(n => n.id))
    // The button is about to disappear: keep focus in the panel, on its heading, rather than dropping it to the page.
    ;(headingRef.current ?? slideOverTitleRef.current)?.focus()
  }
  // Focus leaving for another control (Tab, or a click on one) closes the panel and stays where the user put it. A blur with
  // no related target is the window losing focus (alt-tab), which leaves the panel open.
  const onBlur = (e: FocusEvent) => {
    if (!isBelowLg && e.relatedTarget && !wrapperRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
  }

  const list = <NotificationList inbox={inbox} onChoose={choose} markAllFailed={markAll.isError} />

  return (
    <div ref={wrapperRef} className="relative" onBlur={onBlur}>
      <button
        ref={bellRef}
        type="button"
        onClick={toggle}
        aria-label={name}
        aria-expanded={open}
        aria-controls={!isBelowLg && open ? panelId : undefined}
        aria-haspopup={isBelowLg ? 'dialog' : undefined}
        className={`${TAP_AREA} w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--color-accent)] transition-colors`}
      >
        {/* The badge sits on the icon exactly as the bottom bar places it. */}
        <span className="relative inline-flex">
          <span className="material-symbols-outlined text-[var(--color-primary)]" aria-hidden="true" style={{ fontSize: '20px' }}>notifications</span>
          {unread > 0 && (
            <span className="absolute -top-2 left-full -ml-2">
              <NavCountBadge count={unread} />
            </span>
          )}
        </span>
      </button>

      {open && !isBelowLg && (
        // tabIndex -1: a click on the panel's plain text keeps focus inside it, so the blur rule above doesn't close it.
        <div
          id={panelId}
          tabIndex={-1}
          className={`absolute right-0 top-full mt-1 z-50 flex w-96 max-h-[min(32rem,calc(100vh-64px))] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] focus:outline-none ${FLOATING_PANEL}`}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
            <h2 ref={headingRef} tabIndex={-1} className="font-display text-base font-semibold text-foreground focus:outline-none">Notifications</h2>
            {unread > 0 && <Button variant="ghost" size="sm" onClick={markAllRead}>Mark all as read</Button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
        </div>
      )}

      {/* A portal: the header's backdrop-blur makes it the containing block of any fixed child, which would clip the SlideOver to the 48px bar. */}
      {isBelowLg && createPortal(
        <SlideOver
          open={open}
          onClose={() => setOpen(false)}
          title={<span ref={slideOverTitleRef} tabIndex={-1} className="focus:outline-none">Notifications</span>}
          footer={unread > 0 ? <Button variant="secondary" onClick={markAllRead}>Mark all as read</Button> : undefined}
          bodyClassName="p-0"
        >
          {list}
        </SlideOver>,
        document.body,
      )}
    </div>
  )
}
