import { useCallback, useRef, useState } from 'react'

export type NoticeTone = 'success' | 'danger'

/** One thing said about one person: "We've sent ann@example.com a link...", "No link was sent to bob@example.com...". */
export interface Notice {
  id: number
  tone: NoticeTone
  /** Who it is about (their name): a notice always says whom, because several can be waiting at once. */
  title: string
  message: string
  /**
   * A stable key for whoever it is about (a user's id), when the screen has one: it is how the screen finds that person's control again,
   * for example to give it focus once their notice is dismissed. The title is for people to read and is no key (two people can share a name).
   */
  subject?: string
}

/** The most SUCCESSES held at once. Errors are not counted: an error is never removed to make room. */
export const MAX_SUCCESSES = 3

/**
 * The list after a notice arrives, newest first.
 *
 * An error is something nobody has dealt with yet, so it leaves only when someone dismisses it, or when something NEWER about the same person
 * supersedes it: a success (the problem is over) or another error (the newest words say what is wrong now, so retries do not pile up identical
 * failures). Notices without a `subject` never replace anything, and are never replaced.
 *
 * Only successes are capped. Over the cap the OLDEST successes go; a new success is always let in, and no error is ever evicted to make room.
 */
export function withNotice(notices: readonly Notice[], incoming: Notice, max = MAX_SUCCESSES): Notice[] {
  const kept = incoming.subject === undefined
    ? notices
    : notices.filter(n => !(n.tone === 'danger' && n.subject === incoming.subject))
  const next = [incoming, ...kept]

  // Newest first, so the oldest successes are the last ones in the list.
  let successes = next.filter(n => n.tone === 'success').length
  for (let index = next.length - 1; index >= 0 && successes > max; index--) {
    if (next[index].tone === 'success') {
      next.splice(index, 1)
      successes--
    }
  }
  return next
}

/**
 * What to say about a person after something done to them (a set-password email sent, or not), kept until it is dismissed. Render the
 * list with `NoticesRegion`. `notify` and `dismiss` keep their identity, so they can be passed down without re-rendering the child.
 */
export function useNotices(max = MAX_SUCCESSES) {
  const [notices, setNotices] = useState<Notice[]>([])
  const nextId = useRef(0)

  const notify = useCallback(
    (tone: NoticeTone, title: string, message: string, subject?: string) => {
      // The id is taken here, not inside the updater: an updater must be pure, and React may run it twice.
      const id = nextId.current++
      setNotices(list => withNotice(list, { id, tone, title, message, subject }, max))
    },
    [max],
  )

  const dismiss = useCallback((id: number) => setNotices(list => list.filter(n => n.id !== id)), [])

  return { notices, notify, dismiss }
}
