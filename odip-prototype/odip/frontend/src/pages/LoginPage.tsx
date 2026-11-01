import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { multiFactor, sendPasswordResetEmail, signOut, TotpMultiFactorGenerator, type MultiFactorResolver, type User } from 'firebase/auth'
import { auth, devAuthEnabled } from '@/lib/firebase'
import {
  useLogin, useResendVerification, useDevLogin, useDevUsers, useAuthConfig, storeSession,
  useVerifySecondFactor, useExchangeAfterEnrolment,
} from '@/api/hooks'
import type { AuthResponseDto, ApiResponse } from '@/api/types'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Callout, type CalloutTone } from '@/components/Callout'
import { Button } from '@/components/Button'
import { inputClass } from '@/components/FormField'
import { CodeField } from '@/components/auth/CodeField'
import { TwoStepSetup } from '@/components/auth/TwoStepSetup'
import PlatformFooter from '@/components/layout/PlatformFooter'
import { SignInRefused, describeMicrosoftOutcome, describeSignInRefusal, type RefusalWords } from '@/lib/signInRefusal'
import { codeDigits, twoStepProblem, SecondFactorRequired, EnrolmentRequired, SignInAgainNeeded, type TwoStepProblemKind } from '@/lib/twoStep'
import { VERIFICATION_HOLD_MS, holdLeftMs, readVerificationSend, writeVerificationSend, type VerificationSendRecord } from '@/lib/verificationSend'
import { Eye, EyeOff } from 'lucide-react'
import { Wordmark } from '@/components/Wordmark'

/** What the person is told: one plain sentence, and what to do next when the sentence does not already say. */
type Problem = RefusalWords & { tone?: CalloutTone }

