import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import { useMarkWhatsNewPopupSeen, useWhatsNew } from '@/api/hooks'
import type { WhatsNewEntry } from '@/api/types'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { WhatsNewEntryItem } from '@/components/layout/WhatsNewEntryList'
import { openDialogLayerCount, subscribeDialogLayers } from '@/hooks/useDialogBehavior'

/** The most important entries one pop-up shows; the rest are one tap away in the panel. */
const MAX_SHOWN = 3

export type WhatsNewPopupProps = {
  /** The panel is open (either form): a person reading the full list needs no pop-up. */
  panelOpen: boolean
  /** "See all": the owner opens its panel. */
  onSeeAll: () => void
  /** An auto-opened modal has no opener, so closing returns focus here (the What's new button). */
  returnFocusRef: RefObject<HTMLElement | null>
}

/**
 * The one-time pop-up for important entries (SHAPE section 4). It decides once per mount, from the first answer of the feed, so an entry
 * published later never interrupts a session; it waits for any other dialog to close first, and once shown it stays until dismissed
 * (a refetch that empties `popup` while it is open does not close it). Only the button renders it, and the button lives only in AppLayout.
 */
export function WhatsNewPopup({ panelOpen, onSeeAll, returnFocusRef }: WhatsNewPopupProps) {
  const feed = useWhatsNew()
  const { mutate: markPopupSeen } = useMarkWhatsNewPopupSeen()
  const layerCount = useSyncExternalStore(subscribeDialogLayers, openDialogLayerCount)
  const [decided, setDecided] = useState(false)
  const [items, setItems] = useState<WhatsNewEntry[]>([])
  const [shown, setShown] = useState(false)
  const [closed, setClosed] = useState(false)
  const [cancelled, setCancelled] = useState(false)

  if (!decided && feed.data) {
    setDecided(true)
    setItems(feed.data.popup)
  }
  const waiting = items.length > 0 && !shown && !cancelled
  if (waiting && panelOpen) setCancelled(true)
  else if (waiting && layerCount === 0) setShown(true)

  // The reader opened the panel before the pop-up appeared: they are reading the full list already, so it counts as seen.
  useEffect(() => {
    if (cancelled) markPopupSeen()
  }, [cancelled, markPopupSeen])

  const open = shown && !closed
  const dismiss = (focusButton: boolean) => {
    if (closed) return
    setClosed(true)
    markPopupSeen()
    if (focusButton) setTimeout(() => returnFocusRef.current?.focus())
  }

  const more = items.length > MAX_SHOWN
  return (
    <Modal
      open={open}
      onClose={() => dismiss(true)}
      title="What's new"
      size="md"
      stickyFooter
      footer={(
        <>
          {more && <Button variant="secondary" onClick={() => { dismiss(false); onSeeAll() }}>See all</Button>}
          <Button onClick={() => dismiss(true)}>Got it</Button>
        </>
      )}
    >
      <div className="-mx-4">
        {items.slice(0, MAX_SHOWN).map(entry => <WhatsNewEntryItem key={entry.id} entry={entry} />)}
      </div>
      {more && <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">Showing {MAX_SHOWN} of {items.length} important updates.</p>}
    </Modal>
  )
}
