import type { PreferredContactMethod } from './enums'

export interface ContactDto {
  id: string
  firstName: string
  lastName: string
  fullName: string
  roleRelationship: string | null
  organisation: string | null
  email: string | null
  mobile: string | null
  phone: string | null
  preferredContactMethod: PreferredContactMethod
}
