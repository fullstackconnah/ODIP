export interface AccommodationListDto {
  id: string
  propertyName: string
  location: string | null
  region: string | null
  address: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  isFullyModified: boolean
  isSemiModified: boolean
  isWheelchairAccessible: boolean
  bedroomCount: number | null
  bedCount: number | null
  maxCapacity: number | null
  isActive: boolean
}

export interface AccommodationDetailDto extends AccommodationListDto {
  providerOwner: string | null
  contactPerson: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  website: string | null
  accessibilityNotes: string | null
  beddingConfiguration: string | null
  hoistBathroomNotes: string | null
  generalNotes: string | null
}

export interface CreateAccommodationDto {
  propertyName: string
  providerOwner?: string
  location?: string
  region?: string
  address?: string
  suburb?: string
  state?: string
  postcode?: string
  contactPerson?: string
  email?: string
  phone?: string
  mobile?: string
  website?: string
  isFullyModified: boolean
  isSemiModified: boolean
  isWheelchairAccessible: boolean
  accessibilityNotes?: string
  bedroomCount?: number
  bedCount?: number
  maxCapacity?: number
  beddingConfiguration?: string
  hoistBathroomNotes?: string
  generalNotes?: string
  isActive?: boolean
}

export type UpdateAccommodationDto = CreateAccommodationDto
