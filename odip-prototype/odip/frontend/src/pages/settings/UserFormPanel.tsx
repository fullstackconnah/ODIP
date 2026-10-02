import { useState, useEffect, useId, useRef } from 'react'
import {
  useAdminTenantsSummary,
  useCreateAdminUser,
  useEnsureUserSignInAccount,
  useUpdateAdminUser,
} from '@/api/hooks'
import type { AdminUserDto, FirebaseAccountState } from '@/api/types'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Dropdown } from '@/components/Dropdown'
import { SignInEmailOutcome } from '@/components/SignInEmailOutcome'
import { SlideOver } from '@/components/SlideOver'
import { useRefocusWhenLost } from '@/hooks/useRefocusWhenLost'
import { addressConfirmationRequest } from '@/lib/addressConfirmation'
import { canSendSetPasswordEmail } from '@/lib/setPasswordEmail'
import {
  describeEmailOutcome, describeTypedPassword, ensureAndSendSetPasswordEmail, sendSetPasswordEmailFor, type EmailOutcome,
} from '@/lib/signInEmail'
import { MIN_PASSWORD_LENGTH, generateTemporaryPassword } from '@/lib/temporaryPassword'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UserFormPanelProps {
  isOpen: boolean
  onClose: () => void
  user?: AdminUserDto
  defaultTenantId?: string
}

