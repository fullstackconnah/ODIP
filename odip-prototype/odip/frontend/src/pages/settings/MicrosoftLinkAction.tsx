import { useState } from 'react'
import { Button, type ButtonVariant } from '@/components/Button'
import { buttonClasses } from '@/components/buttonClasses'
import { Callout } from '@/components/Callout'
import { microsoftStartHref } from '@/lib/microsoftStart'
import type { MicrosoftRole } from '@/api/types'

type Props = {
  /** `microsoftStartUrl` from GET /auth/config. */
  startUrl: string
  intent: 'link-tenant' | 'link-account'
  defaultRole?: MicrosoftRole
  label: string
  variant: ButtonVariant
  /** The section's own GET, asked again just before leaving, so a session that has ended shows here and not after a round trip to Microsoft. */
  preflight: () => Promise<unknown>
  /** Where to continue on the public host when this page is on another one. */
  returnPath: string
}

/**
 * The "Link Microsoft" action of Settings > Microsoft sign-in and Profile > Microsoft account. The server's start redirect only works from its public host (the session
 * cookie never reaches it from any other), so on another host this says where to go instead of a button that would fail after a trip to Microsoft.
 */
export function MicrosoftLinkAction({ startUrl, intent, defaultRole, label, variant, preflight, returnPath }: Props) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const publicUrl = new URL(startUrl)

  if (publicUrl.origin !== window.location.origin) {
    return (
      <Callout
        tone="info"
        title={`Link Microsoft from ${publicUrl.host}`}
        announce={false}
        actions={
          <a href={`${publicUrl.origin}${returnPath}`} className={`${buttonClasses('secondary', 'md')} min-h-11`}>
            Open {publicUrl.host}
          </a>
        }
      >
        Microsoft can only send you back to {publicUrl.host}. Open Bunya Support there, sign in, and link from this page.
      </Callout>
    )
  }

  const go = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await preflight()
    } catch {
      setBusy(false)
      setFailed(true)
      return
    }
    window.location.assign(microsoftStartHref(startUrl, intent, defaultRole))
  }

  return (
    <div className="flex flex-col gap-2 sm:items-start">
      {failed && <Callout tone="danger">Couldn't reach Bunya Support. Check your connection and try again.</Callout>}
      <Button variant={variant} data-microsoft-link onClick={go} aria-busy={busy || undefined} className="w-full sm:w-auto">
        {busy ? 'Opening Microsoft…' : label}
      </Button>
    </div>
  )
}
