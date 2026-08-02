import type { ClaimDayType } from './enums'

export interface SupportActivityGroupDto {
  id: string
  groupCode: string
  displayName: string
  supportCategory: number
  isActive: boolean
  items: SupportCatalogueItemDto[]
}

export interface SupportCatalogueItemDto {
  id: string
  itemNumber: string
  description: string
  unit: string
  dayType: ClaimDayType
  isIntensive: boolean
  priceLimit_ACT: number
  priceLimit_NSW: number
  priceLimit_NT: number
  priceLimit_QLD: number
  priceLimit_SA: number
  priceLimit_TAS: number
  priceLimit_VIC: number
  priceLimit_WA: number
  priceLimit_Remote: number
  priceLimit_VeryRemote: number
  catalogueVersion: string
  effectiveFrom: string
  isActive: boolean
}

export interface CatalogueImportPreviewDto {
  detectedVersion: string
  itemsToAdd: number
  itemsToDeactivate: number
  rows: CatalogueImportRowDto[]
  warnings: string[]
}

export interface CatalogueImportRowDto {
  itemNumber: string
  description: string
  dayType: ClaimDayType
  isIntensive: boolean
  priceLimit_ACT: number
  priceLimit_NSW: number
  priceLimit_NT: number
  priceLimit_QLD: number
  priceLimit_SA: number
  priceLimit_TAS: number
  priceLimit_VIC: number
  priceLimit_WA: number
  priceLimit_Remote: number
  priceLimit_VeryRemote: number
  isNew: boolean
  priceChanged: boolean
}

export interface ConfirmCatalogueImportDto {
  catalogueVersion: string
  rows: CatalogueImportRowDto[]
}
