import { useEffect, useId, useRef, useState, type FocusEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useMarkWhatsNewSeen, useWhatsNew } from '@/api/hooks'
import { SlideOver } from '@/components/SlideOver'
import { WhatsNewList } from '@/components/layout/WhatsNewEntryList'
import { WhatsNewPopup } from '@/components/layout/WhatsNewPopup'
import { useIsBelowLg } from '@/hooks/useIsBelowLg'
import { retryingAfterError } from '@/lib/queryPhase'

/** DESIGN's Floating Panel shadow, from the ink token: the source scan refuses a literal rgba(). */
const FLOATING_PANEL = 'shadow-[var(--shadow-float)]'

/**
 * The header's What's new button (SHAPE sections 2-3), a sibling of the bell in the same pattern: from lg a non-modal panel under the
 * button (closed by Escape, a click outside, focus leaving or a route change), below lg the house SlideOver. The dot shows while
 * something is unread and clears the moment the panel opens, which also tells the server the list was seen.
 */
export default function WhatsNewButton() {
  const [open, setOpen] = useState(false)
  // The unread count at the moment of opening, before the optimistic clear: that many newest entries wear "New" until it closes.
  const [newCount, setNewCount] = useState(0)
  const isBelowLg = useIsBelowLg()
  const feed = useWhatsNew()
  const markSeen = useMarkWhatsNewSeen()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const slideOverTitleRef = useRef<HTMLSpanElement>(null)
  const panelId = useId()
  const location = useLocation()

  const [seenPath, setSeenPath] = useState(location.pathname)
  if (seenPath !== location.pathname) {
    setSeenPath(location.pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open || isBelowLg) return
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current?.contains(e.target as Node)) return
      setOpen(false)
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) buttonRef.current?.focus()
      })
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, isBelowLg])

  // From lg the popover's heading takes focus on open (the SlideOver focuses its own title).
  useEffect(() => {
    if (open && !isBelowLg) headingRef.current?.focus()
  }, [open, isBelowLg])

  const unread = feed.data?.unreadCount ?? 0
  const name = unread > 0 ? `${unread} unread, What's new` : "What's new"

  // Opening, by the button or by the pop-up's "See all": the dot clears and the server learns the list was seen.
  const openPanel = () => {
    setNewCount(unread)
    if (unread > 0) markSeen.mutate()
    setOpen(true)
  }
  const toggle = () => (open ? setOpen(false) : openPanel())
  const onBlur = (e: FocusEvent) => {
    if (!isBelowLg && e.relatedTarget && !wrapperRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
  }

  const list = (
    <WhatsNewList
      entries={feed.data?.entries}
      failed={feed.isError || retryingAfterError(feed)}
      onRetry={() => feed.refetch()}
      newCount={newCount}
    />
  )

  return (
    <div ref={wrapperRef} className="relative" onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={name}
        title="What's new"
        aria-expanded={open}
        aria-controls={!isBelowLg && open ? panelId : undefined}
        aria-haspopup={isBelowLg ? 'dialog' : undefined}
        className="w-8 h-8 pointer-coarse:size-[var(--tap-min)] flex items-center justify-center rounded-full hover:bg-[var(--color-accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        <span className="relative inline-flex">
          <span className="material-symbols-outlined text-[var(--color-primary)]" aria-hidden="true" style={{ fontSize: '20px' }}>campaign</span>
          {/* Absolute, so it never moves the button or its neighbours; the ring separates it from the glyph in both themes. */}
          {unread > 0 && <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-[var(--color-primary)] ring-2 ring-[var(--color-background)]" />}
        </span>
      </button>

      <WhatsNewPopup panelOpen={open} onSeeAll={openPanel} returnFocusRef={buttonRef} />

      {open && !isBelowLg && (
        <div
          id={panelId}
          tabIndex={-1}
          className={`absolute right-0 top-full mt-1 z-50 flex w-96 max-h-[min(32rem,calc(100vh-64px))] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] focus:outline-none ${FLOATING_PANEL}`}
        >
          <div className="flex shrink-0 items-center border-b border-[var(--color-border)] px-4 py-3">
            <h2 ref={headingRef} tabIndex={-1} className="font-display text-base font-semibold text-foreground focus:outline-none">What's new</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
        </div>
      )}

      {/* A portal: the header's backdrop-blur makes it the containing block of any fixed child, which would clip the SlideOver to the 48px bar. */}
      {isBelowLg && createPortal(
        <SlideOver
          open={open}
          onClose={() => setOpen(false)}
          initialFocusRef={slideOverTitleRef}
          title={<span ref={slideOverTitleRef} tabIndex={-1} className="focus:outline-none">What's new</span>}
          bodyClassName="p-0"
        >
          {list}
        </SlideOver>,
        document.body,
      )}
    </div>
  )
}
