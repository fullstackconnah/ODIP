import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import type { Notice } from '@/hooks/useNotices'

type NoticesRegionProps = {
  notices: readonly Notice[]
  onDismiss: (id: number) => void
  /**
   * Where focus goes when the LAST notice is dismissed: the control that raised it (the row's send button), which the screen can find from the
   * notice's `subject`. While another notice remains, focus goes to its Dismiss button instead and this is not asked. Return null for nowhere.
   */
  focusAfterDismiss?: (dismissed: Notice) => HTMLElement | null | undefined
  /** Spacing from the content around it. Give it an `empty:` variant that cancels it: while nothing is waiting the region is a zero-height box. */
  className?: string
}

/**
 * The notices for a row or detail action (see `useNotices`), as ONE persistent live region: it is mounted before the first message and is
 * empty while idle, and what is put into it is announced (polite). A live region that is created already holding its text is announced
 * unreliably, which is why the region is always there and only its content comes and goes. Each notice is a Callout that does not announce
 * itself (`announce={false}`), so nothing is announced twice. It stays on screen, at the place the person acted, until dismissed.
 *
 * `role="status"` implies `aria-atomic="true"`, which would make every notice that arrives re-read all the older ones, so the region sets
 * `aria-atomic="false"` and `aria-relevant="additions"`: only what is added is announced, and a Dismiss announces nothing.
 *
 * Dismiss removes the button that has focus, so focus is placed deliberately: on the next notice's Dismiss button (the one before it when the
 * dismissed notice was last), and when none is left on whatever `focusAfterDismiss` names. Otherwise it would fall to the top of the page.
 */
export function NoticesRegion({ notices, onDismiss, focusAfterDismiss, className }: NoticesRegionProps) {
  const region = useRef<HTMLDivElement>(null)
  // Set when a Dismiss is clicked, acted on once the notice is gone from the page (the effect below runs after that render).
  const refocus = useRef<{ dismissed: Notice; neighbourId: number | null } | null>(null)

  useEffect(() => {
    const pending = refocus.current
    if (!pending) return
    refocus.current = null
    const neighbour = pending.neighbourId !== null
      ? region.current?.querySelector<HTMLElement>(`[data-dismiss-notice="${pending.neighbourId}"]`)
      : null
    const target = neighbour ?? focusAfterDismiss?.(pending.dismissed)
    target?.focus()
  }, [notices, focusAfterDismiss])

  function dismiss(notice: Notice) {
    const index = notices.findIndex(n => n.id === notice.id)
    // The notice after this one in the list, or the one before it when this one is last.
    const neighbour = notices[index + 1] ?? notices[index - 1]
    refocus.current = { dismissed: notice, neighbourId: neighbour?.id ?? null }
    onDismiss(notice.id)
  }

  return (
    <div
      ref={region}
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
      className={clsx('flex flex-col gap-2', className)}
    >
      {notices.map(notice => (
        <div key={notice.id} data-tone={notice.tone}>
          <Callout
            tone={notice.tone === 'success' ? 'success' : 'warning'}
            title={notice.title}
            announce={false}
            actions={
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                data-dismiss-notice={notice.id}
                onClick={() => dismiss(notice)}
                aria-label={`Dismiss notice about ${notice.title}`}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </Button>
            }
          >
            <span className="break-words">{notice.message}</span>
          </Callout>
        </div>
      ))}
    </div>
  )
}
