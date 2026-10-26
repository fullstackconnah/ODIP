export interface AuthResponseDto {
  /** The signed-in user's own id. Post staff/user unification this is the frontend's
   *  self-exclusion source (e.g. excluding yourself from a witness/picker) — see
   *  usePermissions(). Stored in `odip_user` alongside the rest of this response. */
  id: string
  token: string
  expiresAt: string
  username: string
  fullName: string
  role: string
  tenantName: string | null
  tenantId: string | null
}

export interface DevUserDto {
  username: string
  role: string
  tenantName: string | null
}

/** GET /auth/config (anonymous): whether Sign in with Microsoft is on, and the server's own start URL for it (on its public host). */
export interface AuthConfigDto {
  microsoft: boolean
  microsoftStartUrl: string | null
}

export type MicrosoftRole = 'ReadOnly' | 'SupportWorker' | 'Coordinator'

/** GET /auth/microsoft/link (Admin): the organisation's linked Microsoft directory, or null when none. */
export interface MicrosoftLinkDto {
  microsoftTenantId: string
  defaultRole: MicrosoftRole
  linkedByName: string | null
  linkedAt: string
  updatedAt: string
}

/** GET /auth/microsoft/account (any signed-in person): whether their organisation is linked and their own Microsoft account is. */
export interface MicrosoftAccountDto {
  orgLinked: boolean
  accountLinked: boolean
}
