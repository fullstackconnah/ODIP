import { useMutation, useQuery } from '@tanstack/react-query'
import { getMultiFactorResolver, sendEmailVerification, signInWithEmailAndPassword, signOut, TotpMultiFactorGenerator, type MultiFactorError, type MultiFactorResolver, type User } from 'firebase/auth'
import { SecondFactorRequired, EnrolmentRequired, SignInAgainNeeded } from '@/lib/twoStep'
import { auth, devAuthEnabled } from '@/lib/firebase'
import { SignInRefused, signInRefusalOf, type VerificationSend } from '@/lib/signInRefusal'
import { apiClient, apiPostRaw, apiGet } from '../client'
import { offlineQueue } from '@/lib/offline/queue'
import type { ApiResponse, AuthConfigDto, AuthResponseDto, DevUserDto } from '../types'
import { setViewAs, clearViewAs } from '@/lib/viewAs'

// Where the sign-in page and its tests meet these: the classes live with the other two-step words (lib/twoStep.ts).
export { SignInAgainNeeded }

/** Keeps a sign-in response as the session: the token, the user, and the organisation the person views. Both the password and the Microsoft sign-in end here. */
export function storeSession(session: AuthResponseDto) {
  localStorage.setItem('odip_token', session.token)
  localStorage.setItem('odip_user', JSON.stringify(session))
  // Another worker's unsent changes and saved shifts never reach this sign-in; the same worker's queue stays to send.
  offlineQueue.dropOtherUsers(session.id)
  if (session.tenantId) setViewAs('odip_viewing_tenant', session.tenantId)
  // A password sign-in must not inherit a Microsoft refresh route from an earlier session; the Microsoft landing sets this again after.
  localStorage.removeItem('odip_sign_in_method')
  // Nor may it inherit a SuperAdmin's view-as state from a browser that was never logged out.
  clearViewAs('odip_viewing_user')
  localStorage.removeItem('odip_superadmin_user')
  // Sent now, not at the next app open: signing back in is a navigate(), so nothing else would trigger it.
  // Last, because the queue matches records on the view-as tenant set above.
  void offlineQueue.replay()
}

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

const hasCode = (err: unknown, code: string) => (err as { code?: string } | null)?.code === code

/**
 * Exchanges a signed-in Firebase user's ID token for an ODIP session. When the exchange REFUSES, it rejects with a `SignInRefused` that says why (the
 * login page words it): the exchange only refuses a token it has verified, and for an unverified email the verification link is sent here, while the person
 * is still signed in. Whatever the refusal, the Firebase session is ended, except MfaEnrolmentRequired: that one rejects with `EnrolmentRequired` and keeps it,
 * since the person adds the factor to this very user. A network failure is rethrown as it is.
 */
async function exchange(user: User, sendVerification: boolean, fresh = false) {
  const idToken = fresh ? await user.getIdToken(true) : await user.getIdToken()
  try {
    return await apiPostRaw<AuthResponseDto>('/auth/exchange', { idToken })
  } catch (err) {
    const refusal = signInRefusalOf(err)
    if (refusal?.code === 'MfaEnrolmentRequired') throw new EnrolmentRequired(user)
    let verification: VerificationSend | undefined
    if (refusal?.code === 'EmailNotVerified') verification = sendVerification ? await sendVerificationLink(user) : 'recent'
    await signOutOfFirebase()
    if (!refusal) throw err
    throw new SignInRefused(refusal, verification)
  }
}

/**
 * Signs in to Firebase, then exchanges the ID token for an ODIP session (see `exchange`). An account with two-step verification rejects with
 * `SecondFactorRequired` before any token exists. A Firebase error (wrong password) or a network failure is rethrown as it is.
 *
 * The link goes at most once per hold across attempts (Firebase rate-limits them): the page passes `sendVerification: false` when one was attempted a moment
 * ago, and the refusal then says so ('recent') instead of sending another.
 */
export function useLogin() {
  return useMutation({
    mutationFn: async ({ email, password, sendVerification = true }: { email: string; password: string; sendVerification?: boolean }) => {
      let credential
      try {
        credential = await signInWithEmailAndPassword(auth!, email, password)
      } catch (err) {
        if (hasCode(err, 'auth/multi-factor-auth-required')) throw new SecondFactorRequired(getMultiFactorResolver(auth!, err as MultiFactorError))
        throw err
      }
      return exchange(credential.user, sendVerification)
    },
  })
}

/** The code from the authenticator app: resolves the pending sign-in, then exchanges. A wrong code rejects with Firebase's error and the sign-in stays pending. */
export function useVerifySecondFactor() {
  return useMutation({
    mutationFn: async ({ resolver, hintUid, code }: { resolver: MultiFactorResolver; hintUid: string; code: string }) => {
      const credential = await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hintUid, code))
      return exchange(credential.user, true)
    },
  })
}

/** After a factor was added to a user the exchange had refused: a fresh token (it now carries the second factor), then the exchange again. */
export function useExchangeAfterEnrolment() {
  return useMutation({ mutationFn: ({ user }: { user: User }) => exchange(user, true, true) })
}

/**
 * Sends the verification link again. The refused sign-in ended its Firebase session, so this signs in again with what was typed, sends the link to that
 * user and signs out; Firebase's own error (it rate-limits) is rethrown after the sign-out. An account with two-step verification can't be signed in without
 * a code, so that rejects with `SignInAgainNeeded`.
 */
export function useResendVerification() {
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      let credential
      try {
        credential = await signInWithEmailAndPassword(auth!, email, password)
      } catch (err) {
        throw hasCode(err, 'auth/multi-factor-auth-required') ? new SignInAgainNeeded() : err
      }
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

/**
 * GET /auth/config: is Sign in with Microsoft on, and where does it start. Asked once per page load. The login page waits for it, so it gives up after 3 s and
 * a failure reads as off: the page is then just the password sign-in.
 */
export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: async () => (await apiClient.get<ApiResponse<AuthConfigDto>>('/auth/config', { timeout: 3000 })).data.data as AuthConfigDto,
    staleTime: Infinity,
    retry: false,
  })
}