// What a successful create leaves on screen. The panel does NOT close on a create: the answer (a password to share, a link on its way, a
// link that did not go) decides what the admin does next, and closing would take it away.
type Done = {
  userId: string
  name: string
  email: string
  /** Whether the Firebase account was just made or already existed: a typed password only reached a made one, and "set" or "reset" follows. */
  account: FirebaseAccountState
  withPassword: boolean
  /** What became of the set-password email; null when none was sent (a temporary password was set, or there is no Firebase). */
  outcome: EmailOutcome | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_OPTIONS = [
  { value: 'Admin', label: 'Admin' },
  { value: 'Coordinator', label: 'Coordinator' },
  { value: 'SupportWorker', label: 'Support Worker' },
  { value: 'ReadOnly', label: 'Read Only' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UserFormPanel({
  isOpen,
  onClose,
  user,
  defaultTenantId,
}: UserFormPanelProps) {
  const isEdit = !!user

  // Dropdown's trigger is a <button>, not a native <select> — a plain adjacent <label> with no
  // htmlFor/for isn't programmatically associated with it, so screen reader users landing on the
  // trigger hear nothing. aria-labelledby wires each label to its dropdown explicitly.
  const tenantLabelId = useId()
  const roleLabelId = useId()
  const passwordHintId = useId()

  const { data: tenants = [] } = useAdminTenantsSummary()
  const createMutation = useCreateAdminUser()
  const updateMutation = useUpdateAdminUser()
  const ensureAccount = useEnsureUserSignInAccount()

  const [tenantId, setTenantId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [password, setPassword] = useState('')
  // Create mode only. The default is no password: Firebase emails the user a link to set their own. Opening this swaps that for a
  // temporary password the admin chooses, for demo or offline use. Closed, the field is empty, so what is sent is what is shown.
  const [tempPasswordOpen, setTempPasswordOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  // The create is answered but the email is still going out, or a Send under the done state is: no second submit, no second send.
  const [submitting, setSubmitting] = useState(false)
  // The server wants the address checked (it is at neither the tenant's domain nor a common email provider): its sentence while the question
  // is up, null otherwise. Answering "Use this address" sends the same request again with the confirmation.
  const [confirmAddress, setConfirmAddress] = useState<string | null>(null)
  // The done view's first line takes focus when the form is swapped for it (the Create button that had it is gone), and again whenever a retry
  // removes the button that had it.
  const doneHeading = useRef<HTMLParagraphElement>(null)
  useRefocusWhenLost(doneHeading, done)

  // Reset form state when the panel opens or the user prop changes
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setTempPasswordOpen(false)
    setConfirmAddress(null)
    setDone(null)

    if (user) {
      setTenantId(user.tenantId)
      setFirstName(user.firstName)
      setLastName(user.lastName)
      setEmail(user.email)
      setUsername(user.username)
      setRole(user.role)
      setIsActive(user.isActive)
      setPassword('')
    } else {
      setTenantId(defaultTenantId ?? '')
      setFirstName('')
      setLastName('')
      setEmail('')
      setUsername('')
      setRole('')
      setIsActive(true)
      setPassword('')
    }
  }, [isOpen, user, defaultTenantId])

  const isBusy = createMutation.isPending || updateMutation.isPending || submitting

  // Unsaved edits: every field as it is now against what the open effect above put there (the user's own values in edit mode,
  // blanks and the default tenant in create mode). The two arrays list the fields in the same order.
  const current = JSON.stringify([tenantId, firstName, lastName, email, username, role, isActive, password])
  const initial = JSON.stringify([
    user?.tenantId ?? defaultTenantId ?? '', user?.firstName ?? '', user?.lastName ?? '', user?.email ?? '',
    user?.username ?? '', user?.role ?? '', user?.isActive ?? true, '',
  ])
  const dirty = current !== initial

  const passwordTooShort = password !== '' && password.length < MIN_PASSWORD_LENGTH

  const isFormValid =
    tenantId.trim() !== '' &&
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    email.trim() !== '' &&
    username.trim() !== '' &&
    role.trim() !== '' &&
    !passwordTooShort

  // Whether Firebase can email a link here: not in local dev auth, where there is no Firebase to send it.
  const emailLinkAvailable = canSendSetPasswordEmail()

  async function handleSubmit(addressConfirmed = false) {
    setError(null)
    setSubmitting(true)

    let created: AdminUserDto | undefined
    try {
      if (isEdit && user) {
        await updateMutation.mutateAsync({
          id: user.id,
          data: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            username: username.trim(),
            role,
            isActive,
          },
        })
      } else {
        created = await createMutation.mutateAsync({
          tenantId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          username: username.trim(),
          role,
          password: password || undefined,
          addressConfirmed: addressConfirmed || undefined,
        })
      }
    } catch (err: unknown) {
      const asking = addressConfirmationRequest(err)
      if (asking) {
        // Not a failure: the server wants the address checked first. Nothing was made, and what was typed stays.
        setConfirmAddress(asking)
        setSubmitting(false)
        return
      }
      const axiosErr = err as { response?: { data?: { errors?: string[]; message?: string } | string } }
      setError(
        (typeof axiosErr?.response?.data === 'string'
          ? axiosErr.response.data
          : axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message) ||
          'Failed to save user.',
      )
      setSubmitting(false)
      return
    }

    if (isEdit || !created) {
      setSubmitting(false)
      onClose()
      return
    }

    // The user exists now. Say what became of their sign-in, and stay to say it. A server that does not say whether the account was made
    // is read as made, which is what a create always did before it started to say.
    const account = created.firebaseAccount ?? 'created'
    const address = created.email || email.trim()
    const withPassword = password !== ''
    // A typed password is for them to use as it is. Otherwise Firebase emails the link, which goes straight out: the create already made or
    // found the account, so there is no ensure step. It is worded for a new account or an existing one.
    const outcome = !withPassword && emailLinkAvailable ? await sendSetPasswordEmailFor(address, account) : null
    setDone({ userId: created.id, name: created.fullName, email: address, account, withPassword, outcome })
    setSubmitting(false)
  }

  // What the done view says about their sign-in, once: the visible Callout shows it and the status region announces it.
  const doneSentence = !done
    ? null
    : done.outcome
      ? describeEmailOutcome(done.outcome, 'use Send again').message
      : done.withPassword
        ? describeTypedPassword(done.account, done.name, done.email)
        : null
  const announcement = done ? [`${done.name} was created.`, doneSentence].filter(Boolean).join(' ') : ''

  /** Sends again from the done state. A failed account step is redone through the server; anything else only needs Firebase asked again. */
  async function sendAgain() {
    if (!done || submitting) return
    setSubmitting(true)
    const redoAccount = !!done.outcome && !done.outcome.ok && done.outcome.reason === 'account'
    const outcome = redoAccount
      ? await ensureAndSendSetPasswordEmail(done.email, () => ensureAccount.mutateAsync(done.userId))
      : await sendSetPasswordEmailFor(done.email, done.account)
    setDone({ ...done, outcome })
    setSubmitting(false)
  }

  /** The typed password did not reach an account that already existed, so the way in is the link: the server makes sure of the account, then Firebase sends. */
  async function sendLinkToExistingAccount() {
    if (!done || submitting) return
    setSubmitting(true)
    const outcome = await ensureAndSendSetPasswordEmail(done.email, () => ensureAccount.mutateAsync(done.userId))
    setDone({ ...done, outcome })
    setSubmitting(false)
  }

  function toggleTempPassword() {
    setTempPasswordOpen(open => !open)
    setPassword('')
  }

  function handleGenerate() {
    try {
      setPassword(generateTemporaryPassword())
      setError(null)
    } catch {
      setError("Couldn't generate a password in this browser. Type one instead.")
    }
  }

  const inputClass =
    'w-full px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-all'
  const labelClass =
    'block text-xs font-medium text-[var(--color-muted-foreground)] mb-1'

  if (!isOpen) return null

  if (done) {
    return (
      <SlideOver
        open
        onClose={onClose}
        title="User created"
        dirty={false}
        bodyClassName="px-6 py-5 space-y-4"
        footerClassName="px-6 py-4"
        footer={
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        }
      >
        <AnnouncementRegion message={announcement} />
        <p ref={doneHeading} tabIndex={-1} className="text-sm font-medium text-[var(--color-foreground)] focus:outline-none">{done.name} was created.</p>
        {done.outcome ? (
          <SignInEmailOutcome outcome={done.outcome} retry="use Send again" onRetry={sendAgain} retrying={submitting} announce={false} />
        ) : done.withPassword && done.account === 'existing' ? (
          <Callout
            tone="warning"
            announce={false}
            actions={
              emailLinkAvailable ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={sendLinkToExistingAccount}
                  aria-disabled={submitting || undefined}
                  className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                >
                  {submitting ? 'Sending...' : 'Send set-password email'}
                </Button>
              ) : undefined
            }
          >
            <span className="break-words">{doneSentence}</span>
          </Callout>
        ) : done.withPassword ? (
          <Callout tone="success" announce={false}>{doneSentence}</Callout>
        ) : null}
      </SlideOver>
    )
  }

  return (
    <SlideOver
      open
      onClose={onClose}
      title={isEdit ? 'Edit User' : 'New User'}
      dirty={dirty}
      bodyClassName="px-6 py-5 space-y-4"
      footerClassName="px-6 py-4"
      footer={
        <div className="flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={isBusy || !isFormValid}
            className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {isBusy ? 'Saving...' : isEdit ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      }
    >
      {/* There before anything is said, and at the same place as in the done view, so what is written into it later is announced. */}
      <AnnouncementRegion message="" />

      {/* Tenant */}
      <div>
        <label id={tenantLabelId} className={labelClass}>Tenant *</label>
        <Dropdown
          variant="form"
          value={tenantId}
          onChange={setTenantId}
          items={tenants.map(t => ({ value: t.id, label: t.name }))}
          label="Select tenant"
          disabled={isEdit}
          aria-labelledby={tenantLabelId}
          aria-required="true"
        />
      </div>

      {/* First Name + Last Name */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="uf-firstName" className={labelClass}>
            First Name *
          </label>
          <input
            id="uf-firstName"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            className={inputClass}
            placeholder="First name"
          />
        </div>
        <div>
          <label htmlFor="uf-lastName" className={labelClass}>
            Last Name *
          </label>
          <input
            id="uf-lastName"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            className={inputClass}
            placeholder="Last name"
          />
        </div>
      </div>

      {/* Email */}
      <div>
        <label htmlFor="uf-email" className={labelClass}>
          Email *
        </label>
        <input
          id="uf-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className={inputClass}
          placeholder="user@example.com"
        />
      </div>

      {/* Username */}
      <div>
        <label htmlFor="uf-username" className={labelClass}>
          Username *
        </label>
        <input
          id="uf-username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className={inputClass}
          placeholder="Username"
        />
      </div>

      {/* Role */}
      <div>
        <label id={roleLabelId} className={labelClass}>Role *</label>
        <Dropdown
          variant="form"
          value={role}
          onChange={setRole}
          items={ROLE_OPTIONS}
          label="Select role"
          aria-labelledby={roleLabelId}
          aria-required="true"
        />
      </div>

      {/* Sign-in — create mode only. The default is no password: Firebase emails the user a link to set their own. */}
      {!isEdit && (
        <div className="space-y-2">
          {emailLinkAvailable && !tempPasswordOpen && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              We&apos;ll email {email.trim() || 'the user'} a link to set their password.
            </p>
          )}
          {/* -ml-3 cancels the Button's own padding, so the words line up with the text above and the hover wash sits in the panel's margin. */}
          <Button variant="ghost" size="sm" aria-expanded={tempPasswordOpen} onClick={toggleTempPassword} className="-ml-3">
            Set a temporary password instead
          </Button>
          {tempPasswordOpen && (
            <div>
              <label htmlFor="uf-password" className={labelClass}>Temporary password</label>
              <div className="flex gap-2">
                <input
                  id="uf-password"
                  type="text"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="off"
                  aria-describedby={passwordHintId}
                  aria-invalid={passwordTooShort || undefined}
                  className={inputClass}
                  placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`}
                />
                <Button variant="secondary" size="md" onClick={handleGenerate} className="shrink-0">
                  Generate
                </Button>
              </div>
              <p
                id={passwordHintId}
                className={`text-xs mt-1 ${passwordTooShort ? 'text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}
              >
                {passwordTooShort
                  ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
                  : `At least ${MIN_PASSWORD_LENGTH} characters. Ask them to change it with Forgot password after they first sign in.`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Active toggle — edit mode only */}
      {isEdit && (
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => setIsActive(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              isActive ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                isActive ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-sm text-[var(--color-foreground)]">
            {isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-[var(--color-error-container)] border border-[var(--color-destructive)]/20 rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--color-on-error-container)]">
          {error}
        </div>
      )}

      <ConfirmDialog
        open={confirmAddress !== null}
        title="Check this address"
        message={confirmAddress}
        confirmLabel="Use this address"
        cancelLabel="Go back"
        onCancel={() => setConfirmAddress(null)}
        onConfirm={() => {
          setConfirmAddress(null)
          void handleSubmit(true)
        }}
      />
    </SlideOver>
  )
}
