import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '@/lib/firebase'

// Firebase sends the email (the app has no SMTP of its own), and `auth` is null where Firebase is not configured: local dev auth.
// It is read at call time, not captured at import, so a caller always sees the live value.

/** Whether a set-password email can be sent here. When it cannot, callers hide the actions that would send one. */
export function canSendSetPasswordEmail(): boolean {
  return !!auth
}

/** Asks Firebase to email `email` a link to set a password. Rejects when Firebase is not configured, or when the send fails. */
export async function sendSetPasswordEmail(email: string): Promise<void> {
  if (!auth) throw new Error('Firebase is not configured here, so no set-password email can be sent.')
  await sendPasswordResetEmail(auth, email)
}
