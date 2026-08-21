import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth, devAuthEnabled } from '@/lib/firebase'
import { useLogin, useDevLogin, useDevUsers } from '@/api/hooks'
import type { AuthResponseDto, ApiResponse } from '@/api/types'
import { Map, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [devUsernameOverride, setDevUsernameOverride] = useState<string | null>(null)
  const navigate = useNavigate()
  const login = useLogin()
  const devLogin = useDevLogin()
  const devUsers = useDevUsers()

  const devUserOptions = devUsers.data ?? []
  const defaultDevUsername = devUserOptions.some(u => u.username === 'admin')
    ? 'admin'
    : (devUserOptions[0]?.username ?? 'admin')
  const devUsername = devUsernameOverride ?? defaultDevUsername

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
    setError('')
    setResetSent(false)
    try {
      const res = await login.mutateAsync({ email, password })
      if (!applyLoginSuccess(res)) {
        setError(res.errors?.[0] || 'Login failed')
      }
    } catch {
      setError('Invalid email or password')
    }
  }

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email address first, then click Forgot password')
      return
    }
    if (!auth) {
      setError('Password reset is unavailable in dev-auth mode.')
      return
    }
    try {
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
      setError('')
    } catch {
      setError('Could not send reset email. Check the address and try again.')
    }
  }

  const handleDevLogin = async () => {
    setError('')
    setResetSent(false)
    try {
      const res = await devLogin.mutateAsync({ username: devUsername })
      if (!applyLoginSuccess(res)) {
        setError(res.errors?.[0] || 'Login failed')
      }
    } catch {
      setError('Dev login failed — is DEV_AUTH_ENABLED set on the API?')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[var(--color-primary)]/20">
            <Map className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-foreground)]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Odip</h1>
          <p className="text-[var(--color-muted-foreground)] mt-2">NDIS Trip Management Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 shadow-[0_24px_32px_-12px_rgba(27,28,26,0.08)]">
          <h2 className="text-xl font-semibold mb-6 text-[var(--color-foreground)]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Sign in to your account</h2>

          {error && (
            <div className="mb-4 p-3 rounded-2xl bg-[var(--color-error-container)] text-[var(--color-on-error-container)] text-sm">
              {error}
            </div>
          )}

          {resetSent && (
            <div className="mb-4 p-3 rounded-2xl bg-[#e8f5e9] text-[#2e7d32] text-sm">
              Password reset email sent. Check your inbox.
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-2xl bg-[var(--color-surface-container-low)] text-[var(--color-foreground)] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)]/30 transition-all"
                placeholder="Enter your email"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]">Password</label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl bg-[var(--color-surface-container-low)] text-[var(--color-foreground)] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)]/30 pr-12 transition-all"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
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
              className="w-full py-2.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] text-white font-bold hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-[var(--color-primary)]/20"
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
          <div className="mt-6 bg-white rounded-2xl p-8 shadow-[0_24px_32px_-12px_rgba(27,28,26,0.08)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 bg-[#e5e2da]" />
              <span className="text-xs text-[var(--color-muted-foreground)] uppercase tracking-wide">Developer sign-in</span>
              <div className="h-px flex-1 bg-[#e5e2da]" />
            </div>

            <div className="space-y-4">
              {devUsers.data && devUsers.data.length > 0 ? (
                <div>
                  <label htmlFor="dev-login-user" className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]">User</label>
                  <select
                    id="dev-login-user"
                    value={devUsername}
                    onChange={e => setDevUsernameOverride(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-2xl bg-[var(--color-surface-container-low)] text-[var(--color-foreground)] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)]/30 transition-all"
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
                    className="w-full px-4 py-2.5 rounded-2xl bg-[var(--color-surface-container-low)] text-[var(--color-foreground)] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)]/30 transition-all"
                    placeholder="admin"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={handleDevLogin}
                disabled={devLogin.isPending}
                className="w-full py-2.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] text-white font-bold hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-[var(--color-primary)]/20"
              >
                {devLogin.isPending ? 'Signing in...' : 'Sign in as selected user'}
              </button>

              <p className="text-xs text-center text-[#7a5c00] bg-[#fff3cd] rounded-2xl py-2 px-3">
                Development mode — authentication bypassed.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
