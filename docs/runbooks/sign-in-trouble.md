# Sign-in trouble

What to do when someone cannot sign in to ODIP, what each message on the login page means, and what never to do in the Firebase console.

ODIP signs people in with Firebase (email and password), then asks the API's `/auth/exchange` to turn the Firebase sign-in into an ODIP session. The
exchange refuses a sign-in for a reason, and since the "honest login failure messages" change the login page says which one. This page is about those
reasons.

## Rules that prevent most of it

1. **Never delete a user in the Firebase console and add them again.** A re-created account is a brand new account: nobody has proved they own the
   mailbox, so it is *unverified*, and ODIP refuses unverified accounts on purpose (the owner's own account was locked out this way). To give someone a
   way in, or back in, use ODIP:
   - Settings, Users (or the staff member's page): **Send set-password email** (**Send password reset email** once they have signed in before). It makes
     the Firebase account if there is none, as a *verified* account with no password, and emails the link to set one.
   - Or the person uses **Forgot password?** on the login page.
2. **Do not mark an account verified on someone's behalf** (in the console, or with the Admin SDK) unless you have confirmed by another channel that the
   person controls that mailbox. "Verified" is the only thing that stops a stranger who signed up in Firebase with that address from using it.
3. **Turn off Firebase self sign-up** (recommended). Firebase console, Authentication, Settings, User actions: untick *Enable create (sign-up)*. ODIP
   makes accounts through the Admin SDK, which should not be affected (confirm once with a test user). With sign-up open, anyone can create an unverified
   Firebase account for any address, which ODIP refuses, but which can also sit in the way of the real owner's account being made.

## What each message means

| The login page says | Code | What happened | What to do |
|---|---|---|---|
| "Your email address isn't verified yet. We've sent a verification link to ..." | `EmailNotVerified` | Firebase has an account for this address, but nobody has proved they own the mailbox (usually a re-created account). The page sent a verification link and signed out of Firebase. | The person opens the link from their own mailbox (check spam), then signs in again. **Send it again** resends it, at most every 30 seconds. See "Verifying an account safely" below. |
| "... isn't set up in ODIP. Ask your administrator to add you." | `NoOdipAccount` | The Firebase account is fine and verified, but no *active* ODIP user (or SuperAdmin) has this address. | Admin: add the user with exactly that address (Settings, Users, or Staff), or fix a typo in the address on their row, or reactivate an archived row. |
| "Your organisation's ODIP account is inactive." | `TenantInactive` | The user's organisation is switched off (or missing). | SuperAdmin: Settings, Tenants, edit the organisation and switch it on. |
| "That sign-in method isn't enabled for ODIP. Use your email and password." | `ProviderNotAllowed` | The sign-in came from a provider ODIP does not trust (Google, Microsoft, ...). Only the providers in `Auth:AllowedSignInProviders` get in (default `password` and `custom`). | The person signs in with email and password. To allow another provider, see "Harden the token exchange" in `odip-prototype/odip/docs/odip-changes-todo.md`. |
| "More than one ODIP account uses ..., so we can't tell which is yours." | `Ambiguous` | Two active users share the address (in any tenant, in any letter case), so nobody is signed in rather than guessing. | Admin: switch one off, or correct its address. The API log names both user ids. |
| "Too many attempts. Try again in N minutes." | `LockedOut` | Ten failed attempts from one network address inside 15 minutes. The count lives in the API's memory, so restarting the API clears it. | Wait. A sign-in that succeeds clears the count. |
| "That email and password don't match." | (Firebase) | A wrong password, or an address Firebase has no account for. Firebase deliberately does not say which. | **Forgot password?**; if no email arrives, the address may have no Firebase account yet: an admin sends the set-password email. |
| "We couldn't sign you in." | `InvalidToken` | The sign-in did not check out (an expired or foreign token, or a token missing what the exchange needs). | Try again. If it keeps happening, the API log says why. |

The API log has one line per refusal, each starting `Exchange failed` (or `Firebase token verification failed`, `SuperAdmin exchange`), with the reason and
the address, so the person's report and the log can be matched.

## Verifying an account safely

An unverified account is verified by the person who owns the mailbox, not by an admin:

1. Ask them to sign in at the login page. ODIP sends the verification link automatically and says so.
2. They open the link from their own mailbox, then sign in again. The exchange now accepts the account.

Completing **Forgot password?** also proves they own the mailbox, and Firebase normally marks the address verified when a reset link is completed; if the
page still says "isn't verified yet" after that, use the verification link. If neither email arrives, check the address on their ODIP row first.
