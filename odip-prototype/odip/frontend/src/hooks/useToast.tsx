import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'

export type ToastTone = 'success' | 'error'

/** What a child hands its host to say something transient: `notify('success', 'Saved.')`. */
export type Notify = (tone: ToastTone, message: string) => void

/**
 * A success clears itself after this long. An error stays until it is dismissed: it asks the person to do something,
 * and a timer would take it away mid-read.
 */
export const TOAST_SUCCESS_MS = 10_000

type Shown = { id: number; tone: ToastTone; message: string }

/**
 * One transient message, floating bottom-right (above the mobile nav below lg). A success is announced politely
 * (`role="status"`), an error assertively (`role="alert"`). The host renders `toast` once and passes `notify` to
 * whatever needs to speak; a newer message replaces the one showing.
 */
export function useToast(): { toast: ReactNode; notify: Notify; dismiss: () => void } {
  const [shown, setShown] = useState<Shown | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nextId = useRef(0)

  const dismiss = useCallback(() => {
    clearTimeout(timer.current)
    setShown(null)
  }, [])

  const notify = useCallback<Notify>((tone, message) => {
    clearTimeout(timer.current)
    setShown({ id: nextId.current++, tone, message })
    if (tone === 'success') timer.current = setTimeout(() => setShown(null), TOAST_SUCCESS_MS)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const toast: ReactNode = shown ? (
    // The card-coloured base keeps the Callout's tinted fill from letting the page show through while it floats.
    <div className="fixed right-4 bottom-[calc(var(--mobile-nav-h)+1rem)] lg:bottom-4 z-[70] w-[calc(100%-2rem)] max-w-sm rounded-lg bg-[var(--color-card)] shadow-lg">
      <Callout
        key={shown.id}
        tone={shown.tone}
        actions={
          <Button variant="ghost" size="sm" iconOnly onClick={dismiss} aria-label="Dismiss notification">
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        }
      >
        {shown.message}
      </Callout>
    </div>
  ) : null

  return { toast, notify, dismiss }
}
