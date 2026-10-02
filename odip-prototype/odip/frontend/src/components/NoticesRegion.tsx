import clsx from 'clsx'
import { X } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import type { Notice } from '@/hooks/useNotices'

type NoticesRegionProps = {
  notices: readonly Notice[]
  onDismiss: (id: number) => void
  /** Spacing from the content around it. Give it an `empty:` variant that cancels it: while nothing is waiting the region is a zero-height box. */
  className?: string
}

/**
 * The notices for a row or detail action (see `useNotices`), as ONE persistent live region: it is mounted before the first message and is
 * empty while idle, and what is put into it is announced (polite). A live region that is created already holding its text is announced
 * unreliably, which is why the region is always there and only its content comes and goes. Each notice is a Callout that does not announce
 * itself (`announce={false}`), so nothing is announced twice. It stays on screen, at the place the person acted, until dismissed.
 */
export function NoticesRegion({ notices, onDismiss, className }: NoticesRegionProps) {
  return (
    <div role="status" aria-live="polite" className={clsx('flex flex-col gap-2', className)}>
      {notices.map(notice => (
        <div key={notice.id} data-tone={notice.tone}>
          <Callout
            tone={notice.tone === 'success' ? 'success' : 'warning'}
            title={notice.title}
            announce={false}
            actions={
              <Button variant="ghost" size="sm" iconOnly onClick={() => onDismiss(notice.id)} aria-label={`Dismiss notice about ${notice.title}`}>
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
