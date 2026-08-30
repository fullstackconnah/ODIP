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
