import { useState, useEffect, useRef } from 'react'
import { X, ChevronDown, ChevronRight } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import {
  useCreateTenantWithSetup,
  useUpdateTenant,
} from '@/api/hooks/admin'
import type { TenantSummaryDto, CreateTenantWithSetupDto, UpdateTenantDto } from '@/api/types'

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

  // ── Reset form on open ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setSuccessMessage(null)
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
  async function handleSubmit() {
    setError(null)

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
          ? { firstName, lastName, email, username, role: role || 'Admin', password: userPassword || undefined }
          : null

        const data: CreateTenantWithSetupDto = {
          name,
          emailDomain,
          providerSettings,
          initialUser,
        }
        await createMutation.mutateAsync(data)
        setSuccessMessage('Tenant created')
      }

      timerRef.current = setTimeout(() => {
        setSuccessMessage(null)
        onClose()
      }, 1500)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { errors?: string[]; message?: string } | string } }
      setError(
        (typeof axiosErr?.response?.data === 'string'
          ? axiosErr.response.data
          : axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message) ||
          'Failed to save tenant.',
      )
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const isBusy = createMutation.isPending || updateMutation.isPending
  const canSubmit = name.trim() !== '' && emailDomain.trim() !== '' && !isBusy

  const inputClass =
    'w-full px-3 py-2 rounded-xl bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-all'
  const labelClass = 'block text-xs font-medium text-[var(--color-muted-foreground)] mb-1'

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-[var(--color-card)] border-l border-[var(--color-border)] z-50 flex flex-col shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <h2 className="font-semibold text-[var(--color-foreground)]">
            {isEdit ? 'Edit Tenant' : 'New Tenant'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--color-accent)] transition-colors"
          >
            <X className="w-5 h-5 text-[var(--color-muted-foreground)]" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
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
                    isActive ? 'bg-[var(--color-primary)]' : 'bg-gray-300'
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

                  <div className="flex items-center gap-6">
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
                      className={inputClass}
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
                  <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
                    Optionally create an admin user for this tenant. All four
                    fields (first name, last name, email, username) must be
                    filled for the user to be created.
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>First Name</label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={e => setFirstName(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Last Name</label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={e => setLastName(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className={inputClass}
                      placeholder="user@domain.com"
                    />
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                      Must match the tenant's email domain.
                    </p>
                  </div>

                  <div>
                    <label className={labelClass}>Username</label>
                    <input
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
                    <label className={labelClass}>Password</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={userPassword}
                        onChange={e => setUserPassword(e.target.value)}
                        className={inputClass}
                        placeholder="Min 6 characters"
                      />
                      <button
                        type="button"
                        onClick={() => setUserPassword(Math.random().toString(36).slice(-10) + 'A1!')}
                        className="px-3 py-2 border border-[var(--color-border)] rounded-xl text-xs font-medium hover:bg-[var(--color-accent)] transition-colors whitespace-nowrap"
                      >
                        Generate
                      </button>
                    </div>
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Optional. User will sign in with this password.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Success message */}
          {successMessage && (
            <div className="bg-[#bff285] border border-[#8fc950] rounded-xl px-4 py-3 text-sm text-[#294800] font-medium">
              {successMessage}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] flex items-center justify-end gap-3 shrink-0">
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
            disabled={!canSubmit}
            className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {isBusy ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Tenant'}
          </button>
        </div>
      </div>
    </>
  )
}
