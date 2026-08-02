# Firebase Auth Migration Design

**Date:** 2026-03-30
**Status:** Approved
**Driver:** Production readiness — real tenants, real data

---

## Problem

The existing auth system has several gaps that are unacceptable for production:

- JWT tokens stored in `localStorage` (XSS-vulnerable)
- 8-hour token expiry with no refresh implementation
- No password reset flow
- No email verification
- Manual user creation only (no self-service)
- Security maintenance burden owned entirely by this codebase

---

## Decision

Migrate identity management to **Firebase Authentication** (Google). Firebase owns:
- Password verification and storage
- Token issuance and refresh
- Password reset emails
- Email verification
- (Optional future) MFA, social login, breach detection

The Trip Planner backend continues to own:
- Tenant resolution (email domain → tenant)
- Role assignment
- All API authorization (unchanged)

---

## Architecture

### Auth Flow

```
LOGIN
  1. Frontend: signInWithEmailAndPassword(auth, email, password)   [Firebase SDK]
  2. Firebase: returns idToken (Google-signed JWT, ~1hr expiry)
  3. Frontend: POST /api/v1/auth/exchange { idToken }
  4. Backend: VerifyIdTokenAsync(idToken)                          [Firebase Admin SDK]
  5. Backend: lookup user by email → resolve tenant + role
  6. Backend: issue own JWT (30 min) with existing claims
  7. Frontend: store backend JWT in localStorage

SUBSEQUENT API REQUESTS
  → Authorization: Bearer {backend-JWT}
  → Validated by existing JWT middleware (no change)

TOKEN REFRESH (replaces unimplemented /auth/refresh)
  1. Backend returns 401 (JWT expired)
  2. Frontend: currentUser.getIdToken(true)    [force-refresh Firebase token]
  3. Frontend: POST /api/v1/auth/exchange { freshIdToken }
  4. Frontend: store new backend JWT, retry original request

PASSWORD RESET
  → Frontend: sendPasswordResetEmail(auth, email)   [Firebase SDK]
  → Firebase sends email directly — no backend code

LOGOUT
  → signOut(auth)          [Firebase SDK]
  → Clear localStorage
  → Redirect to /login
```

### Token Lifetimes

| Token | Issuer | Expiry | Storage |
|-------|--------|--------|---------|
| Firebase ID token | Google | ~1 hour (auto-refreshed) | Firebase SDK (memory) |
| Backend JWT | Odip API | 30 minutes | localStorage |

---

## Backend Changes

### New: `POST /api/v1/auth/exchange`

**Request:**
```json
{ "idToken": "<firebase-id-token>" }
```

**Behaviour:**
1. Verify `idToken` using `FirebaseAuth.DefaultInstance.VerifyIdTokenAsync(idToken)`
2. Extract `email` from verified token
3. **SuperAdmin path:** if email domain is `@odip.com.au`, bypass tenant resolution — set `TenantId = null`, `Role = SuperAdmin` (same as existing login logic)
4. **Standard path:** resolve tenant from email domain, look up tenant in DB — return 401 if tenant not found
5. Look up user in DB by email — return 401 if not found or inactive
6. Update `LastLoginAt`
7. Issue backend JWT with existing claims: `userId`, `username`, `email`, `role`, `tenant_id`, `fullName`
8. Return same response shape as old `/api/v1/auth/login`

**Rate limiting:** 5 requests per 5 minutes per IP (same as existing login endpoint).

**Error cases:**
- Invalid/expired Firebase token → 401
- Email not found in DB → 401 (do not distinguish — no user enumeration)
- User inactive → 401

### Removed: `POST /api/v1/auth/login`

Deleted entirely. Hard cutover — all existing users are demo accounts.

### Removed: `POST /api/v1/auth/refresh`

Removed (was unimplemented). Firebase + re-exchange replaces this.

### New package: `FirebaseAdmin`

Initialized at startup in `Program.cs`:

