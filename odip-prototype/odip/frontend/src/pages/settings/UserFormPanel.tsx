import { useState, useEffect, useId } from 'react'
import {
  useAdminTenantsSummary,
  useCreateAdminUser,
  useUpdateAdminUser,
} from '@/api/hooks'
import type { AdminUserDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { SlideOver } from '@/components/SlideOver'
import type { Notify } from '@/hooks/useToast'
import { canSendSetPasswordEmail } from '@/lib/setPasswordEmail'
import { describeEmailOutcome, sendSetPasswordEmailFor } from '@/lib/signInEmail'
import { MIN_PASSWORD_LENGTH, generateTemporaryPassword } from '@/lib/temporaryPassword'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UserFormPanelProps {
  isOpen: boolean
  onClose: () => void
  user?: AdminUserDto
  defaultTenantId?: string
  /**
   * Where a create's outcome is announced once the panel has closed: whether the set-password email went, or that a temporary password
   * was set. Without it nothing is announced.
   */
  onNotify?: Notify
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
  onNotify,
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

  // Reset form state when the panel opens or the user prop changes
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setTempPasswordOpen(false)

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

  const isBusy = createMutation.isPending || updateMutation.isPending

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

  async function handleSubmit() {
    setError(null)

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
        await createMutation.mutateAsync({
          tenantId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          username: username.trim(),
          role,
          password: password || undefined,
        })
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { errors?: string[]; message?: string } | string } }
      setError(
        (typeof axiosErr?.response?.data === 'string'
          ? axiosErr.response.data
          : axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message) ||
          'Failed to save user.',
      )
      return
    }

    // The panel closes before the email goes: the user exists now, so there is nothing left to edit and nothing to submit twice.
    onClose()
    if (!isEdit) await announceCreated(email.trim(), password !== '')
  }

  /**
   * Says how a create went, and sends the set-password email when that is the plan. Never throws: the user exists by now, so a
   * failed email must not read as a failed create (creating again would only be refused as a duplicate).
   */
  async function announceCreated(createdEmail: string, withPassword: boolean) {
    if (withPassword) {
      onNotify?.('success', 'User created with a temporary password.')
    } else if (!emailLinkAvailable) {
      onNotify?.('success', 'User created.')
    } else {
      // The account was just made by the create above, so the email goes straight out (no ensure step), worded for a new account.
      const outcome = await sendSetPasswordEmailFor(createdEmail, 'created')
      const { tone, message } = describeEmailOutcome(outcome, 'in the Users table')
      onNotify?.(tone, `User created. ${message}`)
    }
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
            onClick={handleSubmit}
            disabled={isBusy || !isFormValid}
            className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {isBusy ? 'Saving...' : isEdit ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      }
    >
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
          <button
            type="button"
            aria-expanded={tempPasswordOpen}
            onClick={toggleTempPassword}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline"
          >
            Set a temporary password instead
          </button>
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
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="px-3 h-[var(--control-h)] border border-[var(--color-border)] rounded-[var(--radius-sm)] text-xs font-medium hover:bg-[var(--color-accent)] transition-colors whitespace-nowrap"
                >
                  Generate
                </button>
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
    </SlideOver>
  )
}
