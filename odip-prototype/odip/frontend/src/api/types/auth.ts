export interface AuthResponseDto {
  token: string
  expiresAt: string
  username: string
  fullName: string
  role: string
  tenantName: string | null
  tenantId: string | null
}
