import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, Share } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import {
  consumeDeferred, currentUserId, getInstallSnapshot, installPromptMode, isIosSafari, markInstalled, readInstallRecord,
  INSTALL_SNOOZE_MS, snoozeInstallPrompt, subscribeInstall,
} from '@/lib/installPrompt'

const EXIT_MS = 150

const matches = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches

/**
 * "Add Bunya Support to your phone", on the two landing routes only (/ and /portal), below md on a touch device in a secure
 * context. A fixed card 8px above the bottom nav, so it can never shift content; an aria-hidden spacer closes the main column
 * while the card shows, so the footer's last link can still scroll clear of it.
 */
export default function InstallPrompt() {
  const { pathname } = useLocation()
  const belowMd = useIsBelowMd()
  const { deferred, installed: installedEvent } = useSyncExternalStore(subscribeInstall, getInstallSnapshot)
  const userId = currentUserId()
  const [record, setRecord] = useState(() => (userId ? readInstallRecord(userId) : { dismissedUntil: 0, installed: false }))
  const [leaving, setLeaving] = useState(false)
  const [cardH, setCardH] = useState(0)
  const cardRef = useRef<HTMLElement>(null)

  const mode = installPromptMode({
    belowMd,
    coarse: matches('(pointer: coarse)'),
    secure: window.isSecureContext,
    standalone: matches('(display-mode: standalone)') || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    installed: installedEvent || record.installed,
    dismissedUntil: record.dismissedUntil,
    now: Date.now(),
    hasDeferred: deferred !== null,
    iosSafari: isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
    path: pathname,
  })

  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => {
      setLeaving(false)
      setRecord(userId ? readInstallRecord(userId) : { dismissedUntil: Date.now() + INSTALL_SNOOZE_MS, installed: false })
      consumeDeferred() // the event is single use
      document.getElementById('main')?.focus()
    }, EXIT_MS)
    return () => clearTimeout(t)
  }, [leaving, userId])

  const shown = mode !== null
  useEffect(() => {
    const el = cardRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [shown])

  if (!mode) return null

  const notNow = () => {
    if (userId) snoozeInstallPrompt(userId, Date.now())
    setLeaving(true)
  }
  const install = async () => {
    if (!deferred) return
    setLeaving(true)
    void deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (!userId) return
    if (outcome === 'accepted') markInstalled(userId)
    else snoozeInstallPrompt(userId, Date.now())
  }

  return (
    <>
      <div data-install-spacer aria-hidden="true" style={{ height: cardH + 8 }} className="lg:hidden" />
      <section
        ref={cardRef}
        aria-labelledby="install-prompt-title"
        data-leaving={leaving ? '' : undefined}
        className="install-card fixed inset-x-[var(--gutter)] bottom-[calc(var(--mobile-nav-h)+0.5rem)] z-40 lg:hidden"
      >
        <Callout
          tone="info"
          icon={null}
          announce={false}
          className="shadow-[var(--shadow-float)]"
        >
          <div className="flex gap-3">
            <img src="/favicon.svg" alt="" width={40} height={40} className="size-10 shrink-0 rounded-[10px]" />
            <div className="min-w-0 space-y-1">
              <p id="install-prompt-title" className="font-medium leading-snug">
                {mode === 'android' ? 'Install Bunya Support' : 'Add Bunya Support to your Home Screen'}
              </p>
              {mode === 'android' ? (
                <p>Open it from your home screen like any other app, full screen with no browser bars.</p>
              ) : (
                <ol className="space-y-1">
                  <li className="flex gap-2">
                    <span aria-hidden="true">1.</span>
                    <span>Tap Share <Share className="inline size-4 align-text-bottom" aria-hidden="true" /> (under ••• if it isn't on the toolbar).</span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden="true">2.</span>
                    <span>Choose Add to Home Screen.</span>
                  </li>
                </ol>
              )}
              <div className="flex gap-2 pt-1">
                {mode === 'android' && (
                  <Button variant="primary" size="md" onClick={() => void install()}>
                    <Download className="size-4" aria-hidden="true" />
                    Install
                  </Button>
                )}
                <Button variant="ghost" size="md" onClick={notNow}>Not now</Button>
              </div>
            </div>
          </div>
        </Callout>
      </section>
    </>
  )
}