```csharp
FirebaseApp.Create(new AppOptions {
    Credential = GoogleCredential.FromJson(
        Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON"))
});
```

Service account JSON stored as environment variable — never committed to git.

### Database Migration

- Drop `PasswordHash` column from `Users` table
- Delete all existing seed users (all are demo accounts)
- Remove BCrypt.Net package dependency
- Update `DbSeeder.cs` to remove password hashing logic

---

## Frontend Changes

### New package: `firebase` (npm)

### New file: `src/lib/firebase.ts`

Firebase app initialization with config from environment variables:
```ts
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
```

Firebase config values are **not secrets** — safe to commit to `.env.example`, but actual values go in `.env.local`.

### Modified: Login flow (`src/pages/LoginPage.tsx`)

Replace Axios POST to `/api/v1/auth/login` with:
1. `signInWithEmailAndPassword(auth, email, password)` — Firebase SDK
2. `user.getIdToken()` — get Firebase ID token
3. `POST /api/v1/auth/exchange { idToken }` — get backend JWT
4. Store backend JWT + user metadata as today

### Modified: 401 handling (`src/api/client.ts`)

Replace redirect-to-login with re-exchange flow:
1. On 401: call `auth.currentUser?.getIdToken(true)` (force refresh Firebase token)
2. If successful: re-call `/api/v1/auth/exchange`, update stored JWT, retry original request
3. If Firebase token also fails: clear storage, redirect to `/login`

### New: Forgot password link (`src/pages/LoginPage.tsx`)

Add "Forgot password?" link that calls `sendPasswordResetEmail(auth, email)` and shows a confirmation message. No backend changes needed.

### Logout

Add `signOut(auth)` call before clearing localStorage (existing logout logic).

---

## User Migration

All existing users are demo accounts — no production data to preserve.

**Steps:**
1. Run EF migration to drop `PasswordHash` column
2. Clear all demo seed users from DB **except the SuperAdmin row** (SuperAdmin must be preserved — it is the platform operator account with cross-tenant access)
3. Create all accounts (including SuperAdmin) in Firebase console with new passwords
4. Update `DbSeeder.cs` to seed DB rows without password fields (email + metadata only); SuperAdmin row must always be seeded

**SuperAdmin account:**
- Email: `superadmin@odip.com.au` (or equivalent `@odip.com.au` address)
- Created in Firebase console manually
- DB row seeded by `DbSeeder.cs` with `Role = SuperAdmin`, `TenantId = null`
- `X-View-As-Tenant` header behaviour unchanged

---

## Environment Variables

### Backend (new)
```
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

### Frontend (new)
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

### Backend (removed)
```
JWT_SECRET  ← still needed (backend still issues its own JWTs)
```

---

## Firebase Console Setup (manual, before implementation)

1. Create Firebase project at console.firebase.google.com
2. Enable **Email/Password** sign-in provider
3. Create all accounts including **SuperAdmin** (`@odip.com.au` email) and demo tenant accounts
4. Generate a **Service Account** key (Project Settings → Service Accounts → Generate new private key)
5. Store service account JSON as `FIREBASE_SERVICE_ACCOUNT_JSON` env var

---

## Security Improvements Over Current State

| Area | Before | After |
|------|--------|-------|
| Token expiry | 8 hours | 30 minutes |
| Token refresh | Not implemented | Firebase auto-refresh + re-exchange |
| Password storage | BCrypt in own DB | Firebase (Google-managed) |
| Password reset | Not implemented | Firebase built-in |
| Email verification | Not implemented | Firebase built-in |
| Breach detection | None | Firebase built-in |
| MFA (future) | Not implemented | Firebase (one config toggle) |

---

## Out of Scope

- HTTP-only cookie token storage (can be a follow-up hardening task)
- MFA enforcement (available via Firebase, enable when needed)
- Social login / Google sign-in (available via Firebase, enable when needed)
- Audit logging for auth events (separate task)
- SuperAdmin impersonation audit trail (separate task)
