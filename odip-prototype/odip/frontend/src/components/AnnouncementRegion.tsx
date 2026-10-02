type AnnouncementRegionProps = {
  /** The sentence to announce; empty while there is nothing to say. */
  message: string
}

/**
 * A visually hidden polite live region for the one sentence a screen reader must hear when a view is swapped under it (a create form
 * becoming its "done" view). It has to be mounted BEFORE the sentence is written: a live region that is created already holding its text is
 * announced unreliably, and the same goes for a Callout that appears pre-filled. So render it in the view that is there first, as the first
 * thing in the content, and keep it at the same place in the tree when the view changes: React then keeps the same element and only its text
 * changes, which is what gets announced. `aria-atomic` makes a changed sentence (a retry) be read whole.
 *
 * Sighted users read the same sentence in the visible content, which should not announce itself as well (`Callout announce={false}`).
 */
export function AnnouncementRegion({ message }: AnnouncementRegionProps) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  )
}