/** The card's step: the password; the code from the authenticator app after it ("Verify it's you"); or adding that app, after the exchange asked for it. */
type Step = 'password' | 'verify' | 'enrol'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  // Also what the set-up step signs in with again if the exchange still refuses after the factor was added. It only ever lives in this state, so it goes with the page;
  // it is emptied as soon as it is no longer needed (a session, Back, Cancel).
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<Step>('password')
  const [second, setSecond] = useState<{ resolver: MultiFactorResolver; hintUid: string | null } | null>(null)
  const [enrolUser, setEnrolUser] = useState<User | null>(null)
  const [code, setCode] = useState('')
  const [codeProblem, setCodeProblem] = useState<TwoStepProblemKind | null>(null)
  const [justSetUp, setJustSetUp] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [params] = useSearchParams()
  // A refused or ended Microsoft sign-in returns here as ?microsoft=<code>. Read once, shown as the card's problem, and dropped from the address.
  const [microsoftCode] = useState(() => params.get('microsoft'))
  const [problem, setProblem] = useState<Problem | null>(() => (microsoftCode ? describeMicrosoftOutcome(microsoftCode, 'signin') : null))
  const [announced, setAnnounced] = useState('')
  const [resetSent, setResetSent] = useState(false)
  // Set when the exchange refused an unverified email: what was typed (so "Send it again" uses it), and how the resend is going. The refused sign-in ended
  // its Firebase session, so sending again signs in once more with these.
  const [unverified, setUnverified] = useState<{ email: string; password: string } | null>(null)
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [resendHeld, setResendHeld] = useState(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The last verification send ATTEMPT (to whom, when, and whether it went). Firebase rate-limits these, so one goes at most once per hold across attempts, not just
  // per attempt. A ref, because every new attempt starts with clearResend() and this must outlive it; sessionStorage behind it, because a reload must too.
  const lastSend = useRef<VerificationSendRecord | null>(null)
  const [devUsernameOverride, setDevUsernameOverride] = useState<string | null>(null)
  const navigate = useNavigate()
  const login = useLogin()
  const resendVerification = useResendVerification()
  const verify = useVerifySecondFactor()
  const afterEnrolment = useExchangeAfterEnrolment()
  const devLogin = useDevLogin()
  const devUsers = useDevUsers()
  const config = useAuthConfig()
  const microsoftStartUrl = config.data?.microsoft ? config.data.microsoftStartUrl : null

  const devUserOptions = devUsers.data ?? []
  const defaultDevUsername = devUserOptions.some(u => u.username === 'admin')
    ? 'admin'
    : (devUserOptions[0]?.username ?? 'admin')
  const devUsername = devUsernameOverride ?? defaultDevUsername

  useEffect(() => {
    if (!microsoftCode) return
    const w = describeMicrosoftOutcome(microsoftCode, 'signin')
    // Written a tick after mount: AnnouncementRegion must already be on the page for a screen reader to announce its text.
    const tick = setTimeout(() => setAnnounced(w.nextStep ? `${w.sentence} ${w.nextStep}` : w.sentence), 0)
    navigate({ search: '' }, { replace: true })
    return () => clearTimeout(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
  }, [])

  useEffect(() => {
    if (step === 'verify' && (codeProblem === null || codeProblem === 'wrong')) {
      codeRef.current?.focus()
      if (codeProblem === 'wrong') codeRef.current?.select()
    }
  }, [step, second, codeProblem])

  const lastSendAttempt = () => lastSend.current ?? readVerificationSend()

  const noteSendAttempt = (address: string, went: boolean) => {
    const record = { email: address, at: Date.now(), went }
    lastSend.current = record
    writeVerificationSend(record)
  }

  // "Send it again" waits for what is left of the hold after a send (all of it for one just made, less for one made a moment ago).
  const holdResend = (ms: number = VERIFICATION_HOLD_MS) => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    setResendHeld(ms > 0)
    holdTimer.current = ms > 0 ? setTimeout(() => setResendHeld(false), ms) : null
  }

  const clearResend = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    setUnverified(null)
    setResend('idle')
    setResendHeld(false)
  }

  const toPassword = () => {
    setStep('password')
    setSecond(null)
    setEnrolUser(null)
    setCode('')
    setCodeProblem(null)
    setJustSetUp(false)
  }

  const leaveFirebase = async () => {
    try {
      if (auth) await signOut(auth)
    } catch {
      /* nothing to clean up */
    }
  }

  const applyLoginSuccess = (res: ApiResponse<AuthResponseDto>) => {
    if (res.success && res.data) {
      setPassword('')
      toPassword()
      storeSession(res.data)
      navigate('/', { replace: true })
      return true
    }
    return false
  }

  const startVerify = (resolver: MultiFactorResolver) => {
    const hint = resolver.hints.find(h => h.factorId === TotpMultiFactorGenerator.FACTOR_ID)
    setSecond({ resolver, hintUid: hint?.uid ?? null })
    setCode('')
    setCodeProblem(null)
    setStep('verify')
  }

  // The exchange wants two-step verification. An account that already has an app can't add another here (and would be told to sign in again), so it signs out.
  const startEnrol = async (user: User) => {
    if (multiFactor(user).enrolledFactors.length > 0) {
      await leaveFirebase()
      setProblem({ sentence: 'Sign in again to finish.' })
      return
    }
    setEnrolUser(user)
    setStep('enrol')
  }

  // Everything a failed sign-in can be, from the password step or from the set-up step's second sign-in.
  const showLoginError = async (err: unknown) => {
    if (err instanceof SecondFactorRequired) {
      startVerify(err.resolver)
      return
    }
    if (err instanceof EnrolmentRequired) {
      await startEnrol(err.user)
      return
    }
    // The exchange refused the sign-in and said why: the mutation rejects with a SignInRefused, having already ended the Firebase session and, for an
    // unverified email, sent the verification link (unless told not to). Anything else is a Firebase AuthError from signInWithEmailAndPassword (has a `.code`)
    // or a network failure from the exchange call (`.code === 'ERR_NETWORK'`, or a request that got no response).
    if (err instanceof SignInRefused) {
      let verification = err.verification
      if (err.refusal.code === 'EmailNotVerified') {
        if (verification === 'sent' || verification === 'not-sent') noteSendAttempt(email, verification === 'sent')
        // A link only "went a moment ago" if that attempt went. After one that failed, say so, as for any send that failed.
        else if (verification === 'recent' && lastSendAttempt()?.went === false) verification = 'not-sent'
        setUnverified({ email, password })
        // Send it again waits out the hold after a send that went; after one that failed it stays free, so the person can try again.
        if (verification === 'sent' || verification === 'recent') holdResend(holdLeftMs(lastSendAttempt(), email))
      }
      setProblem(describeSignInRefusal(err.refusal, email, verification))
      return
    }

    const firebaseCode = (err as { code?: string })?.code
    const httpStatus = (err as { response?: { status?: number } })?.response?.status
    const isNetworkError = firebaseCode === 'auth/network-request-failed' || firebaseCode === 'ERR_NETWORK' || (!httpStatus && (err as { request?: unknown })?.request)

    if (firebaseCode === 'auth/too-many-requests') {
      setProblem({ sentence: 'Too many attempts. Try again in a few minutes.' })
    } else if (
      firebaseCode === 'auth/wrong-password' ||
      firebaseCode === 'auth/user-not-found' ||
      firebaseCode === 'auth/invalid-credential' ||
      firebaseCode === 'auth/invalid-email'
    ) {
      // One sentence for all of them, so a wrong password and an address Firebase has never heard of cannot be told apart.
      setProblem({ sentence: "That email and password don't match.", nextStep: 'Check them, or use Forgot password.' })
    } else if (isNetworkError) {
      setProblem({ sentence: 'Network error. Check your connection and try again.' })
    } else {
      setProblem({ sentence: 'Login failed. Please try again.' })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Sign In is disabled while a resend is in flight (its late sign-out would end the Firebase session this sign-in makes); Enter in a field must not get round that.
    if (resend === 'sending') return
    setProblem(null)
    setResetSent(false)
    clearResend()
    // A link was attempted for this address a moment ago: if the exchange refuses an unverified email again, the sign-in is told not to send another.
    const sendHeldBack = holdLeftMs(lastSendAttempt(), email) > 0
    try {
      const res = await login.mutateAsync(sendHeldBack ? { email, password, sendVerification: false } : { email, password })
      if (!applyLoginSuccess(res)) {
        setProblem({ sentence: res.errors?.[0] || 'Login failed' })
      }
    } catch (err) {
      await showLoginError(err)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!second?.hintUid || code.length !== 6 || verify.isPending) return
    setProblem(null)
    setCodeProblem(null)
    try {
      const res = await verify.mutateAsync({ resolver: second.resolver, hintUid: second.hintUid, code })
      if (!applyLoginSuccess(res)) {
        toPassword()
        setProblem({ sentence: res.errors?.[0] || 'Login failed' })
      }
    } catch (err) {
      if (err instanceof SignInRefused) {
        toPassword()
        setProblem(describeSignInRefusal(err.refusal, email, err.verification))
      } else if (err instanceof EnrolmentRequired) {
        await leaveFirebase()
        toPassword()
        setProblem({ sentence: 'Sign in again to finish.' })
      } else {
        const found = twoStepProblem(err, 'verify')
        setProblem({ sentence: found.sentence })
        setCodeProblem(found.kind)
      }
    }
  }

  // Back and Cancel: the Firebase session (if any) ends and the password goes; the email stays.
  const handleBack = async () => {
    await leaveFirebase()
    setPassword('')
    setProblem(null)
    toPassword()
  }

  // The factor was added: a fresh token, then the exchange again. If it still refuses, signing in again lands on Verify (the account has an app now).
  const finishEnrolment = async () => {
    if (!enrolUser) return
    setProblem(null)
    try {
      const res = await afterEnrolment.mutateAsync({ user: enrolUser })
      if (!applyLoginSuccess(res)) {
        toPassword()
        setProblem({ sentence: res.errors?.[0] || 'Login failed' })
      }
    } catch (err) {
      if (err instanceof EnrolmentRequired) {
        setJustSetUp(true)
        try {
          const res = await login.mutateAsync({ email, password })
          if (!applyLoginSuccess(res)) {
            toPassword()
            setProblem({ sentence: res.errors?.[0] || 'Login failed' })
          }
        } catch (again) {
          await showLoginError(again)
        }
        return
      }
      if (err instanceof SignInRefused) {
        toPassword()
        setProblem(describeSignInRefusal(err.refusal, email, err.verification))
        return
      }
      await leaveFirebase()
      toPassword()
      setProblem({ sentence: "Two-step verification is on, but signing in didn't finish.", nextStep: 'Sign in again.' })
    }
  }

  const handleResend = async () => {
    if (!unverified || resendHeld || resend === 'sending') return
    setResend('sending')
    let went = true
    try {
      await resendVerification.mutateAsync(unverified)
      setResend('sent')
    } catch (err) {
      if (err instanceof SignInAgainNeeded) {
        // Not an attempt: nothing was sent, so no hold.
        clearResend()
        setProblem({ sentence: 'Sign in again to send it.' })
        return
      }
      went = false
      setResend('failed')
    }
    // Sent or not, this was an attempt: the next Sign In inside the hold sends no other, and the button waits.
    noteSendAttempt(unverified.email, went)
    holdResend()
  }

  const handleForgotPassword = async () => {
    clearResend()
    if (!email) {
      setProblem({ sentence: 'Enter your email address first, then click Forgot password' })
      return
    }
    if (!auth) {
      setProblem({ sentence: 'Password reset is unavailable in dev-auth mode.' })
      return
    }
    try {
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
      setProblem(null)
    } catch {
      setProblem({ sentence: 'Could not send reset email. Check the address and try again.' })
    }
  }

  const handleDevLogin = async () => {
    setProblem(null)
    setResetSent(false)
    clearResend()
    try {
      const res = await devLogin.mutateAsync({ username: devUsername })
      if (!applyLoginSuccess(res)) {
        setProblem({ sentence: res.errors?.[0] || 'Login failed' })
      }
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 429) {
        setProblem({ sentence: 'Too many sign-in attempts. Wait a few minutes and try again.' })
      } else if (status === 404) {
        setProblem({ sentence: 'Dev login failed — is DEV_AUTH_ENABLED set on the API?' })
      } else {
        setProblem({ sentence: 'Dev login failed. Please try again.' })
      }
    }
  }

  const cardClass = 'bg-[var(--color-card)] rounded-[var(--radius-lg)] p-8 shadow-[var(--shadow-lift)]'
  const unsupported = step === 'verify' && second?.hintUid === null
  const cardHeader = (
    <>
      <h2 className="text-xl font-semibold mb-6 text-[var(--color-foreground)]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{step === 'verify' ? "Verify it's you" : step === 'enrol' ? 'Set up two-step verification' : 'Sign in to your account'}</h2>

      {problem && (
        <div id="login-problem">
        <Callout
          tone={problem.tone ?? 'error'}
          announce={problem.tone ? false : undefined}
          className="mb-4"
          actions={
            unverified ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleResend}
                // The label never changes: this is inside a role=alert, which a screen reader reads whole again whenever its text changes, so progress is
                // said in the status below instead. Held, not `disabled`: a keyboard user keeps focus on the button while it waits.
                aria-disabled={resendHeld || resend === 'sending'}
                aria-busy={resend === 'sending' || undefined}
                className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
              >
                Send it again
              </Button>
            ) : undefined
          }
        >
          <p>{problem.sentence}</p>
          {problem.nextStep && <p>{problem.nextStep}</p>}
        </Callout>
        </div>
      )}

      {/* A polite status that is always on the page, so what a resend does is announced when it is written into it (one that appears already holding its text
          is announced unreliably). The Callouts in it do not announce themselves too, and a failure is said here, not in a second alert. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {unverified && resend === 'sending' && <p className="sr-only">Sending the verification link.</p>}
        {verify.isPending && <p className="sr-only">Multi-factor verification is being completed.</p>}

        {unverified && resend === 'sent' && (
          <Callout tone="success" announce={false} className="mb-4">
            We've sent it again to {unverified.email}. It can take a few minutes, so check your spam folder.
          </Callout>
        )}

        {unverified && resend === 'failed' && (
          <Callout tone="warning" announce={false} className="mb-4">
            We couldn't send it just now. Wait a few minutes, then try again.
          </Callout>
        )}
      </div>

      {resetSent && (
        <Callout tone="success" className="mb-4">
          Password reset email sent. Check your inbox.
        </Callout>
      )}
    </>
  )

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-background)]">
      <main className="flex-1 flex items-center justify-center p-4">
        <AnnouncementRegion message={announced} />
        <div className="w-full max-w-md animate-fade-in">
          <div className="text-center mb-8">
            <h1><Wordmark size={32} /></h1>
          </div>

          {!config.isPending && step === 'enrol' && enrolUser && (
            <div className={cardClass}>
              {cardHeader}
              <p className="mb-4 max-w-prose text-sm text-[var(--color-muted-foreground)]">Your role needs a code from an authenticator app when you sign in. It takes about a minute.</p>
              <TwoStepSetup user={enrolUser} host="login" onEnrolled={finishEnrolment} onCancel={handleBack} onSignInAgain={handleBack} />
            </div>
          )}

          {!config.isPending && step === 'verify' && (
            <form onSubmit={handleVerify} className={cardClass}>
              {cardHeader}
              {justSetUp && (
                <Callout tone="success" announce={false} className="mb-4">You're set up. Enter the newest code from your app to finish signing in.</Callout>
              )}
              {unsupported ? (
                <p className="mb-4 max-w-prose text-sm">This account's verification method isn't supported here. Ask your administrator to reset two-step verification.</p>
              ) : (
                <div className="space-y-4">
                  <p className="max-w-prose text-sm">Enter the 6-digit code from your authenticator app.</p>
                  <CodeField
                    id="login-code"
                    ref={codeRef}
                    value={code}
                    onChange={t => setCode(codeDigits(t))}
                    invalid={codeProblem === 'wrong'}
                    describedBy={problem ? 'login-problem' : undefined}
                  />
                  {codeProblem === 'timed-out' ? (
                    <Button type="button" size="lg" className="w-full" onClick={handleBack}>Sign in again</Button>
                  ) : (
                    <Button type="submit" size="lg" className="w-full" disabled={code.length !== 6 || verify.isPending || codeProblem === 'too-many'}>
                      {verify.isPending ? 'Checking…' : 'Verify'}
                    </Button>
                  )}
                </div>
              )}
              <div className="mt-6 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={handleBack} className="min-h-[var(--tap-min)] text-sm text-[var(--color-primary)] hover:underline">Back</button>
                {!unsupported && <p className="text-xs text-[var(--color-muted-foreground)]">Lost your phone? Ask your administrator to reset two-step verification.</p>}
              </div>
            </form>
          )}

          {!config.isPending && step === 'password' && (
          <form onSubmit={handleSubmit} className={cardClass}>
            {cardHeader}

            <div className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]">Email</label>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="Enter your email"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="login-password" className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]">Password</label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className={`${inputClass} pr-12`}
                    placeholder="Enter your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                id="login-submit"
                type="submit"
                size="lg"
                className="w-full"
                disabled={login.isPending || resend === 'sending'}
              >
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
            </div>

            {microsoftStartUrl && (
              <>
                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-[var(--color-border)]" />
                  <span className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">or</span>
                  <div className="h-px flex-1 bg-[var(--color-border)]" />
                </div>
                <a
                  href={microsoftStartUrl}
                  className="flex min-h-11 w-full items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-[var(--ms-button-border)] bg-[var(--ms-button-bg)] px-3 text-[15px] font-semibold text-[var(--ms-button-fg)] transition-transform duration-100 hover:opacity-90 active:scale-[0.99] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-card)]"
                >
                  <svg aria-hidden="true" width="21" height="21" viewBox="0 0 21 21">
                    <rect width="10" height="10" fill="var(--ms-logo-red)" />
                    <rect x="11" width="10" height="10" fill="var(--ms-logo-green)" />
                    <rect y="11" width="10" height="10" fill="var(--ms-logo-blue)" />
                    <rect x="11" y="11" width="10" height="10" fill="var(--ms-logo-yellow)" />
                  </svg>
                  Sign in with Microsoft
                </a>
              </>
            )}

            <div className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:items-center mt-6">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="min-h-[var(--tap-min)] whitespace-nowrap text-sm text-[var(--color-primary)] hover:underline"
              >
                Forgot password?
              </button>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Contact your administrator for access.
              </p>
            </div>
          </form>
          )}

          {devAuthEnabled && (
            <div className="mt-6 bg-[var(--color-card)] rounded-[var(--radius-lg)] p-8 shadow-[var(--shadow-lift)]">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px flex-1 bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-muted-foreground)] uppercase tracking-wide">Developer sign-in</span>
                <div className="h-px flex-1 bg-[var(--color-border)]" />
              </div>

              <div className="space-y-4">
                {devUsers.data && devUsers.data.length > 0 ? (
                  <div>
                    <label htmlFor="dev-login-user" className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]">User</label>
                    <select
                      id="dev-login-user"
                      value={devUsername}
                      onChange={e => setDevUsernameOverride(e.target.value)}
                      className={inputClass}
                    >
                      {devUsers.data.map(u => (
                        <option key={u.username} value={u.username}>
                          {u.username} — {u.role}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="dev-login-user" className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]">Username</label>
                    <input
                      id="dev-login-user"
                      type="text"
                      value={devUsername}
                      onChange={e => setDevUsernameOverride(e.target.value)}
                      className={inputClass}
                      placeholder="admin"
                    />
                    {devUsers.isError ? (
                      <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                        {(devUsers.error as { response?: { status?: number } })?.response?.status === 429
                          ? "Couldn't load the user list — too many attempts, rate-limited. Type a username manually."
                          : "Couldn't load the user list, so type a username manually."}
                      </p>
                    ) : null}
                  </div>
                )}

                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  onClick={handleDevLogin}
                  disabled={devLogin.isPending}
                >
                  {devLogin.isPending ? 'Signing in…' : 'Sign in as selected user'}
                </Button>

                <p className="text-xs text-center text-[var(--color-on-warning-container)] bg-[var(--color-warning-container)] rounded-[var(--radius-lg)] py-2 px-3">
                  Development mode — authentication bypassed.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
      <PlatformFooter variant="public" />
    </div>
  )
}
