import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthConfig, useMicrosoftAccount, useUnlinkMicrosoftAccount } from '@/api/hooks'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FactList } from '@/components/FactList'
import { apiErrorCode, apiErrorStatus } from '@/lib/shiftPackageErrors'
import { usePermissions } from '@/lib/permissions'
import { describeMicrosoftOutcome } from '@/lib/signInRefusal'
import { MicrosoftLinkAction } from './MicrosoftLinkAction'
import { SettingsGroup } from './SettingsSection'
import { getViewAs } from '@/lib/viewAs'

/**
 * My account › Profile, PR 1: who you're signed in as, from the sign-in response (odip_user), with no endpoint. The username is the
 * sign-in name, not necessarily the email (users have both), so the row says "Signed in as". Editing name and phone comes with PR 4.
 */
export default function ProfileSection() {
  const { fullName, username, role, tenantName, isSuperAdmin } = usePermissions()
  const config = useAuthConfig()
  // A SuperAdmin viewing as someone: UserSwitcher swaps in only that person's id, name and role, so the sign-in name and organisation
  // in odip_user are still the SuperAdmin's own. Show only what is true of the person being viewed.
  const viewingAs = getViewAs('odip_viewing_user') !== null
  const startUrl = config.data?.microsoft ? config.data.microsoftStartUrl : null
  return (
    <>
      <FactList
        items={[
          { label: 'Name', value: fullName },
          ...(viewingAs ? [] : [{ label: 'Signed in as', value: username }]),
          { label: 'Role', value: role === 'SuperAdmin' ? 'Super admin' : role },
          // A SuperAdmin's sign-in organisation is not the one they view (or they view none), so the row would mislead them.
          ...(tenantName && !viewingAs && !isSuperAdmin ? [{ label: 'Organisation', value: tenantName }] : []),
        ]}
      />
      {startUrl && !isSuperAdmin && !viewingAs && <MicrosoftAccountGroup startUrl={startUrl} />}
    </>
  )
}

/** Link or unlink the signed-in person's own Microsoft account. Shown once the organisation has turned Microsoft sign-in on. */
function MicrosoftAccountGroup({ startUrl }: { startUrl: string }) {
  const account = useMicrosoftAccount()
  const unlink = useUnlinkMicrosoftAccount()
  const [params, setParams] = useSearchParams()
  const [outcome] = useState(() => params.get('microsoft'))
  const [announced, setAnnounced] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [focusLink, setFocusLink] = useState(0)
  const root = useRef<HTMLDivElement>(null)

  // Back from Microsoft: say how it went, put focus on the page and drop the code from the address.
  useEffect(() => {
    if (outcome === null) return
    root.current?.closest('section')?.querySelector('h2')?.focus()
    // Written a tick after mount: AnnouncementRegion must already be on the page for a screen reader to announce its text.
    const tick = setTimeout(() => setAnnounced(outcome === 'linked' ? 'Your Microsoft account is linked.' : describeMicrosoftOutcome(outcome, 'account').sentence), 0)
    setParams(p => { p.delete('microsoft'); return p }, { replace: true })
    return () => clearTimeout(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (focusLink) root.current?.querySelector<HTMLElement>('[data-microsoft-link]')?.focus()
  }, [focusLink])

  const words = outcome && outcome !== 'linked' ? describeMicrosoftOutcome(outcome, 'account') : null
  const linked = account.data?.accountLinked === true
  const microsoftSession = localStorage.getItem('odip_sign_in_method') === 'microsoft'
  const onlySignIn = unlink.isError && apiErrorStatus(unlink.error) === 409 && apiErrorCode(unlink.error) === 'MicrosoftOnlySignIn'
  const onlySignInWords = describeMicrosoftOutcome('MicrosoftOnlySignIn', 'account')

  const confirmUnlink = () =>
    unlink.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false)
        setAnnounced('Microsoft account unlinked.')
        setFocusLink(n => n + 1)
      },
    })

  return (
    <div ref={root}>
      <AnnouncementRegion message={announced} />
      {(account.data?.orgLinked || outcome !== null) && (
        <SettingsGroup title="Microsoft account">
          {outcome === 'linked' && (
            <Callout tone="success" announce={false}>Your Microsoft account is linked. Next time you can use Sign in with Microsoft.</Callout>
          )}
          {words && (
            <Callout tone={words.tone} announce={false}>
              {words.sentence}
              {words.nextStep ? ` ${words.nextStep}` : ''}
            </Callout>
          )}
          {account.data?.orgLinked &&
            (linked ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">Linked. You can use Sign in with Microsoft.</p>
                <Button variant="secondary" className="w-full sm:ml-auto sm:w-auto" onClick={() => setConfirming(true)}>Unlink</Button>
              </div>
            ) : (
              <>
                <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">Link your Microsoft work account to sign in with Microsoft. Your password keeps working.</p>
                <MicrosoftLinkAction
                  startUrl={startUrl}
                  intent="link-account"
                  label="Link Microsoft account"
                  variant="secondary"
                  preflight={() => account.refetch({ throwOnError: true })}
                  returnPath="/settings?section=profile"
                />
              </>
            ))}
        </SettingsGroup>
      )}
      <ConfirmDialog
        open={confirming}
        variant="danger"
        title="Unlink your Microsoft account?"
        confirmLabel="Unlink"
        loading={unlink.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={confirmUnlink}
        message={
          <div className="flex flex-col gap-2">
            <p>You won't be able to sign in with Microsoft until you link it again.</p>
            {microsoftSession && <p>You signed in with Microsoft, so you'll be signed out within 30 minutes. Then sign in with your password.</p>}
            {onlySignIn && (
              <Callout tone={onlySignInWords.tone}>
                <p>{onlySignInWords.sentence}</p>
                <p>{onlySignInWords.nextStep}</p>
              </Callout>
            )}
            {unlink.isError && !onlySignIn && <Callout tone="danger">Your Microsoft account couldn't be unlinked. Try again.</Callout>}
          </div>
        }
      />
    </div>
  )
}
