import { useEffect, useState } from 'react'
import { multiFactor, type User } from 'firebase/auth'
import { endSession } from '@/api/client'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FactList } from '@/components/FactList'
import { StatusBadge } from '@/components/StatusBadge'
import { TwoStepSetup } from '@/components/auth/TwoStepSetup'
import { auth } from '@/lib/firebase'
import { formatDateAu } from '@/lib/utils'
import { SettingsGroup } from './SettingsSection'

const MUTED = 'max-w-prose text-sm text-[var(--color-muted-foreground)]'

/**
 * My account › Two-step verification: add or remove an authenticator app on your own Firebase sign-in. Not shown for a Microsoft sign-in (Microsoft does its own) or
 * without a Firebase user (dev sign-in). `required`: the server asks it of this role, so it can't be removed. A SuperAdmin has no one to reset it, so the line differs.
 */
export function TwoStepGroup({ required, superAdmin = false }: { required: boolean; superAdmin?: boolean }) {
  // undefined: Firebase hasn't said yet (a reload), null: nobody is signed in to Firebase.
  const [user, setUser] = useState<User | null | undefined>(() => auth?.currentUser ?? undefined)
  const [, rerender] = useState(0)
  const [setting, setSetting] = useState(false)
  const [justOn, setJustOn] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState<'idle' | 'busy' | 'failed' | 'recent'>('idle')
  useEffect(() => (auth ? auth.onAuthStateChanged(setUser) : undefined), [])

  if (!auth || localStorage.getItem('odip_sign_in_method') === 'microsoft' || user === null) return null
  if (user === undefined) {
    return <SettingsGroup title="Two-step verification"><p className={MUTED}>Checking…</p></SettingsGroup>
  }

  const factor = multiFactor(user).enrolledFactors[0]
  const on = factor !== undefined
  const closeSetup = () => setSetting(false)
  const remove = async () => {
    setRemoving('busy')
    try {
      await multiFactor(user).unenroll(factor.uid)
      await endSession()
    } catch (err) {
      setRemoving((err as { code?: string } | null)?.code === 'auth/requires-recent-login' ? 'recent' : 'failed')
    }
  }
  const badge = on
    ? <StatusBadge tone="success" label="On" size="md" />
    : required ? <StatusBadge tone="warning" label="Required" size="md" /> : <StatusBadge tone="neutral" label="Off" size="md" />

  return (
    <SettingsGroup title="Two-step verification" badge={badge}>
      <AnnouncementRegion message={justOn ? 'Two-step verification is on.' : ''} />
      {justOn && on && (
        <Callout tone="success" announce={false}>Two-step verification is on. You'll enter a code from your app each time you sign in with your password.</Callout>
      )}
      {setting ? (
        <TwoStepSetup
          user={user}
          host="settings"
          onEnrolled={() => { closeSetup(); setJustOn(true); rerender(n => n + 1) }}
          onCancel={closeSetup}
          onSignInAgain={() => void endSession()}
        />
      ) : on ? (
        <>
          <FactList items={[{ label: 'Authenticator app', value: `Added ${formatDateAu(factor.enrollmentTime)}` }]} />
          {required ? (
            <p className={MUTED}>{superAdmin ? 'Required for your role.' : 'Required for your role. To change authenticator app, ask your administrator to reset it.'}</p>
          ) : (
            <div>
              <Button variant="secondary" className="w-full sm:w-auto" onClick={() => { setRemoving('idle'); setConfirming(true) }}>Remove two-step verification</Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className={MUTED}>{required ? 'Your role needs two-step verification.' : 'Add a code from an authenticator app when you sign in with your password.'}</p>
          <div>
            <Button variant="secondary" className="w-full sm:w-auto" onClick={() => { setJustOn(false); setSetting(true) }}>
              {required ? 'Set up now' : 'Set up two-step verification'}
            </Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirming}
        variant={removing === 'recent' ? 'default' : 'danger'}
        stacked
        title="Remove two-step verification?"
        confirmLabel={removing === 'recent' ? 'Sign in again' : 'Remove and sign out'}
        loading={removing === 'busy'}
        onCancel={() => setConfirming(false)}
        onConfirm={removing === 'recent' ? () => void endSession() : remove}
        message={
          <div className="flex flex-col gap-2">
            <p>You'll be signed out. Next time, you'll sign in with just your password.</p>
            {removing === 'failed' && <Callout tone="danger">We couldn't remove it. Try again.</Callout>}
            {removing === 'recent' && <Callout tone="danger">For your security, sign in again to finish removing it.</Callout>}
          </div>
        }
      />
    </SettingsGroup>
  )
}
