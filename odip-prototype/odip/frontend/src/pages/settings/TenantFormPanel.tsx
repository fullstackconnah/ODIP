import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Dropdown } from '@/components/Dropdown'
import { SignInEmailOutcome } from '@/components/SignInEmailOutcome'
import { SlideOver } from '@/components/SlideOver'
import {
  useCreateTenantWithSetup,
  useEnsureUserSignInAccount,
  useUpdateTenant,
} from '@/api/hooks/admin'
import type { TenantSummaryDto, CreateTenantWithSetupDto, FirebaseAccountState, UpdateTenantDto } from '@/api/types'
import { useRefocusWhenLost } from '@/hooks/useRefocusWhenLost'
import { addressConfirmationRequest } from '@/lib/addressConfirmation'
import { canSendSetPasswordEmail } from '@/lib/setPasswordEmail'
import {
  describeEmailOutcome, describeTypedPassword, ensureAndSendSetPasswordEmail, sendSetPasswordEmailFor, TENANT_FIRST_USER_ACCOUNT_FAILED, type EmailOutcome,
} from '@/lib/signInEmail'
import { MIN_PASSWORD_LENGTH, generateTemporaryPassword } from '@/lib/temporaryPassword'

// What a successful create leaves on screen. The panel does NOT close on a create: what became of the first user's sign-in (a password to
// share, a link on its way, a link that did not go) decides what the admin does next, and closing would take it away.
type FirstUserDone = {
  userId: string
  name: string
  email: string
  /**
   * Whether the Firebase account was just made or already existed (a typed password only reached a made one, and "set" or "reset" follows),
   * or "failed": the tenant and the user exist, but their sign-in account could not be set up, so there is nothing to send to yet.
   */
  account: FirebaseAccountState | 'failed'
  withPassword: boolean
  /** What became of the set-password email; null when none was sent (a temporary password was set, or there is no Firebase). */
  outcome: EmailOutcome | null
}
type Done = { tenantName: string; firstUser: FirstUserDone | null }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUSTRALIAN_STATES = [
  { value: '', label: 'Select state...' },
  { value: 'ACT', label: 'ACT' },
  { value: 'NSW', label: 'NSW' },
  { value: 'NT', label: 'NT' },
  { value: 'QLD', label: 'QLD' },
  { value: 'SA', label: 'SA' },
  { value: 'TAS', label: 'TAS' },
  { value: 'VIC', label: 'VIC' },
  { value: 'WA', label: 'WA' },
]

