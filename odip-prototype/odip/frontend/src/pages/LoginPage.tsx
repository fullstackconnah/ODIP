import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth, devAuthEnabled } from '@/lib/firebase'
import { useLogin, useResendVerification, useDevLogin, useDevUsers } from '@/api/hooks'
import type { AuthResponseDto, ApiResponse } from '@/api/types'
import { Callout } from '@/components/Callout'
import { Button } from '@/components/Button'
import { SignInRefused, describeSignInRefusal, type RefusalWords } from '@/lib/signInRefusal'
import { VERIFICATION_HOLD_MS, holdLeftMs, readVerificationSend, writeVerificationSend, type VerificationSendRecord } from '@/lib/verificationSend'
import { Map, Eye, EyeOff } from 'lucide-react'

/** What the person is told: one plain sentence, and what to do next when the sentence does not already say. */
type Problem = RefusalWords

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
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
  const devLogin = useDevLogin()
  const devUsers = useDevUsers()

  const devUserOptions = devUsers.data ?? []
  const defaultDevUsername = devUserOptions.some(u => u.username === 'admin')
    ? 'admin'
    : (devUserOptions[0]?.username ?? 'admin')
  const devUsername = devUsernameOverride ?? defaultDevUsername

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
  }, [])

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

  const applyLoginSuccess = (res: ApiResponse<AuthResponseDto>) => {
    if (res.success && res.data) {
      localStorage.setItem('odip_token', res.data.token)
      localStorage.setItem('odip_user', JSON.stringify(res.data))
      if (res.data.tenantId) {
        localStorage.setItem('odip_viewing_tenant', res.data.tenantId)
      }
      navigate('/')
      return true
    }
    return false
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
  }

  const handleResend = async () => {
    if (!unverified || resendHeld || resend === 'sending') return
    setResend('sending')
    let went = true
    try {
      await resendVerification.mutateAsync(unverified)
      setResend('sent')
    } catch {
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[var(--color-primary)]/20">
            <Map className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-foreground)]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Odip</h1>
          <p className="text-[var(--color-muted-foreground)] mt-2">NDIS Trip Management Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[var(--color-card)] rounded-[var(--radius-lg)] p-8 shadow-[0_24px_32px_-12px_rgba(27,28,26,0.08)]">
          <h2 className="text-xl font-semibold mb-6 text-[var(--color-foreground)]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Sign in to your account</h2>

          {problem && (
            <Callout
              tone="error"
              className="mb-4"
              actions={
                unverified ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleResend}
                    // Held, not `disabled`: a keyboard user keeps focus on the button while it waits.
                    aria-disabled={resendHeld || resend === 'sending'}
                    className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                  >
                    {resend === 'sending' ? 'Sending...' : 'Send it again'}
                  </Button>
                ) : undefined
              }
            >
              <p>{problem.sentence}</p>
              {problem.nextStep && <p>{problem.nextStep}</p>}
            </Callout>
          )}

          {unverified && resend === 'sent' && (
            <Callout tone="success" className="mb-4">
              We've sent it again to {unverified.email}. It can take a few minutes, so check your spam folder.
            </Callout>
          )}

          {unverified && resend === 'failed' && (
            <Callout tone="warning" className="mb-4">
              We couldn't send it just now. Wait a few minutes, then try again.
            </Callout>
          )}

          {resetSent && (
            <Callout tone="success" className="mb-4">
              Password reset email sent. Check your inbox.
            </Callout>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-[var(--radius-lg)] bg-[var(--color-surface-container-low)] text-[var(--color-foreground)] focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
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
                  className="w-full px-4 py-2.5 rounded-[var(--radius-lg)] bg-[var(--color-surface-container-low)] text-[var(--color-foreground)] focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] pr-12 transition-all"
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

            <button
              id="login-submit"
              type="submit"
              disabled={login.isPending}
              className="w-full py-2.5 rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] text-white font-bold hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-[var(--color-primary)]/20"
            >
              {login.isPending ? 'Signing in...' : 'Sign In'}
            </button>
          </div>

          <div className="flex justify-between items-center mt-6">
            <button
              type="button"
              onClick={handleForgotPassword}
              className="text-xs text-[var(--color-primary)] hover:underline"
            >
              Forgot password?
            </button>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Contact your administrator for access.
            </p>
          </div>
        </form>

        {devAuthEnabled && (
          <div className="mt-6 bg-[var(--color-card)] rounded-[var(--radius-lg)] p-8 shadow-[0_24px_32px_-12px_rgba(27,28,26,0.08)]">
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
                    className="w-full px-4 py-2.5 rounded-[var(--radius-lg)] bg-[var(--color-surface-container-low)] text-[var(--color-foreground)] focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
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
                    className="w-full px-4 py-2.5 rounded-[var(--radius-lg)] bg-[var(--color-surface-container-low)] text-[var(--color-foreground)] focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
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

              <button
                type="button"
                onClick={handleDevLogin}
                disabled={devLogin.isPending}
                className="w-full py-2.5 rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] text-white font-bold hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-[var(--color-primary)]/20"
              >
                {devLogin.isPending ? 'Signing in...' : 'Sign in as selected user'}
              </button>

              <p className="text-xs text-center text-[var(--color-on-warning-container)] bg-[var(--color-warning-container)] rounded-[var(--radius-lg)] py-2 px-3">
                Development mode — authentication bypassed.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
