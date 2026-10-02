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

/** What became of a person's Firebase sign-in account: ODIP just made it, or it was already there and was left as it was. */
export type FirebaseAccountState = 'created' | 'existing'

/** POST /admin/users/{id}/sign-in-account and POST /staff/{id}/sign-in-account: makes sure the account exists, and says which. */
export interface SignInAccountDto {
  firebaseAccount: FirebaseAccountState
}