const ROLE_OPTIONS = [
  { value: '', label: 'Select role...' },
  { value: 'Admin', label: 'Admin' },
  { value: 'Manager', label: 'Manager' },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TenantFormPanelProps {
  isOpen: boolean
  onClose: () => void
  tenant?: TenantSummaryDto
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TenantFormPanel({
  isOpen,
  onClose,
  tenant,
}: TenantFormPanelProps) {
  const isEdit = !!tenant

  const createMutation = useCreateTenantWithSetup()
  const updateMutation = useUpdateTenant()
  const ensureAccount = useEnsureUserSignInAccount()

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Tenant Details state ──────────────────────────────────────────────────
  const [name, setName] = useState('')
  const [emailDomain, setEmailDomain] = useState('')
  const [isActive, setIsActive] = useState(true)

  // ── Provider Settings state ───────────────────────────────────────────────
  const [providerExpanded, setProviderExpanded] = useState(false)
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [abn, setAbn] = useState('')
  const [orgName, setOrgName] = useState('')
  const [address, setAddress] = useState('')
  const [state, setState] = useState('')
  const [gstRegistered, setGstRegistered] = useState(false)
  const [isPaceProvider, setIsPaceProvider] = useState(false)
  const [bankAccountName, setBankAccountName] = useState('')
  const [bsb, setBsb] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [invoiceFooterNotes, setInvoiceFooterNotes] = useState('')

  // ── Initial Admin User state ──────────────────────────────────────────────
  const [userExpanded, setUserExpanded] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('')
  const [userPassword, setUserPassword] = useState('')

  // ── UI state ──────────────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  // The create is answered but the email is still going out, or a Send under the done state is: no second submit, no second send.
  const [submitting, setSubmitting] = useState(false)
  // The server wants the first user's address checked (it is at neither the new tenant's domain nor a common email provider): its sentence while
  // the question is up, null otherwise. Answering "Use this address" sends the same request again with the confirmation.
  const [confirmAddress, setConfirmAddress] = useState<string | null>(null)
  // The done view's first line takes focus when the form is swapped for it (the Create button that had it is gone), and again whenever a retry
  // removes the button that had it.
  const doneHeading = useRef<HTMLParagraphElement>(null)
  useRefocusWhenLost(doneHeading, done)
  // Whether Firebase can email a link here: not in local dev auth, where there is no Firebase to send it.
  const emailLinkAvailable = canSendSetPasswordEmail()

  // ── Reset form on open ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setSuccessMessage(null)
    setConfirmAddress(null)
    setDone(null)
    setProviderExpanded(false)
    setUserExpanded(false)

    if (tenant) {
      // Edit mode — populate tenant details only
      setName(tenant.name)
      setEmailDomain(tenant.emailDomain)
      setIsActive(tenant.isActive)
    } else {
      // Create mode — clear everything
      setName('')
      setEmailDomain('')
      setIsActive(true)
      setRegistrationNumber('')
      setAbn('')
      setOrgName('')
      setAddress('')
      setState('')
      setGstRegistered(false)
      setIsPaceProvider(false)
      setBankAccountName('')
      setBsb('')
      setAccountNumber('')
      setInvoiceFooterNotes('')
      setFirstName('')
      setLastName('')
      setEmail('')
      setUsername('')
      setRole('')
      setUserPassword('')
    }
  }, [isOpen, tenant])

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // ── Submit handler ────────────────────────────────────────────────────────
  async function handleSubmit(addressConfirmed = false) {
    setError(null)
    setSubmitting(true)

    try {
      if (isEdit && tenant) {
        const data: UpdateTenantDto = { name, emailDomain, isActive }
        await updateMutation.mutateAsync({ id: tenant.id, data })
        setSuccessMessage('Tenant updated')
      } else {
        // Build provider settings only if any field is filled
        const hasProvider =
          registrationNumber || abn || orgName || address || state ||
          gstRegistered || isPaceProvider || bankAccountName || bsb ||
          accountNumber || invoiceFooterNotes

        const providerSettings = hasProvider
          ? {
              registrationNumber,
              abn,
              organisationName: orgName,
              address,
              state: state || undefined,
              gstRegistered,
              isPaceProvider,
              bankAccountName: bankAccountName || undefined,
              bsb: bsb || undefined,
              accountNumber: accountNumber || undefined,
              invoiceFooterNotes: invoiceFooterNotes || undefined,
            }
          : null

        // Build initial user only if required fields are filled
        const hasUser = firstName && lastName && email && username
        const initialUser = hasUser
          ? { firstName, lastName, email, username, role: role || 'Admin', password: userPassword || undefined, addressConfirmed: addressConfirmed || undefined }
          : null

        const data: CreateTenantWithSetupDto = {
          name,
          emailDomain,
          providerSettings,
          initialUser,
        }
        const created = await createMutation.mutateAsync(data)

        // The tenant exists now. Say what became of the first user's sign-in, and stay to say it. A server that does not say whether their
        // account was made is read as made, which is what a create always did before it started to say.
        let firstUser: FirstUserDone | null = null
        if (initialUser && created.initialUserId) {
          const account = created.firebaseAccount ?? 'created'
          const withPassword = !!initialUser.password
          // A typed password is for them to use as it is. Otherwise Firebase emails the link, which goes straight out: the create already
          // made or found the account, so there is no ensure step. It is worded for a new account or an existing one.
          const outcome = !withPassword && emailLinkAvailable && account !== 'failed' ? await sendSetPasswordEmailFor(initialUser.email, account) : null
          firstUser = {
            userId: created.initialUserId, name: `${initialUser.firstName} ${initialUser.lastName}`, email: initialUser.email, account, withPassword, outcome,
          }
        }
        setDone({ tenantName: name, firstUser })
        setSubmitting(false)
        return
      }

      setSubmitting(false)
      timerRef.current = setTimeout(() => {
        setSuccessMessage(null)
        onClose()
      }, 1500)
    } catch (err: unknown) {
      setSubmitting(false)
      const asking = addressConfirmationRequest(err)
      if (asking) {
        // Not a failure: the server wants the first user's address checked first. No tenant, user or account was made, and what was typed stays.
        setConfirmAddress(asking)
        return
      }
      const axiosErr = err as { response?: { data?: { errors?: string[]; message?: string } | string } }
      setError(
        (typeof axiosErr?.response?.data === 'string'
          ? axiosErr.response.data
          : axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message) ||
          'Failed to save tenant.',
      )
    }
  }

  // What the done view says about the first user's sign-in, once: the visible Callout shows it and the status region announces it.
  const first = done?.firstUser
  const doneSentence = !first
    ? null
    : first.outcome
      ? describeEmailOutcome(first.outcome, 'use Send again').message
      : first.account === 'failed'
        ? TENANT_FIRST_USER_ACCOUNT_FAILED
        : first.withPassword
          ? describeTypedPassword(first.account, first.name, first.email)
          : null
  const announcement = done ? [`${done.tenantName} was created.`, doneSentence].filter(Boolean).join(' ') : ''

  /** Sends again from the done state. A failed account step is redone through the server; anything else only needs Firebase asked again. */
  async function sendAgain() {
    if (!done || !first || submitting) return
    setSubmitting(true)
    // With no account yet ("failed") or a failed account step, the retry goes through the server again; otherwise only Firebase is asked again.
    const outcome =
      first.account === 'failed' || (first.outcome && !first.outcome.ok && first.outcome.reason === 'account')
        ? await ensureAndSendSetPasswordEmail(first.email, () => ensureAccount.mutateAsync(first.userId))
        : await sendSetPasswordEmailFor(first.email, first.account)
    setDone({ ...done, firstUser: { ...first, outcome } })
    setSubmitting(false)
  }

  /** There is no usable sign-in yet (the account existed and the typed password did not reach it, or it could not be set up): the way in is the link. The server makes sure of the account, then Firebase sends. */
  async function sendLinkToExistingAccount() {
    if (!done || !first || submitting) return
    setSubmitting(true)
    const outcome = await ensureAndSendSetPasswordEmail(first.email, () => ensureAccount.mutateAsync(first.userId))
    setDone({ ...done, firstUser: { ...first, outcome } })
    setSubmitting(false)
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const isBusy = createMutation.isPending || updateMutation.isPending || submitting
  // A typed first-user password is a live credential (the account is verified from the start), so it is held to a real minimum.
  const passwordTooShort = userPassword !== '' && userPassword.length < MIN_PASSWORD_LENGTH
  const canSubmit = name.trim() !== '' && emailDomain.trim() !== '' && !isBusy && !passwordTooShort

  function handleGenerate() {
    try {
      setUserPassword(generateTemporaryPassword())
      setError(null)
    } catch {
      setError("Couldn't generate a password in this browser. Type one instead.")
    }
  }

  // Unsaved edits: every field as it is now against what the open effect above put there (the tenant's own values in edit
  // mode, blanks in create mode). The two arrays list the fields in the same order. Once an EDIT has been saved (the
  // "Tenant updated" notice, up to the auto-close) there is nothing left to lose. A create never gets here: it ends in the done
  // view above, which passes dirty={false} itself.
  const current = JSON.stringify([
    name, emailDomain, isActive, registrationNumber, abn, orgName, address, state, gstRegistered, isPaceProvider,
    bankAccountName, bsb, accountNumber, invoiceFooterNotes, firstName, lastName, email, username, role, userPassword,
  ])
  const initial = JSON.stringify([
    tenant?.name ?? '', tenant?.emailDomain ?? '', tenant?.isActive ?? true, '', '', '', '', '', false, false,
    '', '', '', '', '', '', '', '', '', '',
  ])
  const dirty = current !== initial && !successMessage

  const inputClass =
    'w-full px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-all'
  // A textarea must not take inputClass's fixed height: an explicit height beats `rows`, collapsing the invoice footer notes to one
  // line. min-h keeps it level with the 32px / 44px inputs; h-auto lets `rows` set the height; resize-y lets the user grow it.
  const textareaClass =
    'w-full px-3 min-h-[var(--control-h)] h-auto py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-all resize-y'
  const labelClass = 'block text-xs font-medium text-[var(--color-muted-foreground)] mb-1'

  if (!isOpen) return null

  if (done) {
    return (
      <SlideOver
        open
        onClose={onClose}
        title="Tenant created"
        size="lg"
        dirty={false}
        bodyClassName="px-6 py-5 space-y-4"
        footerClassName="px-6 py-4 flex items-center justify-end gap-3"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <AnnouncementRegion message={announcement} />
        <p ref={doneHeading} tabIndex={-1} className="text-sm font-medium text-[var(--color-foreground)] focus:outline-none">{done.tenantName} was created.</p>
        {first &&
          (first.outcome ? (
            <SignInEmailOutcome outcome={first.outcome} retry="use Send again" onRetry={sendAgain} retrying={submitting} announce={false} />
          ) : first.account === 'failed' || (first.withPassword && first.account === 'existing') ? (
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
          ) : first.withPassword ? (
            <Callout tone="success" announce={false}>{doneSentence}</Callout>
          ) : null)}
      </SlideOver>
    )
  }

  return (
    <SlideOver
      open
      onClose={onClose}
      title={isEdit ? 'Edit Tenant' : 'New Tenant'}
      size="lg"
      dirty={dirty}
      bodyClassName="px-6 py-5 space-y-4"
      footerClassName="px-6 py-4 flex items-center justify-end gap-3"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => handleSubmit()} disabled={!canSubmit}>
            {isBusy ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Tenant'}
          </Button>
        </>
      }
    >
      {/* There before anything is said, and at the same place as in the done view, so what is written into it later is announced. */}
      <AnnouncementRegion message="" />

      {/* ── Section 1: Tenant Details ─────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--color-foreground)]">
          Tenant Details
        </h3>

        <div>
          <label className={labelClass}>Organisation Name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className={inputClass}
            placeholder="e.g. Acme Travel Co"
          />
        </div>

        <div>
          <label className={labelClass}>Email Domain *</label>
          <input
            type="text"
            value={emailDomain}
            onChange={e => setEmailDomain(e.target.value)}
            className={inputClass}
            placeholder="e.g. acme.com.au"
          />
        </div>

        {isEdit && (
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-[var(--color-muted-foreground)]">
              Active
            </label>
            <button
              type="button"
              onClick={() => setIsActive(v => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                isActive ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  isActive ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>
        )}
      </div>

      {/* ── Section 2: Provider Settings (create only) ────────────── */}
      {!isEdit && (
        <div>
          <button
            type="button"
            onClick={() => setProviderExpanded(p => !p)}
            className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-foreground)] hover:text-[var(--color-primary)] transition-colors"
          >
            {providerExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Provider Settings
          </button>

          {providerExpanded && (
            <div className="mt-3 space-y-3 pl-5 border-l border-[var(--color-border)]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Registration Number</label>
                  <input
                    type="text"
                    value={registrationNumber}
                    onChange={e => setRegistrationNumber(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>ABN</label>
                  <input
                    type="text"
                    value={abn}
                    onChange={e => setAbn(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Organisation Name</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  className={inputClass}
                  placeholder="Legal entity name"
                />
              </div>

              <div>
                <label className={labelClass}>Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>State</label>
                <Dropdown
                  variant="form"
                  value={state}
                  onChange={setState}
                  items={AUSTRALIAN_STATES}
                  label="Select state..."
                />
              </div>

              <div className="flex items-center gap-[var(--section-gap)]">
                <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={gstRegistered}
                    onChange={e => setGstRegistered(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                  />
                  GST Registered
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPaceProvider}
                    onChange={e => setIsPaceProvider(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                  />
                  PACE Provider
                </label>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Bank Account Name</label>
                  <input
                    type="text"
                    value={bankAccountName}
                    onChange={e => setBankAccountName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>BSB</label>
                  <input
                    type="text"
                    value={bsb}
                    onChange={e => setBsb(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Account Number</label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={e => setAccountNumber(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Invoice Footer Notes</label>
                <textarea
                  value={invoiceFooterNotes}
                  onChange={e => setInvoiceFooterNotes(e.target.value)}
                  rows={2}
                  className={textareaClass}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Section 3: Initial Admin User (create only) ───────────── */}
      {!isEdit && (
        <div>
          <button
            type="button"
            onClick={() => setUserExpanded(p => !p)}
            className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-foreground)] hover:text-[var(--color-primary)] transition-colors"
          >
            {userExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Initial Admin User
          </button>

          {userExpanded && (
            <div className="mt-3 space-y-3 pl-5 border-l border-[var(--color-border)]">
              {/* Info banner */}
              <div className="bg-[var(--color-secondary-container)] border border-[var(--color-border)] rounded-[var(--radius-md)] px-4 py-3 text-xs text-[var(--color-foreground)]">
                Optionally create an admin user for this tenant. All four
                fields (first name, last name, email, username) must be
                filled for the user to be created.
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="tf-first-name" className={labelClass}>First Name</label>
                  <input
                    id="tf-first-name"
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="tf-last-name" className={labelClass}>Last Name</label>
                  <input
                    id="tf-last-name"
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="tf-user-email" className={labelClass}>Email</label>
                <input
                  id="tf-user-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  aria-describedby="tf-user-email-hint"
                  className={inputClass}
                  placeholder="user@domain.com"
                />
                <p id="tf-user-email-hint" className="text-xs text-[var(--color-muted-foreground)] mt-1">
                  The address they sign in with. It can be at any domain.
                </p>
              </div>

              <div>
                <label htmlFor="tf-username" className={labelClass}>Username</label>
                <input
                  id="tf-username"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Role</label>
                <Dropdown
                  variant="form"
                  value={role}
                  onChange={setRole}
                  items={ROLE_OPTIONS}
                  label="Select role..."
                />
              </div>

              <div>
                <label htmlFor="tf-user-password" className={labelClass}>Password</label>
                <div className="flex gap-2">
                  <input
                    id="tf-user-password"
                    type="text"
                    value={userPassword}
                    onChange={e => setUserPassword(e.target.value)}
                    autoComplete="off"
                    aria-describedby="tf-user-password-hint"
                    aria-invalid={passwordTooShort || undefined}
                    className={inputClass}
                    placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`}
                  />
                  <Button variant="secondary" size="md" onClick={handleGenerate} className="shrink-0">
                    Generate
                  </Button>
                </div>
                <p
                  id="tf-user-password-hint"
                  className={`text-xs mt-1 ${passwordTooShort ? 'text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}
                >
                  {passwordTooShort
                    ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
                    : userPassword === ''
                      ? emailLinkAvailable
                        ? "Optional. Leave it blank and we'll email them a link to set their own."
                        : 'Optional.'
                      : `At least ${MIN_PASSWORD_LENGTH} characters. Ask them to change it with Forgot password after they first sign in.`}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div className="bg-[var(--color-primary-fixed)] border border-[var(--color-primary)]/20 rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--color-on-primary-fixed)] font-medium">
          {successMessage}
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
