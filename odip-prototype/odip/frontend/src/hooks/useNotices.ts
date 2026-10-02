import { useCallback, useRef, useState } from 'react'

export type NoticeTone = 'success' | 'error'

/** One thing said about one person: "We've sent ann@example.com a link...", "No link was sent to bob@example.com...". */
export interface Notice {
  id: number
  tone: NoticeTone
  /** Who it is about (their name): a notice always says whom, because several can be waiting at once. */
  title: string
  message: string
}

/** The most notices held at once. */
export const MAX_NOTICES = 3

/**
 * The list after a notice arrives, newest first. Over the cap, the OLDEST SUCCESS goes: a success never removes an error, because an error
 * is something nobody has dealt with yet (it leaves only when someone dismisses it). With nothing but errors held, a new error replaces the
 * oldest one, and a new success is simply not let in: three errors are still waiting, and a good result is the lesser loss. The incoming
 * notice can itself be the one that goes.
 */
export function withNotice(notices: readonly Notice[], incoming: Notice, max = MAX_NOTICES): Notice[] {
  const next = [incoming, ...notices]
  if (next.length <= max) return next

  // Newest first, so the oldest success is the last one in the list.
  let dropAt = next.length - 1
  for (let index = next.length - 1; index >= 0; index--) {
    if (next[index].tone === 'success') {
      dropAt = index
      break
    }
  }
  return next.filter((_, index) => index !== dropAt)
}

/**
 * What to say about a person after something done to them (a set-password email sent, or not), kept until it is dismissed. Render the
 * list with `NoticesRegion`. `notify` and `dismiss` keep their identity, so they can be passed down without re-rendering the child.
 */
export function useNotices(max = MAX_NOTICES) {
  const [notices, setNotices] = useState<Notice[]>([])
  const nextId = useRef(0)

  const notify = useCallback(
    (tone: NoticeTone, title: string, message: string) => {
      // The id is taken here, not inside the updater: an updater must be pure, and React may run it twice.
      const id = nextId.current++
      setNotices(list => withNotice(list, { id, tone, title, message }, max))
    },
    [max],
  )

  const dismiss = useCallback((id: number) => setNotices(list => list.filter(n => n.id !== id)), [])

  return { notices, notify, dismiss }
}
