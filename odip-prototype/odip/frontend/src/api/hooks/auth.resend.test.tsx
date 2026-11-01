import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { SignInAgainNeeded, useResendVerification } from './auth'

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn().mockRejectedValue({ code: 'auth/multi-factor-auth-required' }),
  sendEmailVerification: vi.fn(),
  signOut: vi.fn(),
  getMultiFactorResolver: vi.fn(),
  TotpMultiFactorGenerator: { FACTOR_ID: 'totp' },
}))
vi.mock('@/lib/firebase', () => ({ auth: {}, devAuthEnabled: false }))

describe('useResendVerification', () => {
  it('reads auth/multi-factor-auth-required as "sign in again", not as a failed send', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useResendVerification(), { wrapper })

    await expect(result.current.mutateAsync({ email: 'a@b.example', password: 'pw' })).rejects.toBeInstanceOf(SignInAgainNeeded)
  })
})
