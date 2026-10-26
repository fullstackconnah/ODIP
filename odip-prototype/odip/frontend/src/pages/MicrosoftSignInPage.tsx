import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { storeSession } from '@/api/hooks'
import { apiPostRaw } from '@/api/client'
import type { AuthResponseDto } from '@/api/types'
import { Wordmark } from '@/components/Wordmark'

/**
 * Where the server's Microsoft callback lands. The callback has set the session cookies; this trades the refresh cookie for a token the way every later refresh does,
 * stores the session like the password sign-in, and remembers it was a Microsoft one (so a session that ends says why). Any failure goes back to /login.
 */
export default function MicrosoftSignInPage() {
  const navigate = useNavigate()
  const started = useRef(false)

  useEffect(() => {
    // Post once; StrictMode runs effects twice.
    if (started.current) return
    started.current = true
    apiPostRaw<AuthResponseDto>('/auth/microsoft/refresh')
      .then(res => {
        if (!res.success || !res.data) throw new Error('refused')
        storeSession(res.data)
        localStorage.setItem('odip_sign_in_method', 'microsoft')
        navigate('/', { replace: true })
      })
      .catch(() => navigate('/login?microsoft=InvalidToken', { replace: true }))
  }, [navigate])

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-background)]">
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md animate-fade-in">
          <div className="mb-8 text-center">
            <h1><Wordmark size={32} /></h1>
          </div>
          <div className="rounded-[var(--radius-lg)] bg-[var(--color-card)] p-8 shadow-[var(--shadow-lift)]">
            <p role="status" className="text-[var(--color-foreground)]">Signing you in with Microsoft…</p>
          </div>
        </div>
      </main>
    </div>
  )
}
