export interface AuthResponseDto {
  token: string
  expiresAt: string
  username: string
  fullName: string
  role: string
  tenantName: string | null
  tenantId: string | null
  /** The signed-in user's own linked Staff id, or null when the account isn't linked to a Staff
   *  record. Stored in `odip_user` alongside the rest of this response — see usePermissions(). */
  staffId: string | null
}

export interface DevUserDto {
  username: string
  role: string
  tenantName: string | null
}
