import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '@/lib/firebase'

// Firebase sends the email (the app has no SMTP of its own), and `auth` is null where Firebase is not configured: local dev auth.
// It is read at call time, not captured at import, so a caller always sees the live value.

/** Whether a set-password email can be sent here. When it cannot, callers hide the actions that would send one. */
export function canSendSetPasswordEmail(): boolean {
  return !!auth
}

/**
 * What the send action on an existing user is called. The email is the same either way (Firebase's password-reset link), but someone who has
 * never signed in is being given a first password ("set"), and someone who has is getting a reset. `lastLoginAt` is null until the first sign-in.
 */
export function sendActionLabel(lastLoginAt: string | null | undefined): string {
  return lastLoginAt ? 'Send password reset email' : 'Send set-password email'
}

/** Asks Firebase to email `email` a link to set a password. Rejects when Firebase is not configured, or when the send fails. */
export async function sendSetPasswordEmail(email: string): Promise<void> {
  if (!auth) throw new Error('Firebase is not configured here, so no set-password email can be sent.')
  await sendPasswordResetEmail(auth, email)
}
