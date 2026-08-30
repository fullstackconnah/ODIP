export interface AdminUserDto {
  id: string
  firstName: string
  lastName: string
  fullName: string
  email: string
  username: string
  role: string
  tenantId: string
  tenantName: string
  isActive: boolean
  createdAt: string
  lastLoginAt: string | null
}

export interface CreateAdminUserDto {
  firstName: string
  lastName: string
  email: string
  username: string
  role: string
  tenantId: string
  password?: string
}

export interface UpdateAdminUserDto {
  firstName: string
  lastName: string
  email: string
  username: string
  role: string
  isActive: boolean
}
