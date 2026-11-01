import { useEffect, useRef, useState } from 'react'
import { multiFactor, TotpMultiFactorGenerator, type TotpSecret, type User } from 'firebase/auth'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { codeDigits, twoStepProblem, type TwoStepProblem } from '@/lib/twoStep'
import { CodeField } from './CodeField'
import { QrCode } from './QrCode'

const ISSUER = 'Bunya Support'

type Setup = { secret: TotpSecret; url: string } | null

/**
 * Adds an authenticator app to a signed-in Firebase user: a QR code, the same key as text (for apps that can't scan; never a Copy button, as live is plain HTTP and
 * has no clipboard API), and the first code to prove it works. Two hosts use it: My account (`settings`) and the sign-in step that follows a refusal (`login`). The
 * host decides what happens next (`onEnrolled`), and what Cancel and Sign in again mean.
 */
export function TwoStepSetup({ user, host, onEnrolled, onCancel, onSignInAgain }: {
  user: User
  host: 'login' | 'settings'
  /** Runs after the factor is added. It handles its own failures (the login host's exchange does), so it should not throw. */
  onEnrolled: () => Promise<void> | void
  onCancel: () => void
  onSignInAgain: () => void
}) {
  const [setup, setSetup] = useState<Setup>(null)
  const [fetch, setFetch] = useState(0)
  const [code, setCode] = useState('')
  const [problem, setProblem] = useState<TwoStepProblem | null>(null)
  const [busy, setBusy] = useState(false)
  const [announced, setAnnounced] = useState('')
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let current = true
    void (async () => {
      try {
        const secret = await TotpMultiFactorGenerator.generateSecret(await multiFactor(user).getSession())
        if (current) setSetup({ secret, url: secret.generateQrCodeUrl(user.email ?? '', ISSUER) })
      } catch (err) {
        if (current) setProblem(twoStepProblem(err, 'setup'))
      }
    })()
    return () => { current = false }
  }, [user, fetch])

  const getNewCode = () => {
    setSetup(null)
    setProblem(null)
    setCode('')
    setFetch(n => n + 1)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!setup || busy || code.length !== 6) return
    if (Date.parse(setup.secret.enrollmentCompletionDeadline) < Date.now()) {
      setProblem(twoStepProblem({ code: 'auth/code-expired' }, 'setup'))
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(setup.secret, code), 'Authenticator app')
    } catch (err) {
      setProblem(twoStepProblem(err, 'setup'))
      setBusy(false)
      if ((err as { code?: string })?.code === 'auth/invalid-verification-code') requestAnimationFrame(() => codeRef.current?.select())
      return
    }
    setAnnounced('Two-step verification is on.')
    await onEnrolled()
    setBusy(false)
  }

  const kind = problem?.kind
  const loading = setup === null && problem === null
  const key = setup?.secret.secretKey.match(/.{1,4}/g)?.join(' ') ?? ''
  const hold = loading || busy || kind === 'too-many' || kind === 'unavailable' || kind === 'expired' || kind === 'recent-login'
  const stack = 'w-full sm:w-auto'

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <AnnouncementRegion message={announced} />
      {setup === null ? (
        loading && (
          <div className="flex flex-col gap-3">
            <div aria-hidden="true" className="h-44 w-44 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-border)] md:h-48 md:w-48" />
            <p className="text-sm text-[var(--color-muted-foreground)]">Getting your setup code…</p>
          </div>
        )
      ) : (
        <>
          <p className="max-w-prose text-sm">Open an authenticator app, such as Google Authenticator or Microsoft Authenticator, and scan this code.</p>
          <QrCode text={setup.url} label="QR code for setting up two-step verification. The key below holds the same thing." />
          <a href={setup.url} className="inline-flex min-h-[var(--tap-min)] items-center text-sm text-[var(--color-primary)] hover:underline sm:hidden">Open in your authenticator app</a>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-[var(--color-muted-foreground)]">Can't scan it? Enter this key instead:</p>
            <code className="select-all break-words font-mono text-sm tracking-wider">{key}</code>
          </div>
          <p className="max-w-prose text-sm">Enter the 6-digit code the app shows.</p>
          <CodeField id={host === 'login' ? 'login-setup-code' : 'settings-setup-code'} ref={codeRef} value={code} onChange={t => setCode(codeDigits(t))} invalid={kind === 'wrong'} describedBy={problem ? 'two-step-setup-problem' : undefined} />
        </>
      )}
      {problem && <div id="two-step-setup-problem"><Callout tone="danger">{problem.sentence}</Callout></div>}
      <div className="flex flex-col gap-2 sm:flex-row">
        {kind === 'expired' ? (
          <Button type="button" className={stack} onClick={getNewCode}>Get a new code</Button>
        ) : kind === 'recent-login' ? (
          <Button type="button" className={stack} onClick={onSignInAgain}>Sign in again</Button>
        ) : (
          <Button type="submit" className={stack} disabled={hold || code.length !== 6} aria-busy={busy || undefined}>
            {busy ? 'Turning on…' : host === 'login' ? 'Turn on and sign in' : 'Turn on'}
          </Button>
        )}
        <Button type="button" variant="secondary" className={stack} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
