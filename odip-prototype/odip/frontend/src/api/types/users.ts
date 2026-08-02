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
  staffId: string | null
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
  staffId?: string | null
  password?: string
}

export interface UpdateAdminUserDto {
  firstName: string
  lastName: string
  email: string
  username: string
  role: string
  staffId?: string | null
  isActive: boolean
}
