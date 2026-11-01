import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAuthConfig, useMicrosoftAccount, useMyProfile, useUnlinkMicrosoftAccount, useUpdateMyProfile } from '@/api/hooks'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FactList } from '@/components/FactList'
import { FormField } from '@/components/FormField'
import { PageState } from '@/components/PageState'
import { formGrid, span } from '@/lib/formGrid'
import { retryingAfterError } from '@/lib/queryPhase'
import { canSendSetPasswordEmail, sendSetPasswordEmail } from '@/lib/setPasswordEmail'
import { apiErrorCode, apiErrorStatus } from '@/lib/shiftPackageErrors'
import { usePermissions } from '@/lib/permissions'
import { describeMicrosoftOutcome } from '@/lib/signInRefusal'
import { MicrosoftLinkAction } from './MicrosoftLinkAction'
import { TwoStepGroup } from './TwoStepGroup'
import { SettingsGroup, SettingsSection, type SaveResult, type SectionFrame } from './SettingsSection'
import { notSavedText } from './settingsSections'
import { getViewAs } from '@/lib/viewAs'

const NAME_MAX = 100
const MOBILE_MAX = 20
const MOBILE_SHAPE = /^[0-9 +()-]+$/

type Fields = { first: string; last: string; mobile: string }

/**
 * My account › Profile: your own name and mobile, and a password reset email. The sign-in name, role and organisation come from the sign-in
 * response (odip_user). The server finds the row from the sign-in alone, so a SuperAdmin viewing as someone has no form here: the browser carries
 * that person's name and role, and a save would change the SuperAdmin's own row.
 */
export default function ProfileSection(frame: SectionFrame) {
  const { fullName, username, role, tenantName, isSuperAdmin } = usePermissions()
  const viewingAs = getViewAs('odip_viewing_user') !== null
  if (viewingAs) {
    return (
      <SettingsSection {...frame}>
        <FactList items={[{ label: 'Name', value: fullName }, { label: 'Role', value: role === 'SuperAdmin' ? 'Super admin' : role }]} />
        <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">You're viewing as someone else. Stop viewing as them to change your own details.</p>
      </SettingsSection>
    )
  }
  return <ProfileForm frame={frame} username={username ?? ''} role={role ?? ''} tenantName={tenantName} isSuperAdmin={isSuperAdmin} />
}

