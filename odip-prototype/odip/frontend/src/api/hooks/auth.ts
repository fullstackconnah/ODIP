import { useMutation, useQuery } from '@tanstack/react-query'
import { sendEmailVerification, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { auth, devAuthEnabled } from '@/lib/firebase'
import { SignInRefused, signInRefusalOf, type VerificationSend } from '@/lib/signInRefusal'
import { apiPostRaw, apiGet } from '../client'
import type { AuthResponseDto, DevUserDto } from '../types'

/**
 * Sends the verification link and says whether it went. It never throws: Firebase rate-limits these, and a failed send must not hide the refusal that matters.
 */
async function sendVerificationLink(user: User): Promise<VerificationSend> {
  try {
    await sendEmailVerification(user)
    return 'sent'
  } catch {
    return 'not-sent'
  }
}

/** Ends the Firebase session. The exchange gave nothing for it to be used for, so none is left behind; failing to end it changes nothing for the person. */
async function signOutOfFirebase(): Promise<void> {
  try {
    if (auth) await signOut(auth)
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Signs in to Firebase, then exchanges the ID token for an ODIP session. When the exchange REFUSES, it rejects with a `SignInRefused` that says why (the
 * login page words it): the exchange only refuses a token it has verified, and for an unverified email the verification link is sent here, while the person
 * is still signed in. Whatever the refusal, the Firebase session is ended. A Firebase error (wrong password) or a network failure is rethrown as it is.
 *
 * The link goes at most once per hold across attempts (Firebase rate-limits them): the page passes `sendVerification: false` when one was attempted a moment
 * ago, and the refusal then says so ('recent') instead of sending another.
 */
export function useLogin() {
  return useMutation({
    mutationFn: async ({ email, password, sendVerification = true }: { email: string; password: string; sendVerification?: boolean }) => {
      const credential = await signInWithEmailAndPassword(auth!, email, password)
      const idToken = await credential.user.getIdToken()
      try {
        return await apiPostRaw<AuthResponseDto>('/auth/exchange', { idToken })
      } catch (err) {
        const refusal = signInRefusalOf(err)
        let verification: VerificationSend | undefined
        if (refusal?.code === 'EmailNotVerified') verification = sendVerification ? await sendVerificationLink(credential.user) : 'recent'
        await signOutOfFirebase()
        if (!refusal) throw err
        throw new SignInRefused(refusal, verification)
      }
    },
  })
}

/**
 * Sends the verification link again. The refused sign-in ended its Firebase session, so this signs in again with what was typed, sends the link to that
 * user and signs out; Firebase's own error (it rate-limits) is rethrown after the sign-out.
 */
export function useResendVerification() {
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const credential = await signInWithEmailAndPassword(auth!, email, password)
      try {
        await sendEmailVerification(credential.user)
      } finally {
        await signOutOfFirebase()
      }
    },
  })
}

export function useDevLogin() {
  return useMutation({
    mutationFn: ({ username }: { username: string }) =>
      apiPostRaw<AuthResponseDto>('/auth/dev-login', { username }),
  })
}

export function useDevUsers() {
  return useQuery({
    queryKey: ['dev-users'],
    queryFn: () => apiGet<DevUserDto[]>('/auth/dev-users'),
    enabled: devAuthEnabled,
    retry: false,
  })
}
