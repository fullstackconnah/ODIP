import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import {
  useAdminTenantsSummary,
  useCreateAdminUser,
  useUpdateAdminUser,
} from '@/api/hooks'
import type { AdminUserDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UserFormPanelProps {
  isOpen: boolean
  onClose: () => void
  user?: AdminUserDto
  defaultTenantId?: string
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
  const [error, setError] = useState<string | null>(null)

  // Reset form state when the panel opens or the user prop changes
  useEffect(() => {
    if (!isOpen) return
    setError(null)

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

  const isFormValid =
    tenantId.trim() !== '' &&
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    email.trim() !== '' &&
    username.trim() !== '' &&
    role.trim() !== ''

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
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { errors?: string[]; message?: string } | string } }
      setError(
        (typeof axiosErr?.response?.data === 'string'
          ? axiosErr.response.data
          : axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message) ||
          'Failed to save user.',
      )
    }
  }

  const inputClass =
    'w-full px-3 py-2 rounded-xl bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-all'
  const labelClass =
    'block text-xs font-medium text-[var(--color-muted-foreground)] mb-1'

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--color-card)] border-l border-[var(--color-border)] z-50 flex flex-col shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <h2 className="font-semibold text-[var(--color-foreground)]">
            {isEdit ? 'Edit User' : 'New User'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--color-accent)] transition-colors"
          >
            <X className="w-5 h-5 text-[var(--color-muted-foreground)]" />
          </button>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Tenant */}
          <div>
            <label className={labelClass}>Tenant *</label>
            <Dropdown
              variant="form"
              value={tenantId}
              onChange={setTenantId}
              items={tenants.map(t => ({ value: t.id, label: t.name }))}
              label="Select tenant"
              disabled={isEdit}
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
            <label className={labelClass}>Role *</label>
            <Dropdown
              variant="form"
              value={role}
              onChange={setRole}
              items={ROLE_OPTIONS}
              label="Select role"
            />
          </div>

          {/* Password — create mode only */}
          {!isEdit && (
            <div>
              <label className={labelClass}>Password</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="Min 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setPassword(Math.random().toString(36).slice(-10) + 'A1!')}
                  className="px-3 py-2 border border-[var(--color-border)] rounded-xl text-xs font-medium hover:bg-[var(--color-accent)] transition-colors whitespace-nowrap"
                >
                  Generate
                </button>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Optional. User will sign in with this password via email/password auth.</p>
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
                  isActive ? 'bg-[var(--color-primary)]' : 'bg-gray-300'
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
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] shrink-0">
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
        </div>
      </div>
    </>
  )
}