function ProfileForm({ frame, username, role, tenantName, isSuperAdmin }: { frame: SectionFrame; username: string; role: string; tenantName: string | null; isSuperAdmin: boolean }) {
  const config = useAuthConfig()
  const query = useMyProfile()
  const { data: profile, refetch } = query
  const isError = query.isError || retryingAfterError(query)
  const update = useUpdateMyProfile()
  const [form, setForm] = useState<Fields | null>(null)
  const [saved, setSaved] = useState<Fields | null>(null)
  const [result, setResult] = useState<SaveResult>(null)
  if (profile && form === null) {
    const stored = { first: profile.firstName, last: profile.lastName, mobile: profile.mobile ?? '' }
    setForm(stored); setSaved(stored)
  }
  const startUrl = config.data?.microsoft ? config.data.microsoftStartUrl : null
  const locked = profile?.managedByEmploymentHero === true
  const first = form?.first.trim() ?? '', last = form?.last.trim() ?? '', mobile = form?.mobile.trim() ?? ''
  const errors = {
    first: first.length === 0 ? 'Enter your first name.' : first.length > NAME_MAX ? `Enter a first name of up to ${NAME_MAX} characters.` : undefined,
    last: last.length === 0 ? 'Enter your last name.' : last.length > NAME_MAX ? `Enter a last name of up to ${NAME_MAX} characters.` : undefined,
    mobile: mobile.length > 0 && (mobile.length > MOBILE_MAX || !MOBILE_SHAPE.test(mobile)) ? `Enter a mobile number of up to ${MOBILE_MAX} characters, using digits, spaces and + ( ) -.` : undefined,
  }
  const problems = Object.values(errors).filter(Boolean).length
  const dirty = form !== null && saved !== null && (form.first !== saved.first || form.last !== saved.last || form.mobile !== saved.mobile)

  const save = () => {
    if (!form || problems > 0) return
    setResult(null)
    update.mutate({ firstName: first, lastName: last, mobile: mobile === '' ? null : mobile }, {
      onSuccess: p => {
        const stored = { first: p.firstName, last: p.lastName, mobile: p.mobile ?? '' }
        setForm(stored); setSaved(stored); setResult('saved')
      },
      onError: e => {
        setResult({ error: notSavedText(e) })
        // Employment Hero took over the profile since this page loaded: show it locked.
        if (apiErrorCode(e) === 'EmploymentHeroOwnsProfile') refetch()
      },
    })
  }

  return (
    <SettingsSection {...frame} save={form === null || locked ? undefined : { dirty, pending: update.isPending, result, problems, onSave: save }}>
      {form === null ? (
        isError ? <PageState kind="error" noun="profile" onRetry={() => refetch()} /> : <PageState kind="loading" noun="profile" />
      ) : (
        <>
          <SettingsGroup title="Your details">
            {locked && (
              <Callout tone="info" icon={Lock} announce={false} className="max-w-prose">
                Employment Hero keeps your name and mobile up to date. Change them in Employment Hero and they'll update here after the next sync.
              </Callout>
            )}
            <div className={formGrid}>
              <FormField label="First name" required error={locked ? undefined : errors.first} className={span.medium}>
                <input autoComplete="given-name" value={form.first} onChange={e => setForm({ ...form, first: e.target.value })} readOnly={locked} />
              </FormField>
              <FormField label="Last name" required error={locked ? undefined : errors.last} className={span.medium}>
                <input autoComplete="family-name" value={form.last} onChange={e => setForm({ ...form, last: e.target.value })} readOnly={locked} />
              </FormField>
              <FormField label="Mobile" error={locked ? undefined : errors.mobile} className={span.medium}>
                <input type="tel" autoComplete="tel" inputMode="tel" value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} readOnly={locked} />
              </FormField>
            </div>
            <FactList
              items={[
                { label: 'Email', value: profile?.email ?? '' },
                { label: 'Signed in as', value: username },
                { label: 'Role', value: role === 'SuperAdmin' ? 'Super admin' : role },
                // A SuperAdmin's sign-in organisation is not the one they view (or they view none), so the row would mislead them.
                ...(tenantName && !isSuperAdmin ? [{ label: 'Organisation', value: tenantName }] : []),
              ]}
            />
          </SettingsGroup>
          {profile && <PasswordGroup email={profile.email} />}
          <TwoStepGroup required={config.data?.mfaRequiredForAdmins === true && (role === 'Admin' || role === 'SuperAdmin')} superAdmin={role === 'SuperAdmin'} />
        </>
      )}
      {startUrl && !isSuperAdmin && <MicrosoftAccountGroup startUrl={startUrl} />}
    </SettingsSection>
  )
}

/**
 * Send yourself a password reset email. Shown only where Firebase can send one, and not in a Microsoft session: canSendSetPasswordEmail() only says Firebase
 * is configured here, not that this person has a Firebase user, and a Microsoft-only account has none (Firebase would accept the request and send nothing).
 */
function PasswordGroup({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'too-many' | 'failed'>('idle')
  if (!canSendSetPasswordEmail() || localStorage.getItem('odip_sign_in_method') === 'microsoft') return null
  const send = async () => {
    setState('sending')
    try {
      await sendSetPasswordEmail(email)
      setState('sent')
    } catch (e) {
      setState((e as { code?: unknown } | null)?.code === 'auth/too-many-requests' ? 'too-many' : 'failed')
    }
  }
  const words =
    state === 'sent' ? `Check your email. We've sent a link to ${email}.`
    : state === 'too-many' ? 'Too many emails were sent. Wait a few minutes, then try again.'
    : state === 'failed' ? "We couldn't send the email. Try again."
    : ''
  return (
    <SettingsGroup title="Password">
      <AnnouncementRegion message={words} />
      <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">We'll email you a link to choose a new password. Your current password keeps working until you do.</p>
      <div>
        <Button variant="secondary" className="w-full sm:w-auto" onClick={send} disabled={state === 'sending'} aria-busy={state === 'sending' || undefined}>
          {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Send it again' : 'Send me a password reset email'}
        </Button>
      </div>
      {words && <Callout tone={state === 'sent' ? 'success' : 'danger'} announce={false}>{words}</Callout>}
    </SettingsGroup>
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
